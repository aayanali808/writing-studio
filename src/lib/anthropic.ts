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
  /** Research. Judging evidence against a claim — the highest-stakes call. */
  RESEARCH: 'high',
} as const;

/**
 * Claude's server-side web search tool. The research agent declares this and
 * Anthropic runs the searches — nothing is executed on our side.
 *
 * `_20260209` is the dynamic-filtering variant, supported on Sonnet 5; it
 * filters results before they reach the context window. Do not additionally
 * declare `code_execution` alongside it — filtering already runs code under the
 * hood, and a second execution environment confuses the model.
 */
export const WEB_SEARCH_TOOL = {
  type: 'web_search_20260209' as const,
  name: 'web_search' as const,
  max_uses: 6,
};
