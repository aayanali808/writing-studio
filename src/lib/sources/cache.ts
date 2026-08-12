import { query, queryOne } from '@/lib/db';
import { getConfiguredProviders, getProvider } from './registry';
import type { ExternalSource } from './provider';
import type { Source, SourceWithPin } from '@/types';

/**
 * The bridge between providers and the `sources` table.
 *
 * Providers return live data; everything the app reads afterwards (the Sources
 * pane, the Context Bundle) reads the cached row instead, so an AI call never
 * depends on a third-party API being up.
 */

/**
 * Upserts one external item, keyed by (provider, external_id).
 *
 * An empty `content` means "stub from list()/search()" and deliberately leaves
 * any previously fetched body in place — re-listing must not wipe the cache.
 */
async function upsertSource(
  providerId: string,
  item: ExternalSource
): Promise<Source> {
  const row = await queryOne<Source>(
    `insert into sources (provider, external_id, title, url, content_cache, last_synced)
     values ($1, $2, $3, $4, $5, now())
     on conflict (provider, external_id) do update
        set title         = excluded.title,
            url           = excluded.url,
            content_cache = case
                              when excluded.content_cache = '' then sources.content_cache
                              else excluded.content_cache
                            end,
            last_synced   = now()
     returning id, provider, external_id, title, url, content_cache, last_synced`,
    [providerId, item.externalId, item.title, item.url, item.content]
  );

  if (!row) throw new Error('Failed to cache source');
  return row;
}

export interface SyncReport {
  synced: number;
  errors: { provider: string; message: string }[];
}

/**
 * Pulls the catalogue from every configured provider. Titles and URLs only —
 * bodies are resolved lazily by `syncSourceContent`, because fetching every
 * page body on every sync would be slow and mostly wasted.
 */
export async function syncAllProviders(): Promise<SyncReport> {
  const errors: SyncReport['errors'] = [];
  let synced = 0;

  for (const provider of getConfiguredProviders()) {
    try {
      for (const item of await provider.list()) {
        await upsertSource(provider.id, item);
        synced += 1;
      }
    } catch (error) {
      errors.push({
        provider: provider.id,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return { synced, errors };
}

/** Searches every configured provider and caches what comes back. */
export async function searchProviders(term: string): Promise<Source[]> {
  const results: Source[] = [];

  for (const provider of getConfiguredProviders()) {
    for (const item of await provider.search(term)) {
      results.push(await upsertSource(provider.id, item));
    }
  }

  return results;
}

/**
 * Fetches and caches the full body of one source. Runs when a source is pinned
 * — its text has to be in the Context Bundle — or when refreshed by hand.
 */
export async function syncSourceContent(sourceId: string): Promise<Source | null> {
  const existing = await queryOne<Source>(
    `select id, provider, external_id, title, url, content_cache, last_synced
       from sources
      where id = $1`,
    [sourceId]
  );
  if (!existing) return null;

  const provider = getProvider(existing.provider);
  if (!provider?.isConfigured()) return existing;

  const fresh = await provider.fetch(existing.external_id);
  if (!fresh) return existing;

  return upsertSource(provider.id, fresh);
}

/** Every cached source, flagged with whether it is pinned to this document. */
export async function listSourcesForDocument(
  documentId: string
): Promise<SourceWithPin[]> {
  return query<SourceWithPin>(
    `select s.id, s.provider, s.external_id, s.title, s.url,
            s.content_cache, s.last_synced,
            (p.document_id is not null) as pinned
       from sources s
       left join pinned_context p
         on p.source_id = s.id and p.document_id = $1
      order by (p.document_id is not null) desc, s.title asc`,
    [documentId]
  );
}
