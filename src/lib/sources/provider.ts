/**
 * The pluggable source layer.
 *
 * A SourceProvider is a read-only window onto some external corpus — Notion
 * today, anything else later (Drive, Readwise, a folder of Markdown). Providers
 * know nothing about documents, pinning, or the Context Bundle: they only
 * enumerate and fetch. `cache.ts` owns persisting them into the `sources` table,
 * and `registry.ts` owns which ones exist.
 */

/** A source as the provider sees it, before it is cached locally. */
export interface ExternalSource {
  /** Stable identifier within the provider. Becomes `sources.external_id`. */
  externalId: string;
  title: string;
  url: string | null;
  /**
   * Plain-text body. `list()` and `search()` return `''` here — resolving the
   * body is `fetch()`'s job, and it only runs when a source is pinned or
   * explicitly refreshed.
   */
  content: string;
}

export interface SourceProvider {
  /** Stable slug stored in `sources.provider`, e.g. 'notion'. */
  readonly id: string;

  /** Human-readable name, shown in the Sources pane. */
  readonly label: string;

  /** True when the provider has the configuration it needs (tokens etc.). */
  isConfigured(): boolean;

  /** Everything this provider exposes, without bodies. */
  list(): Promise<ExternalSource[]>;

  /** Full content for one item, or null if it no longer exists. */
  fetch(externalId: string): Promise<ExternalSource | null>;

  /** Provider-side search, without bodies. */
  search(query: string): Promise<ExternalSource[]>;
}
