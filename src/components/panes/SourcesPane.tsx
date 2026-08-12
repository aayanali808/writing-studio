'use client';

import { useState } from 'react';
import { useStudio } from '@/components/studio/StudioContext';
import type { SourceWithPin } from '@/types';

/**
 * The Sources pane.
 *
 * Read-only external material, pinnable into the Context Bundle. Nothing here
 * knows about Notion specifically — it renders whatever the registered
 * SourceProviders have cached, tagged by provider.
 */
export function SourcesPane() {
  const {
    sources,
    providers,
    sourcesBusy,
    sourcesError,
    syncSources,
    togglePin,
  } = useStudio();

  const [term, setTerm] = useState('');

  const pinned = sources.filter((source) => source.pinned);
  const available = sources.filter((source) => !source.pinned);
  const unconfigured = providers.filter((provider) => !provider.configured);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border)] p-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void syncSources(term.trim() || undefined);
          }}
          className="flex gap-1.5"
        >
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search, or sync everything…"
            className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-inset)] px-2.5 py-1.5 text-xs outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--accent)]"
          />
          <button
            type="submit"
            disabled={sourcesBusy}
            className="shrink-0 rounded-md border border-[var(--border-strong)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-inset)] hover:text-[var(--text)] disabled:opacity-40"
          >
            {sourcesBusy ? '…' : term.trim() ? 'Search' : 'Sync'}
          </button>
        </form>

        {sourcesError ? (
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--danger)]">
            {sourcesError}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sources.length === 0 && !sourcesBusy ? (
          <p className="px-3 py-3 text-[11px] leading-relaxed text-[var(--text-faint)]">
            {unconfigured.length === providers.length
              ? 'No provider is configured. Add NOTION_INTEGRATION_TOKEN to .env.local, share the pages you want with that integration, then press Sync.'
              : 'Nothing cached yet. Press Sync to pull in what your integration can see.'}
          </p>
        ) : null}

        {pinned.length > 0 ? (
          <Section label={`In context (${pinned.length})`}>
            {pinned.map((source) => (
              <SourceRow key={source.id} source={source} onToggle={togglePin} />
            ))}
          </Section>
        ) : null}

        {available.length > 0 ? (
          <Section label="Available">
            {available.map((source) => (
              <SourceRow key={source.id} source={source} onToggle={togglePin} />
            ))}
          </Section>
        ) : null}
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="sticky top-0 z-10 bg-[var(--bg-raised)] px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
        {label}
      </h3>
      <ul className="pb-2">{children}</ul>
    </section>
  );
}

function SourceRow({
  source,
  onToggle,
}: {
  source: SourceWithPin;
  onToggle: (sourceId: string, pinned: boolean) => Promise<void>;
}) {
  return (
    <li className="group flex items-start gap-2 px-3 py-1.5 transition-colors hover:bg-[var(--bg-inset)]">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs">{source.title}</p>
        <p className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--text-faint)]">
          <span className="uppercase tracking-wider">{source.provider}</span>
          {source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[var(--accent)]"
            >
              open
            </a>
          ) : null}
          {source.pinned && !source.content_cache ? (
            <span className="text-[var(--danger)]">no cached text</span>
          ) : null}
        </p>
      </div>

      <button
        type="button"
        onClick={() => void onToggle(source.id, !source.pinned)}
        className={
          source.pinned
            ? 'shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]'
            : 'shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--text-faint)] opacity-0 transition-all hover:text-[var(--text)] focus:opacity-100 group-hover:opacity-100'
        }
      >
        {source.pinned ? 'Pinned' : 'Pin'}
      </button>
    </li>
  );
}
