import { requireSession } from '@/auth';
import { EFFORT, MODEL, getAnthropic } from '@/lib/anthropic';
import { contextSystemPrompt } from '@/lib/context-bundle';
import { query } from '@/lib/db';
import type { ChatMessage } from '@/types';

type RouteContext = { params: Promise<{ id: string }> };

/** Streaming keeps the connection alive, but a long answer still needs room. */
export const maxDuration = 60;

const CHAT_TASK = [
  'The writer is talking with you in the chat pane alongside their draft.',
  'Answer their questions and help them think the piece through. Be concrete and',
  'refer to specific passages when it helps. Keep responses focused and brief —',
  'this is a side panel, not an essay. When you suggest replacement prose, give',
  'the prose itself rather than describing it.',
].join('\n');

/** How many prior turns to replay. Older turns stay in the database. */
const HISTORY_LIMIT = 30;

export async function GET(_request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const messages = await query<ChatMessage>(
    `select id, role, content, created_at
       from chat_messages
      where document_id = $1
      order by created_at asc`,
    [id]
  );

  return Response.json({ messages });
}

export async function POST(request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const userMessage =
    typeof body?.message === 'string' ? body.message.trim() : '';

  if (!userMessage) {
    return Response.json({ error: 'Expected a `message` string' }, { status: 400 });
  }

  const system = await contextSystemPrompt(id, CHAT_TASK);
  if (!system) {
    return Response.json({ error: 'Document not found' }, { status: 404 });
  }

  // Persist the user's turn before calling out, so it survives a failed call.
  await query(
    'insert into chat_messages (document_id, role, content) values ($1, $2, $3)',
    [id, 'user', userMessage]
  );

  const history = await query<{ role: 'user' | 'assistant'; content: string }>(
    `select role, content from (
       select role, content, created_at
         from chat_messages
        where document_id = $1
        order by created_at desc
        limit $2
     ) recent
     order by created_at asc`,
    [id, HISTORY_LIMIT]
  );

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = '';

      try {
        const anthropic = getAnthropic();
        const messageStream = anthropic.messages.stream({
          model: MODEL,
          max_tokens: 32_000,
          thinking: { type: 'adaptive' },
          output_config: { effort: EFFORT.CHAT },
          system,
          messages: history.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        });

        messageStream.on('text', (delta) => {
          assistantText += delta;
          controller.enqueue(encoder.encode(delta));
        });

        const final = await messageStream.finalMessage();

        if (final.stop_reason === 'refusal') {
          const notice =
            '\n\n[Claude declined to answer this request.]';
          assistantText += notice;
          controller.enqueue(encoder.encode(notice));
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        console.error('[chat]', message, error);
        const notice = `\n\n[The request failed: ${message}]`;
        assistantText += notice;
        controller.enqueue(encoder.encode(notice));
      } finally {
        if (assistantText.trim()) {
          await query(
            'insert into chat_messages (document_id, role, content) values ($1, $2, $3)',
            [id, 'assistant', assistantText]
          );
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  await query('delete from chat_messages where document_id = $1', [id]);

  return new Response(null, { status: 204 });
}
