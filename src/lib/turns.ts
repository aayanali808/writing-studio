import type Anthropic from '@anthropic-ai/sdk';

/**
 * Reads a conversation thread out of a request body.
 *
 * The ask popover and the research pane both let the writer reply to an answer
 * rather than only read it, so both routes receive the thread so far. The
 * opening user turn is never sent: each route rebuilds it from the highlighted
 * passage, so the client can't put words in the writer's mouth and the prompt
 * stays under our control.
 *
 * The thread therefore arrives as `[assistant, user, assistant, …]` and is
 * appended straight after the rebuilt opening turn. Anything that doesn't
 * alternate cleanly is dropped rather than repaired — a malformed thread is a
 * bug on our side, and the Anthropic API rejects it anyway.
 */
export function readTurns(value: unknown): Anthropic.MessageParam[] {
  if (!Array.isArray(value)) return [];

  const turns: Anthropic.MessageParam[] = [];
  // The rebuilt opening turn is a user turn, so the thread must start with the
  // assistant's reply to it.
  let expected: 'assistant' | 'user' = 'assistant';

  for (const entry of value) {
    const role = (entry as { role?: unknown })?.role;
    const content = (entry as { content?: unknown })?.content;

    if (role !== 'assistant' && role !== 'user') break;
    if (role !== expected) break;
    if (typeof content !== 'string' || !content.trim()) break;

    turns.push({ role, content: content.trim() });
    expected = expected === 'assistant' ? 'user' : 'assistant';
  }

  // A trailing assistant turn would leave the model nothing to answer.
  if (turns.length && turns[turns.length - 1].role === 'assistant') turns.pop();

  return turns;
}
