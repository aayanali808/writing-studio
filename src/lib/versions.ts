import { query, queryOne } from '@/lib/db';
import { getDocument } from '@/lib/documents';
import type { DocumentVersion, VersionSummary } from '@/types';

/**
 * Draft snapshots.
 *
 * The app rewrites prose in place — Replace in the ask popover swaps a passage
 * for Claude's version — and autosave overwrites the only copy. Undo covers
 * that until you reload, at which point a paragraph you liked is gone. This is
 * the safety net, so it snapshots what the draft looked like *before* a change
 * rather than after.
 */

/**
 * How quiet things must be before autosave takes another snapshot.
 *
 * Autosave fires every 800ms while you type; snapshotting each one would be
 * thousands of near-identical rows a session. Fifteen minutes gives roughly one
 * per sitting, and the explicit snapshots below cover the risky moments.
 */
const AUTO_INTERVAL_MS = 15 * 60 * 1000;

/** Snapshots kept per document; older ones are pruned as new ones land. */
const KEEP_PER_DOCUMENT = 50;

export type SnapshotReason = 'auto' | 'ai' | 'manual';

/**
 * Records the document's *current* state as a version.
 *
 * Call before writing a change. `auto` is rate-limited by `AUTO_INTERVAL_MS`;
 * `ai` and `manual` always record, because those are the moments worth being
 * able to get back to.
 */
export async function snapshotDocument(
  documentId: string,
  reason: SnapshotReason
): Promise<DocumentVersion | null> {
  if (reason === 'auto') {
    const latest = await queryOne<{ created_at: string }>(
      `select created_at
         from document_versions
        where document_id = $1
        order by created_at desc
        limit 1`,
      [documentId]
    );

    if (
      latest &&
      Date.now() - new Date(latest.created_at).getTime() < AUTO_INTERVAL_MS
    ) {
      return null;
    }
  }

  const document = await getDocument(documentId);
  if (!document) return null;

  // An empty draft isn't worth a restore point, and the first autosave of a
  // brand-new piece would otherwise always create one.
  if (!document.plain_text.trim()) return null;

  const version = await queryOne<DocumentVersion>(
    `insert into document_versions (document_id, title, content, plain_text, reason)
     values ($1, $2, $3, $4, $5)
     returning id, document_id, title, content, plain_text, reason, created_at`,
    [
      documentId,
      document.title,
      JSON.stringify(document.content),
      document.plain_text,
      reason,
    ]
  );

  await query(
    `delete from document_versions
      where document_id = $1
        and id not in (
          select id from document_versions
           where document_id = $1
           order by created_at desc
           limit $2
        )`,
    [documentId, KEEP_PER_DOCUMENT]
  );

  return version;
}

/**
 * The snapshot list for the Versions pane.
 *
 * Bodies are deliberately left out — fifty full drafts is a lot of JSON to send
 * for a list you mostly scroll past. `getVersion` fetches one on demand.
 */
export async function listVersions(
  documentId: string
): Promise<VersionSummary[]> {
  return query<VersionSummary>(
    `select id, title, reason, created_at,
            length(plain_text) as characters,
            left(plain_text, 160) as preview
       from document_versions
      where document_id = $1
      order by created_at desc`,
    [documentId]
  );
}

export async function getVersion(
  documentId: string,
  versionId: string
): Promise<DocumentVersion | null> {
  return queryOne<DocumentVersion>(
    `select id, document_id, title, content, plain_text, reason, created_at
       from document_versions
      where id = $1 and document_id = $2`,
    [versionId, documentId]
  );
}
