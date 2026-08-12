import Anthropic from '@anthropic-ai/sdk';

/**
 * Every AI feature in the app runs on this model.
 *
 * Sonnet 5 over Opus 5 on cost: at roughly 100 calls a month against a Context
 * Bundle of ~8K tokens, Sonnet 5 ($2/$10 per MTok) comes to ~$3.40/month where
 * Opus 5 ($5/$25) is ~$8.50. Swap the string to 'claude-opus-5' if a piece ever
 * justifies it — nothing else in the codebase needs to change, though see the
 * effort note below.
 */
export const MODEL = 'claude-sonnet-5';

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and fill it in.'
      );
    }
    client = new Anthropic();
  }
  return client;
}

/**
 * Effort levels, kept here so the three AI routes stay comparable at a glance.
 *
 * Sonnet 5 honours `effort` more strictly than Opus 5 does, particularly at the
 * bottom of the range: at 'low' it scopes work tightly to what was asked, which
 * is right for a mechanical edit but under-thinks a subtle rewrite. Since
 * "improve this passage" is exactly the nuanced case, ASK sits at 'medium'
 * rather than 'low'. Drop it to 'low' if you want snappier popovers and don't
 * mind blander suggestions.
 */
export const EFFORT = {
  /** Highlight-to-ask. The writer is waiting on this with a popover open. */
  ASK: 'medium',
  /** Chat. Analytical, but still a side panel. */
  CHAT: 'medium',
  /**
   * Research. Tempting to set high — judging evidence is the highest-stakes
   * call — but it runs several web searches inside one 60s Vercel function.
   * In testing, 'high' blew the ceiling outright and 'medium' spent the whole
   * budget deliberating without completing a single search. The value here is
   * in the searching, not the deliberation. Raise it on a plan with a longer
   * function timeout.
   */
  RESEARCH: 'low',
} as const;

/**
 * Claude's server-side web search tool. The research agent declares this and
 * Anthropic runs the searches — nothing is executed on our side.
 *
 * Deliberately the basic `_20250305` variant rather than `_20260209`. The
 * newer one filters results before they reach the context window, but it does
 * that by running code execution under the hood — a round trip per search that
 * we cannot afford inside a 60s function. We only need titles and URLs plus a
 * short verdict, so the filtering buys little here. Switch to `_20260209` if
 * you move to a longer function timeout and want tighter results.
 */
export const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305' as const,
  name: 'web_search' as const,
  // Each search costs wall-clock inside a 60s function. Four is enough to
  // triangulate a claim; six pushed past the ceiling in testing.
  max_uses: 4,
};
