'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStudio } from '@/components/studio/StudioContext';
import { apiJson } from '@/lib/client';
import { docToMarkdown } from '@/lib/tiptap';
import type { DocNode, Document, DocumentSummary } from '@/types';

/**
 * The title in the workspace bar, doubling as the document menu.
 *
 * Switching documents is a navigation rather than client state: the draft,
 * goals, and pane layout are all loaded server-side for one document, so
 * `?doc=<id>` reloads them together and the studio remounts (see the `key` in
 * studio/page.tsx). Trying to swap them in place would mean four separate
 * refetches racing each other.
 */
export function DocumentMenu() {
  const { documentId, title, flushSave, editor } = useStudio();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    if (open) {
      setOpen(false);
      return;
    }

    setOpen(true);
    setError(null);

    // Re-read every time: titles change as you type, and this is the only
    // place that shows them.
    try {
      const data = await apiJson<{ documents: DocumentSummary[] }>(
        '/api/documents'
      );
      setDocuments(data.documents);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load pieces');
    }
  }, [open]);

  const openDocument = useCallback(
    async (id: string) => {
      setOpen(false);
      if (id === documentId) return;

      // Land any pending keystroke before the page swaps under it.
      await flushSave();
      router.push(`/studio?doc=${id}`);
    },
    [documentId, flushSave, router]
  );

  const createDocument = useCallback(async () => {
    setBusy(true);
    try {
      await flushSave();
      const { document } = await apiJson<{ document: Document }>(
        '/api/documents',
        { method: 'POST', body: JSON.stringify({ title: 'Untitled' }) }
      );
      setOpen(false);
      router.push(`/studio?doc=${document.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create a piece');
    } finally {
      setBusy(false);
    }
  }, [flushSave, router]);

  const exportMarkdown = useCallback(async () => {
    setBusy(true);
    try {
      // The editor holds the live document when the Writing pane is open; if
      // it's been closed, the saved copy is the next best thing.
      let content: DocNode | null = editor
        ? (editor.getJSON() as DocNode)
        : null;

      if (!content) {
        await flushSave();
        const data = await apiJson<{ document: Document }>(
          `/api/documents/${documentId}`
        );
        content = data.document.content;
      }

      const markdown = `# ${title || 'Untitled'}\n\n${docToMarkdown(content)}\n`;
      download(`${slugify(title)}.md`, markdown);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }, [documentId, title, editor, flushSave]);

  return (
    <div className="relative flex min-w-0 items-baseline gap-2">
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex min-w-0 items-baseline gap-1 rounded px-1.5 py-0.5 text-xs font-medium transition-colors hover:bg-[var(--bg-raised)]"
      >
        <span className="truncate">{title || 'Untitled'}</span>
        <span className="shrink-0 text-[9px] text-[var(--text-faint)]">▾</span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-7 z-20 w-72 overflow-hidden rounded-md border border-[var(--border-strong)] bg-[var(--bg-raised)] py-1 shadow-xl">
            <div className="max-h-72 overflow-y-auto">
              {documents === null && !error ? (
                <p className="px-3 py-2 text-[11px] text-[var(--text-faint)]">
                  Loading…
                </p>
              ) : null}

              {documents?.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => void openDocument(entry.id)}
                  className={`flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--accent-soft)] ${
                    entry.id === documentId
                      ? 'text-[var(--accent)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  <span className="truncate">{entry.title || 'Untitled'}</span>
                  <span className="shrink-0 text-[10px] text-[var(--text-faint)]">
                    {relativeTime(entry.updated_at)}
                  </span>
                </button>
              ))}
            </div>

            <div className="my-1 h-px bg-[var(--border)]" />

            <MenuItem onClick={() => void createDocument()} disabled={busy}>
              New piece
            </MenuItem>
            <MenuItem onClick={() => void exportMarkdown()} disabled={busy}>
              Export as Markdown
            </MenuItem>

            {error ? (
              <p className="px-3 py-1.5 text-[11px] text-[var(--danger)]">{error}</p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MenuItem({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="block w-full px-3 py-1.5 text-left text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--text)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Hands the file to the browser and releases the object URL afterwards. */
function download(filename: string, contents: string): void {
  const url = URL.createObjectURL(
    new Blob([contents], { type: 'text/markdown;charset=utf-8' })
  );

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  URL.revokeObjectURL(url);
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.round(hours / 24)}d`;
}
