import type Anthropic from '@anthropic-ai/sdk';
import { requireSession } from '@/auth';
import { MODEL, WEB_SEARCH_TOOL, getAnthropic } from '@/lib/anthropic';
import { contextSystemPrompt } from '@/lib/context-bundle';
import type { ResearchSource } from '@/types';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * A multi-search turn is the slowest thing in the app. 60s is the ceiling on
 * Vercel's Hobby plan; on Pro this can go to 300. If searches start getting cut
 * off, raise this first, then drop `effort` to 'medium' below.
 */
export const maxDuration = 60;

/**
 * The research agent.
 *
 * Triggered from highlight-to-ask ("Find sources for this claim"). Claude runs
 * the searches server-side via its own web search tool — nothing is fetched
 * from here — and we pull the cited results out of the response for the
 * Research Results pane.
 */

const RESEARCH_TASK = [
  'The writer has highlighted a claim in their draft and wants sources for it.',
  '',
  'Search the web for material that bears on the claim. Prefer primary sources,',
  'peer-reviewed work, official statistics, and established outlets over',
  'aggregators and SEO content. Report what you actually found, including when',
  'the evidence contradicts or only partly supports the claim — a claim that does',
  'not hold up is the most useful thing you can tell the writer.',
  '',
  'Then write a short verdict: two or three sentences on what the evidence says',
  'about the claim as written. Do not restate the claim back at them, do not',
  'list the sources again in prose (they are shown separately), and do not pad',
  'with caveats about search limitations.',
].join('\n');

/**
 * A turn using server-side tools can stop with `pause_turn` when Anthropic's
 * internal loop hits its iteration limit. Resending the conversation resumes it.
 */
const MAX_CONTINUATIONS = 3;

function extractSources(content: Anthropic.ContentBlock[]): ResearchSource[] {
  const sources: ResearchSource[] = [];
  const seen = new Set<string>();

  for (const block of content) {
    if (block.type !== 'web_search_tool_result') continue;

    // On an error the API returns a single error object here rather than a list.
    if (!Array.isArray(block.content)) continue;

    for (const result of block.content) {
      if (result.type !== 'web_search_result' || seen.has(result.url)) continue;
      seen.add(result.url);
      sources.push({
        title: result.title || result.url,
        url: result.url,
        snippet: '',
      });
    }
  }

  return sources;
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

/** Surfaces a failed search as a message rather than swallowing it. */
function extractSearchError(content: Anthropic.ContentBlock[]): string | null {
  for (const block of content) {
    if (block.type !== 'web_search_tool_result') continue;
    if (!Array.isArray(block.content) && block.content?.type === 'web_search_tool_result_error') {
      return block.content.error_code;
    }
  }
  return null;
}

export async function POST(request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json().catch(() => null);

  const claim = typeof body?.claim === 'string' ? body.claim.trim() : '';
  const surrounding =
    typeof body?.surrounding === 'string' ? body.surrounding.trim() : '';

  if (!claim) {
    return Response.json({ error: 'Expected a `claim` string' }, { status: 400 });
  }

  const system = await contextSystemPrompt(id, RESEARCH_TASK);
  if (!system) {
    return Response.json({ error: 'Document not found' }, { status: 404 });
  }

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        '--- The claim to check ---',
        claim,
        '',
        '--- Where it appears in the draft ---',
        surrounding || '(No surrounding context was captured.)',
      ].join('\n'),
    },
  ];

  try {
    const anthropic = getAnthropic();
    const allSources: ResearchSource[] = [];
    let summary = '';
    let searchError: string | null = null;

    for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt += 1) {
      // Streamed so a long multi-search turn can't hit the request timeout,
      // even though the client is given a single JSON response at the end.
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: 32_000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        system,
        tools: [WEB_SEARCH_TOOL],
        messages,
      });

      const response = await stream.finalMessage();

      allSources.push(...extractSources(response.content));
      searchError ??= extractSearchError(response.content);
      summary = extractText(response.content) || summary;

      if (response.stop_reason === 'refusal') {
        return Response.json(
          { error: 'Claude declined to research this claim.' },
          { status: 422 }
        );
      }

      if (response.stop_reason !== 'pause_turn') break;

      messages.push({ role: 'assistant', content: response.content });
    }

    // De-duplicate across continuations.
    const seen = new Set<string>();
    const sources = allSources.filter((source) => {
      if (seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    });

    if (searchError && sources.length === 0) {
      return Response.json(
        { error: `Web search failed (${searchError}).` },
        { status: 502 }
      );
    }

    return Response.json({
      claim,
      summary,
      sources,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[research]', message, error);
    return Response.json({ error: message }, { status: 500 });
  }
}
