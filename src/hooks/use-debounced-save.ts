'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

interface Options<T> {
  /** Milliseconds of quiet before a save fires. */
  delay?: number;
  save: (value: T) => Promise<void>;
}

/**
 * Debounced write-behind saving.
 *
 * Returns `flush`, which every AI call must await before firing: the Context
 * Bundle is built server-side from the database, so an unsaved keystroke would
 * otherwise be invisible to Claude.
 */
export function useDebouncedSave<T>({ delay = 800, save }: Options<T>) {
  const [status, setStatus] = useState<SaveStatus>('idle');

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ value: T } | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const saveRef = useRef(save);

  // Keep the latest closure without restarting the debounce on every render.
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const run = useCallback(async () => {
    if (!pending.current) return;

    const { value } = pending.current;
    pending.current = null;
    setStatus('saving');

    const attempt = (async () => {
      try {
        await saveRef.current(value);
        // Only claim "saved" if nothing new arrived while we were writing.
        setStatus(pending.current ? 'pending' : 'saved');
      } catch (error) {
        console.error('[save]', error);
        setStatus('error');
      }
    })();

    inFlight.current = attempt;
    await attempt;
    inFlight.current = null;
  }, []);

  const schedule = useCallback(
    (value: T) => {
      pending.current = { value };
      setStatus('pending');

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void run();
      }, delay);
    },
    [delay, run]
  );

  /** Writes any queued value immediately and resolves once it has landed. */
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (pending.current) await run();
    if (inFlight.current) await inFlight.current;
  }, [run]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Last-ditch save when the tab goes away mid-edit.
  useEffect(() => {
    const handler = () => {
      if (pending.current) void run();
    };
    window.addEventListener('pagehide', handler);
    return () => window.removeEventListener('pagehide', handler);
  }, [run]);

  return { status, schedule, flush };
}
