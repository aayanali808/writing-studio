/**
 * Browser-side fetch helpers.
 *
 * Every API route returns `{ error }` on failure, so unwrapping that in one
 * place keeps the panes free of repeated response plumbing.
 */

async function errorFrom(response: Response): Promise<Error> {
  const payload = await response.json().catch(() => null);
  return new Error(payload?.error ?? `Request failed (${response.status})`);
}

export async function apiJson<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) throw await errorFrom(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

/**
 * Consumes a streaming text response, invoking `onChunk` with the accumulated
 * text so far. Used by the chat pane and highlight-to-ask.
 */
export async function apiStream(
  url: string,
  init: RequestInit,
  onChunk: (accumulated: string) => void
): Promise<string> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok || !response.body) throw await errorFrom(response);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    accumulated += decoder.decode(value, { stream: true });
    onChunk(accumulated);
  }

  return accumulated;
}
