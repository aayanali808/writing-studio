'use client';

import { useCallback, useEffect, useState } from 'react';
import { useStudio } from '@/components/studio/StudioContext';
import { apiJson } from '@/lib/client';
import type { DocNode, Document, VersionSummary } from '@/types';

/**
 * Versions.
 *
 * Restore points for the draft. They exist because this app rewrites prose in
 * place and autosave overwrites the only copy — undo covers that until you
 * reload.
 *
 * A snapshot holds the draft as it was *before* the change that triggered it,
 * so restoring one puts back what you had. Restoring snapshots the current
 * state first, which makes the restore itself undoable.
 */

const REASON_LABELS: Record<VersionSummary['reason'], string> = {
  auto: 'autosave',
  ai: 'before AI edit',
  manual: 'snapshot',
};

export function VersionsPane() {
  const { documentId, editor, flushSave, scheduleSave, setTitle } = useStudio();

  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await apiJson<{ versions: VersionSummary[] }>(
      `/api/documents/${documentId}/versions`
    );
    setVersions(data.versions);
  }, [documentId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await apiJson<{ versions: VersionSummary[] }>(
          `/api/documents/${documentId}/versions`
        );
        if (!cancelled) setVersions(data.versions);
      } catch {
        if (!cancelled) setError('Could not load versions.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const snapshotNow = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Snapshot the draft as it stands, not as it was last saved.
      await flushSave();
      const data = await apiJson<{ versions: VersionSummary[] }>(
        `/api/documents/${documentId}/versions`,
        { method: 'POST', body: JSON.stringify({ reason: 'manual' }) }
      );
      setVersions(data.versions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Snapshot failed.');
    } finally {
      setBusy(false);
    }
  }, [documentId, flushSave]);

  const restore = useCallback(
    async (versionId: string) => {
      setBusy(true);
      setError(null);
      setConfirming(null);

      try {
        // The server snapshots the current draft before overwriting it, so it
        // needs the live version on disk first.
        await flushSave();

        const data = await apiJson<{
          document: Document;
          versions: VersionSummary[];
        }>(`/api/documents/${documentId}/versions`, {
          method: 'PUT',
          body: JSON.stringify({ versionId }),
        });

        // Put the restored draft into the editor. Without this the pane would
        // show the restore succeeding while the writer still sees the old text,
        // and the next keystroke would save it straight back over the top.
        if (editor) {
          editor.commands.setContent(data.document.content as DocNode);
        }
        setTitle(data.document.title);
        scheduleSave({
          title: data.document.title,
          content: data.document.content,
        });

        setVersions(data.versions);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Restore failed.');
        await load().catch(() => undefined);
      } finally {
        setBusy(false);
      }
    },
    [documentId, editor, flushSave, scheduleSave, setTitle, load]
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
          Restore points
        </span>
        <button
          type="button"
          onClick={() => void snapshotNow()}
          disabled={busy}
          className="text-[11px] text-[var(--text-faint)] transition-colors hover:text-[var(--text)] disabled:opacity-40"
        >
          Snapshot now
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p className="px-3 py-2 text-xs text-[var(--danger)]">{error}</p>
        ) : null}

        {versions !== null && versions.length === 0 ? (
          <p className="px-3 py-3 text-[11px] leading-relaxed text-[var(--text-faint)]">
            No versions yet. One is taken automatically as you write, before
            every AI edit you apply, and whenever you press{' '}
            <span className="text-[var(--text-muted)]">Snapshot now</span>.
          </p>
        ) : null}

        {versions?.map((version) => (
          <article
            key={version.id}
            className="border-b border-[var(--border)] px-3 py-2"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs">{version.title || 'Untitled'}</span>
              <span className="shrink-0 text-[10px] text-[var(--text-faint)]">
                {formatTime(version.created_at)}
              </span>
            </div>

            <div className="mt-0.5 flex items-baseline gap-2 text-[10px] text-[var(--text-faint)]">
              <span>{REASON_LABELS[version.reason] ?? version.reason}</span>
              <span>·</span>
              <span>{approxWords(version.characters).toLocaleString()} words</span>
            </div>

            <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-faint)]">
              {version.preview}
            </p>

            {confirming === version.id ? (
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void restore(version.id)}
                  disabled={busy}
                  className="rounded bg-[var(--accent)] px-2 py-0.5 text-[11px] font-medium text-[#1a1409] transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Replace the draft
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="text-[11px] text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(version.id)}
                disabled={busy}
                className="mt-1.5 text-[11px] text-[var(--text-faint)] transition-colors hover:text-[var(--accent)] disabled:opacity-40"
              >
                Restore
              </button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

/** Close enough for a list entry, and free — no need to store a word count. */
function approxWords(characters: number): number {
  return Math.round(characters / 5.5);
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const sameDay = new Date().toDateString() === date.toDateString();

  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
