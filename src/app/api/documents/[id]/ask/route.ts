import { requireSession } from '@/auth';
import { MODEL, getAnthropic } from '@/lib/anthropic';
import { contextSystemPrompt } from '@/lib/context-bundle';

type RouteContext = { params: Promise<{ id: string }> };

/** Short, tightly-scoped edits — but leave headroom for a slow first token. */
export const maxDuration = 60;

/**
 * Highlight-to-ask.
 *
 * The selection plus its surrounding paragraph is sent alongside the full
 * Context Bundle, so Claude can see both the sentence under the cursor and the
 * piece it belongs to. The response streams back into the side popover, where
 * the writer can replace the selection with it, insert it below, or discard it.
 */

const ASK_TASK = [
  'The writer has highlighted a passage in their draft and asked you about it.',
  'You are given the highlighted text and the paragraph around it.',
  '',
  'When the request is to rewrite or improve the passage, reply with the',
  'replacement prose and nothing else — no preamble, no explanation, no quotation',
  'marks around it — because the writer can drop your reply straight into the',
  'draft. Match the surrounding voice, tense, and register.',
  '',
  'When the request is to explain, critique, or answer a question, reply with a',
  'short, direct answer instead. Do not pad it.',
].join('\n');

type AskAction = 'improve' | 'explain' | 'custom';

const ACTION_PROMPTS: Record<Exclude<AskAction, 'custom'>, string> = {
  improve:
    'Rewrite the highlighted passage so it reads better — tighter, clearer, and truer to the voice of the surrounding draft. Preserve the meaning. Reply with the rewritten passage only.',
  explain:
    'Explain the highlighted passage: what it is saying, what work it is doing in the piece, and anything that is unclear or unsupported as written.',
};

export async function POST(request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json().catch(() => null);

  const selection = typeof body?.selection === 'string' ? body.selection.trim() : '';
  const surrounding =
    typeof body?.surrounding === 'string' ? body.surrounding.trim() : '';
  const action: AskAction =
    body?.action === 'improve' || body?.action === 'explain' ? body.action : 'custom';
  const customPrompt =
    typeof body?.prompt === 'string' ? body.prompt.trim() : '';

  if (!selection) {
    return Response.json({ error: 'Expected a `selection` string' }, { status: 400 });
  }
  if (action === 'custom' && !customPrompt) {
    return Response.json(
      { error: 'A custom ask needs a `prompt` string' },
      { status: 400 }
    );
  }

  const system = await contextSystemPrompt(id, ASK_TASK);
  if (!system) {
    return Response.json({ error: 'Document not found' }, { status: 404 });
  }

  const instruction =
    action === 'custom' ? customPrompt : ACTION_PROMPTS[action];

  const userContent = [
    '--- Highlighted passage ---',
    selection,
    '',
    '--- Surrounding text ---',
    surrounding || '(The highlighted passage is the whole paragraph.)',
    '',
    '--- Request ---',
    instruction,
  ].join('\n');

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const messageStream = getAnthropic().messages.stream({
          model: MODEL,
          max_tokens: 16_000,
          thinking: { type: 'adaptive' },
          // Low effort: these are short, tightly-scoped edits and the writer is
          // waiting on them with a popover open.
          output_config: { effort: 'low' },
          system,
          messages: [{ role: 'user', content: userContent }],
        });

        messageStream.on('text', (delta) => {
          controller.enqueue(encoder.encode(delta));
        });

        const final = await messageStream.finalMessage();
        if (final.stop_reason === 'refusal') {
          controller.enqueue(
            encoder.encode('\n\n[Claude declined to answer this request.]')
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[ask]', message, error);
        controller.enqueue(encoder.encode(`\n\n[The request failed: ${message}]`));
      } finally {
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
