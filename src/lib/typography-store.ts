import { DEFAULT_TYPOGRAPHY, type Typography } from '@/types';

/**
 * The editor's display preferences, held in localStorage.
 *
 * This is a `useSyncExternalStore` source rather than state seeded from an
 * effect. localStorage genuinely is an external system — it outlives the React
 * tree and can change in another tab — and reading it into state after mount
 * causes a second render on every load. React also needs a distinct server
 * snapshot to hydrate against, which this gives it for free.
 *
 * The snapshot is cached because `useSyncExternalStore` compares it by
 * identity: parsing the JSON on every call would return a new object each time
 * and re-render forever.
 */

const KEY = 'writing-studio:typography';

let snapshot: Typography | null = null;
const listeners = new Set<() => void>();

function read(): Typography {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored) return { ...DEFAULT_TYPOGRAPHY, ...JSON.parse(stored) };
  } catch {
    // Corrupt JSON, or storage blocked entirely — the defaults stand.
  }
  return DEFAULT_TYPOGRAPHY;
}

export function subscribeTypography(listener: () => void): () => void {
  listeners.add(listener);

  // Another tab writing the key invalidates our cache.
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

export function getTypography(): Typography {
  snapshot ??= read();
  return snapshot;
}

/** The value React hydrates against, before localStorage is readable. */
export function getServerTypography(): Typography {
  return DEFAULT_TYPOGRAPHY;
}

export function writeTypography(patch: Partial<Typography>): void {
  snapshot = { ...getTypography(), ...patch };

  try {
    window.localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // Not being able to remember the choice shouldn't stop it applying.
  }

  listeners.forEach((notify) => notify());
}
