'use client';

import { insertCitation } from '@/components/editor/editor-utils';
import { useStudio } from '@/components/studio/StudioContext';

/**
 * Research Results.
 *
 * Filled by the research agent — Claude with its server-side web search tool —
 * triggered from the highlight-to-ask toolbar. Each source can be dropped into
 * the draft at the cursor as a formatted, linked citation.
 *
 * Results are session-scoped on purpose: they are search output, not the
 * writer's own material. Anything worth keeping goes into the draft as a
 * citation, or gets pinned as a source.
 */
export function ResearchPane() {
  const { research, researchBusy, clearResearch, editor } = useStudio();

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

            {result.summary ? (
              <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed">
                {result.summary}
              </p>
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

            {result.sources.length === 0 && !result.summary ? (
              <p className="mt-2 text-xs text-[var(--text-faint)]">
                Nothing came back for this claim.
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
