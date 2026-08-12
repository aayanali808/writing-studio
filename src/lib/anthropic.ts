import Anthropic from '@anthropic-ai/sdk';

/** Every AI feature in the app runs on this model. */
export const MODEL = 'claude-opus-5';

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
 * Claude's server-side web search tool. The research agent declares this and
 * Anthropic runs the searches — nothing is executed on our side.
 *
 * `_20260209` is the dynamic-filtering variant, which Opus 5 supports; it
 * filters results before they reach the context window. Do not additionally
 * declare `code_execution` alongside it — filtering already runs code under the
 * hood, and a second execution environment confuses the model.
 */
export const WEB_SEARCH_TOOL = {
  type: 'web_search_20260209' as const,
  name: 'web_search' as const,
  max_uses: 6,
};
