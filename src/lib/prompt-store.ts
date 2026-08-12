import { DEFAULT_PROMPTS, type SavedPrompt } from '@/types';

/**
 * Custom asks you keep reaching for.
 *
 * The selection toolbar's free-text box means retyping "cut this by a third,
 * keep the argument" every time. These are the same thing, saved.
 *
 * Local like the typography store, and for the same reason: a preference about
 * how you work, not part of any piece. Same `useSyncExternalStore` shape, so
 * the snapshot has to stay identity-stable — see the cache note there.
 */

const KEY = 'writing-studio:prompts';

let snapshot: SavedPrompt[] | null = null;
const listeners = new Set<() => void>();

function read(): SavedPrompt[] {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (!stored) return DEFAULT_PROMPTS;

    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return DEFAULT_PROMPTS;

    return parsed
      .filter(
        (entry): entry is SavedPrompt =>
          typeof entry?.label === 'string' && typeof entry?.prompt === 'string'
      )
      .map((entry) => ({ label: entry.label, prompt: entry.prompt }));
  } catch {
    return DEFAULT_PROMPTS;
  }
}

function emit(next: SavedPrompt[]): void {
  snapshot = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not being able to remember it shouldn't stop it working this session.
  }
  listeners.forEach((notify) => notify());
}

export function subscribePrompts(listener: () => void): () => void {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== KEY) return;
    snapshot = null;
    listeners.forEach((notify) => notify());
  };

  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function getPrompts(): SavedPrompt[] {
  snapshot ??= read();
  return snapshot;
}

export function getServerPrompts(): SavedPrompt[] {
  return DEFAULT_PROMPTS;
}

/** Adds a prompt, or moves it to the front if the same text is already saved. */
export function savePrompt(prompt: string, label?: string): void {
  const text = prompt.trim();
  if (!text) return;

  const entry: SavedPrompt = { label: (label ?? shortLabel(text)).trim(), prompt: text };
  const rest = getPrompts().filter((saved) => saved.prompt !== text);

  emit([entry, ...rest].slice(0, 12));
}

export function deletePrompt(prompt: string): void {
  emit(getPrompts().filter((saved) => saved.prompt !== prompt));
}

/** A chip-sized name derived from the prompt, when none was given. */
function shortLabel(prompt: string): string {
  const firstClause = prompt.split(/[.,;:\n]/)[0].trim();
  const words = firstClause.split(/\s+/).slice(0, 4).join(' ');
  return words.length > 28 ? `${words.slice(0, 27)}…` : words;
}
