'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Markdown } from '@/components/Markdown';
import { useStudio } from '@/components/studio/StudioContext';
import { apiJson, apiStream } from '@/lib/client';
import type { ChatMessage } from '@/types';

const STREAMING_ID = '__streaming__';

export function ChatPane() {
  const { documentId, flushSave } = useStudio();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(async () => {
    const data = await apiJson<{ messages: ChatMessage[] }>(
      `/api/documents/${documentId}/chat`
    );
    setMessages(data.messages);
  }, [documentId]);

  useEffect(() => {
    let cancelled = false;

    // The state updates sit after an await so they never land synchronously
    // during the effect, and the flag drops responses that arrive after the
    // pane has been closed or switched to another document.
    (async () => {
      try {
        const data = await apiJson<{ messages: ChatMessage[] }>(
          `/api/documents/${documentId}/chat`
        );
        if (!cancelled) setMessages(data.messages);
      } catch {
        if (!cancelled) setError('Could not load the conversation.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || streaming) return;

    setDraft('');
    setError(null);
    setStreaming(true);

    const now = new Date().toISOString();
    setMessages((current) => [
      ...current,
      { id: `local-${now}`, role: 'user', content: text, created_at: now },
      { id: STREAMING_ID, role: 'assistant', content: '', created_at: now },
    ]);

    try {
      // Make sure Claude sees the draft as it stands right now.
      await flushSave();

      await apiStream(
        `/api/documents/${documentId}/chat`,
        { method: 'POST', body: JSON.stringify({ message: text }) },
        (accumulated) =>
          setMessages((current) =>
            current.map((message) =>
              message.id === STREAMING_ID
                ? { ...message, content: accumulated }
                : message
            )
          )
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The request failed.');
    } finally {
      setStreaming(false);
      // Re-read so ids and ordering match what was actually persisted.
      loadHistory().catch(() => undefined);
    }
  }, [draft, streaming, documentId, flushSave, loadHistory]);

  const clearChat = useCallback(async () => {
    await apiJson(`/api/documents/${documentId}/chat`, { method: 'DELETE' });
    setMessages([]);
  }, [documentId]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
          Sees your draft, goals, and pinned sources
        </span>
        {messages.length > 0 ? (
          <button
            type="button"
            onClick={() => void clearChat()}
            className="text-[11px] text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
          >
            Clear
          </button>
        ) : null}
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <p className="mt-8 px-2 text-center text-sm text-[var(--text-faint)]">
            Ask about structure, argument, or what to do next.
          </p>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === 'user'
                ? 'ml-6 rounded-lg bg-[var(--bg-inset)] px-3 py-2'
                : 'mr-2'
            }
          >
            <div className="mb-0.5 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
              {message.role === 'user' ? 'You' : 'Claude'}
            </div>
            {/* The writer's own words go through verbatim; Claude's are
                Markdown and get rendered as such. */}
            {message.role === 'user' ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {message.content}
              </p>
            ) : (
              <div className="text-sm leading-relaxed">
                <Markdown source={message.content} />
                {message.id === STREAMING_ID && streaming ? (
                  <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--accent)] align-middle" />
                ) : null}
              </div>
            )}
          </div>
        ))}

        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[var(--border)] p-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          rows={3}
          placeholder="Ask about the piece…  (Enter to send)"
          className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--bg-inset)] px-2.5 py-2 text-sm outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-faint)]"
        />
      </div>
    </div>
  );
}
