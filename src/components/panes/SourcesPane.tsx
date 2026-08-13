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
 *
 * The search box narrows the list as you type. It used to only *add*: a search
 * queried the providers, cached the hits, and returned the whole catalogue, so
 * the thing you'd just searched for landed somewhere in title order among a
 * hundred other rows and looked like nothing had happened. Filtering locally is
 * instant and needs no round trip; pressing Search still asks the providers, so
 * anything not cached yet arrives *into* the same filtered view.
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

  const query = term.trim().toLowerCase();
  // The URL is matched too, so pasting one finds the page you already cached
  // rather than offering to fetch it again — minus any fragment, since the web
  // provider drops it before caching and a `#section` link would otherwise
  // never match the page it points into.
  const queryUrl = query.split('#')[0];
  const matches = query
    ? sources.filter(
        (source) =>
          source.title.toLowerCase().includes(query) ||
          (source.url ?? '').toLowerCase().includes(queryUrl)
      )
    : sources;

  const pinnedTotal = sources.filter((source) => source.pinned).length;
  const pinned = matches.filter((source) => source.pinned);
  const available = matches.filter((source) => !source.pinned);
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
            placeholder="Filter, or sync everything…"
            className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-inset)] px-2.5 py-1.5 text-xs outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--accent)]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setTerm('')}
              aria-label="Clear filter"
              className="shrink-0 rounded-md px-1.5 text-xs text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
            >
              ✕
            </button>
          ) : null}
          <button
            type="submit"
            disabled={sourcesBusy}
            title={
              query
                ? 'Ask the providers for anything matching that isn’t cached yet'
                : undefined
            }
            className="shrink-0 rounded-md border border-[var(--border-strong)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-inset)] hover:text-[var(--text)] disabled:opacity-40"
          >
            {sourcesBusy ? '…' : query ? 'Search' : 'Sync'}
          </button>
        </form>

        {query ? (
          <p className="mt-1.5 text-[10px] text-[var(--text-faint)]">
            {matches.length} of {sources.length} cached
            {matches.length === 0 ? ' — press Search to look further' : ''}
          </p>
        ) : null}

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
          // While filtering, the count says how much of what's pinned you're
          // looking at — pinned sources are hidden by a filter like any other,
          // and silently showing "In context (1)" when three are pinned would
          // misreport what Claude can actually see.
          <Section
            label={
              query
                ? `In context · ${pinned.length} of ${pinnedTotal}`
                : `In context (${pinnedTotal})`
            }
          >
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
