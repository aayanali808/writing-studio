'use client';

import { useCallback, useEffect, useState } from 'react';
import { findCommentRange } from '@/components/editor/comment-mark';
import { useStudio } from '@/components/studio/StudioContext';
import { apiJson } from '@/lib/client';
import type { Comment } from '@/types';

/**
 * Comments.
 *
 * Notes to yourself, anchored to a passage — no AI involved. The thing the AI
 * panes can't do is remember what *you* thought when you read it back.
 *
 * A note whose text has been deleted becomes an orphan: it stays in the list,
 * marked, showing the passage it was about. Silently dropping the note along
 * with the sentence would lose the more valuable half.
 */
export function CommentsPane() {
  const { documentId, editor, comments, setComments, refreshComments } =
    useStudio();

  const [showResolved, setShowResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    refreshComments().catch(() => setError('Could not load notes.'));
  }, [refreshComments]);

  const jumpTo = useCallback(
    (comment: Comment) => {
      if (!editor) return;

      const range = findCommentRange(editor.state.doc, comment.id);
      if (!range) return;

      editor
        .chain()
        .focus()
        .setTextSelection({ from: range.from, to: range.to })
        .scrollIntoView()
        .run();
    },
    [editor]
  );

  const setResolved = useCallback(
    async (comment: Comment, resolved: boolean) => {
      setComments((current) =>
        current.map((entry) =>
          entry.id === comment.id ? { ...entry, resolved } : entry
        )
      );

      try {
        await apiJson(`/api/documents/${documentId}/comments`, {
          method: 'PATCH',
          body: JSON.stringify({ commentId: comment.id, resolved }),
        });
      } catch {
        setError('Could not update that note.');
        await refreshComments().catch(() => undefined);
      }
    },
    [documentId, setComments, refreshComments]
  );

  const remove = useCallback(
    async (comment: Comment) => {
      setComments((current) =>
        current.filter((entry) => entry.id !== comment.id)
      );

      // Take the highlight out of the draft too, or the passage would stay
      // marked with nothing behind it.
      editor?.chain().unsetComment(comment.id).run();

      try {
        await apiJson(
          `/api/documents/${documentId}/comments?commentId=${comment.id}`,
          { method: 'DELETE' }
        );
      } catch {
        setError('Could not delete that note.');
        await refreshComments().catch(() => undefined);
      }
    },
    [documentId, editor, setComments, refreshComments]
  );

  const visible = comments.filter(
    (comment) => showResolved || !comment.resolved
  );
  const resolvedCount = comments.filter((comment) => comment.resolved).length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
          Your notes
        </span>
        {resolvedCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowResolved((value) => !value)}
            className="text-[11px] text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
          >
            {showResolved ? 'Hide done' : `Show done (${resolvedCount})`}
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p className="px-3 py-2 text-xs text-[var(--danger)]">{error}</p>
        ) : null}

        {visible.length === 0 ? (
          <p className="px-3 py-3 text-[11px] leading-relaxed text-[var(--text-faint)]">
            Highlight a passage and choose{' '}
            <span className="text-[var(--text-muted)]">Note</span> to leave
            yourself a comment on it.
          </p>
        ) : null}

        {visible.map((comment) => {
          const anchored = editor
            ? findCommentRange(editor.state.doc, comment.id) !== null
            : true;

          return (
            <article
              key={comment.id}
              className={`border-b border-[var(--border)] px-3 py-2 ${
                comment.resolved ? 'opacity-50' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => jumpTo(comment)}
                disabled={!anchored}
                className="block w-full border-l-2 border-[var(--accent)] pl-2 text-left text-[11px] italic leading-relaxed text-[var(--text-faint)] transition-colors hover:text-[var(--text-muted)] disabled:cursor-default"
              >
                {comment.quote || '(no passage)'}
              </button>

              <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed">
                {comment.body}
              </p>

              <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[var(--text-faint)]">
                <button
                  type="button"
                  onClick={() => void setResolved(comment, !comment.resolved)}
                  className="transition-colors hover:text-[var(--accent)]"
                >
                  {comment.resolved ? 'Reopen' : 'Done'}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(comment)}
                  className="transition-colors hover:text-[var(--danger)]"
                >
                  Delete
                </button>
                {!anchored ? (
                  <span
                    className="ml-auto text-[var(--text-faint)]"
                    title="The text this note was on has been deleted."
                  >
                    orphaned
                  </span>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
