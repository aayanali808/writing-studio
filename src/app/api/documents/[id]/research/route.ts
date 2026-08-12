import type Anthropic from '@anthropic-ai/sdk';
import { requireSession } from '@/auth';
import { EFFORT, MODEL, WEB_SEARCH_TOOL, getAnthropic } from '@/lib/anthropic';
import { contextSystemPrompt } from '@/lib/context-bundle';
import type { ResearchSource } from '@/types';

type RouteContext = { params: Promise<{ id: string }> };

/** 60s is the ceiling on Vercel's Hobby plan; Pro allows up to 300. */
export const maxDuration = 60;

/**
 * Our own deadline, set below `maxDuration` so we can stop deliberately and
 * return what we have. Past this point the platform kills the function and the
 * browser gets a bare 504 — every search already paid for, thrown away.
 */
const DEADLINE_MS = 50_000;

/**
 * The research agent.
 *
 * Triggered from highlight-to-ask ("Find sources for this claim"). Claude runs
 * the searches server-side via its own web search tool — nothing is fetched
 * from here — and we pull the cited results out for the Research Results pane.
 */

const RESEARCH_TASK = [
  'The writer has highlighted a claim in their draft and wants sources for it.',
  '',
  'Start searching immediately — do not plan the search at length first. You are',
  'running inside a short time budget, and a few good sources returned quickly',
  'beat a thorough answer that never arrives.',
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

/** Harvests search results out of one completed content block. */
function collectSources(
  block: Anthropic.ContentBlock,
  into: ResearchSource[],
  seen: Set<string>
): void {
  if (block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) {
    return;
  }

  for (const result of block.content) {
    if (result.type !== 'web_search_result' || seen.has(result.url)) continue;
    seen.add(result.url);
    into.push({ title: result.title || result.url, url: result.url, snippet: '' });
  }
}

/** Surfaces a failed search rather than swallowing it. */
function readSearchError(block: Anthropic.ContentBlock): string | null {
  if (block.type !== 'web_search_tool_result') return null;
  if (
    !Array.isArray(block.content) &&
    block.content?.type === 'web_search_tool_result_error'
  ) {
    return block.content.error_code;
  }
  return null;
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
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

  const startedAt = Date.now();
  const remaining = () => DEADLINE_MS - (Date.now() - startedAt);

  const sources: ResearchSource[] = [];
  const seenUrls = new Set<string>();
  let summary = '';
  let searchError: string | null = null;
  let ranOutOfTime = false;

  try {
    const anthropic = getAnthropic();

    for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt += 1) {
      if (remaining() <= 0) {
        ranOutOfTime = true;
        break;
      }

      const stream = anthropic.messages.stream({
        model: MODEL,
        // Bounded: thinking bills against this too, and an unbounded budget
        // lets deliberation crowd out the searches we actually want.
        max_tokens: 8_000,
        thinking: { type: 'adaptive' },
        output_config: { effort: EFFORT.RESEARCH },
        system,
        tools: [WEB_SEARCH_TOOL],
        messages,
      });

      // Harvest results as each block completes, so aborting at the deadline
      // still leaves us with whatever Claude had already found.
      stream.on('contentBlock', (block) => {
        collectSources(block, sources, seenUrls);
        searchError ??= readSearchError(block);
      });

      const guard = setTimeout(() => stream.abort(), Math.max(remaining(), 0));

      let response: Anthropic.Message;
      try {
        response = await stream.finalMessage();
      } catch (error) {
        if (stream.aborted) {
          ranOutOfTime = true;
          break;
        }
        throw error;
      } finally {
        clearTimeout(guard);
      }

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

    // A search that failed outright and produced nothing is a real error.
    if (searchError && sources.length === 0) {
      return Response.json(
        { error: `Web search failed (${searchError}).` },
        { status: 502 }
      );
    }

    if (ranOutOfTime && sources.length === 0) {
      return Response.json(
        {
          error:
            'The search ran out of time before finding anything. Try highlighting a shorter, more specific claim.',
        },
        { status: 504 }
      );
    }

    return Response.json({
      claim,
      summary: ranOutOfTime
        ? [
            summary,
            summary ? '\n\n' : '',
            '(Stopped early at the time limit — these are the sources found so far.)',
          ].join('')
        : summary,
      sources,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[research]', message, error);
    return Response.json({ error: message }, { status: 500 });
  }
}
