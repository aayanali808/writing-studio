'use client';

import { useCallback, useState } from 'react';
import { Markdown } from '@/components/Markdown';
import { insertCitation } from '@/components/editor/editor-utils';
import { useStudio } from '@/components/studio/StudioContext';
import { apiJson } from '@/lib/client';
import type { ResearchResult, ResearchSource } from '@/types';

/**
 * Research Results.
 *
 * Filled by the research agent — Claude with its server-side web search tool —
 * triggered from the highlight-to-ask toolbar. Each source can be dropped into
 * the draft at the cursor as a formatted, linked citation.
 *
 * Each result is a thread: you can question a verdict, and the follow-up goes
 * back with the turns so far, searching again if it needs to. New sources merge
 * into the same list rather than starting a second result.
 *
 * Results are session-scoped on purpose: they are search output, not the
 * writer's own material. Anything worth keeping goes into the draft as a
 * citation, or gets pinned as a source.
 */
export function ResearchPane() {
  const {
    documentId,
    research,
    researchBusy,
    clearResearch,
    updateResearch,
    editor,
    flushSave,
  } = useStudio();

  const followUp = useCallback(
    async (result: ResearchResult, question: string) => {
      const history = [
        ...result.turns,
        { role: 'user' as const, content: question },
      ];

      updateResearch(result.id, { turns: history, pending: true, error: null });

      try {
        await flushSave();

        const data = await apiJson<{
          summary: string;
          sources: ResearchSource[];
        }>(`/api/documents/${documentId}/research`, {
          method: 'POST',
          body: JSON.stringify({
            claim: result.claim,
            surrounding: result.surrounding,
            history,
          }),
        });

        // A follow-up may or may not search again; merge whatever came back
        // into the thread's list rather than replacing it.
        const seen = new Set(result.sources.map((source) => source.url));
        const merged = [
          ...result.sources,
          ...data.sources.filter((source) => !seen.has(source.url)),
        ];

        updateResearch(result.id, {
          turns: [...history, { role: 'assistant', content: data.summary }],
          sources: merged,
          pending: false,
        });
      } catch (error) {
        updateResearch(result.id, {
          pending: false,
          error: error instanceof Error ? error.message : 'The request failed.',
        });
      }
    },
    [documentId, flushSave, updateResearch]
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
          {researchBusy ? 'Searching the web…' : 'Claude web search'}
        </span>
        {research.length > 0 ? (
          <button
            type="button"
            onClick={clearResearch}
            className="text-[11px] text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
          >
            Clear
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {research.length === 0 && !researchBusy ? (
          <p className="px-3 py-3 text-[11px] leading-relaxed text-[var(--text-faint)]">
            Highlight a claim in the draft and choose{' '}
            <span className="text-[var(--text-muted)]">Find sources</span>. Claude
            searches the web and the results land here.
          </p>
        ) : null}

        {researchBusy ? (
          <p className="px-3 py-3 text-xs text-[var(--text-faint)]">
            Running searches and reading results…
          </p>
        ) : null}

        {research.map((result) => (
          <article
            key={result.id}
            className="border-b border-[var(--border)] px-3 py-3"
          >
            <blockquote className="border-l-2 border-[var(--accent)] pl-2 text-xs italic leading-relaxed text-[var(--text-faint)]">
              {result.claim}
            </blockquote>

            <div className="mt-2.5 space-y-2">
              {result.turns.map((turn, index) =>
                turn.role === 'user' ? (
                  <p
                    key={index}
                    className="ml-5 rounded-lg bg-[var(--bg-inset)] px-2.5 py-1.5 text-xs leading-relaxed"
                  >
                    {turn.content}
                  </p>
                ) : (
                  <div key={index} className="text-sm leading-relaxed">
                    <Markdown source={turn.content} />
                  </div>
                )
              )}
            </div>

            {result.pending ? (
              <p className="mt-2 text-xs text-[var(--text-faint)]">Looking…</p>
            ) : null}

            {result.error ? (
              <p className="mt-2 text-xs text-[var(--danger)]">{result.error}</p>
            ) : null}

            {result.sources.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {result.sources.map((source) => (
                  <li key={source.url} className="group">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-xs leading-snug transition-colors hover:text-[var(--accent)]"
                    >
                      {source.title}
                    </a>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="min-w-0 truncate text-[10px] text-[var(--text-faint)]">
                        {hostOf(source.url)}
                      </span>
                      <button
                        type="button"
                        disabled={!editor}
                        onClick={() =>
                          editor && insertCitation(editor, source.title, source.url)
                        }
                        className="shrink-0 text-[10px] text-[var(--text-faint)] opacity-0 transition-all hover:text-[var(--accent)] focus:opacity-100 group-hover:opacity-100 disabled:opacity-0"
                      >
                        insert citation
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {result.sources.length === 0 && result.turns.length === 0 && !result.error ? (
              <p className="mt-2 text-xs text-[var(--text-faint)]">
                Nothing came back for this claim.
              </p>
            ) : null}

            <FollowUpBox
              disabled={result.pending}
              onSend={(question) => void followUp(result, question)}
            />
          </article>
        ))}
      </div>
    </div>
  );
}

/** The reply box under one research thread. */
function FollowUpBox({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (question: string) => void;
}) {
  const [value, setValue] = useState('');

  const send = () => {
    const question = value.trim();
    if (!question || disabled) return;
    onSend(question);
    setValue('');
  };

  return (
    <input
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          send();
        }
      }}
      disabled={disabled}
      placeholder="Ask about these findings…"
      className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--bg-inset)] px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50 placeholder:text-[var(--text-faint)]"
    />
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
