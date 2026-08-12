'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from '@/components/Markdown';
import { useStudio } from '@/components/studio/StudioContext';
import { apiJson } from '@/lib/client';
import { diffWords } from '@/lib/diff';
import { markdownToDoc } from '@/lib/markdown';
import { docToPlainText } from '@/lib/tiptap';
import { insertAfterRange, replaceRange } from './editor-utils';
import type { EditorSelection, Turn } from '@/types';

export interface AskState {
  label: string;
  selection: EditorSelection;
  /** What opened the thread, resent with each follow-up. */
  request: { action: 'improve' | 'explain' | 'custom'; prompt?: string };
  /** `[assistant, user, assistant, …]` — the opening request is implicit. */
  turns: Turn[];
  pending: boolean;
  error: string | null;
}

/**
 * The side popover holding a highlight-to-ask thread.
 *
 * It is a conversation, not a single answer: you can write back, and the reply
 * carries the whole thread plus the same Context Bundle. The apply actions at
 * the bottom always act on the *latest* answer, which is the one you would have
 * been reading when you decided to use it.
 */
export function AskPopover({
  state,
  onFollowUp,
  onClose,
}: {
  state: AskState;
  onFollowUp: (question: string) => void;
  onClose: () => void;
}) {
  const { editor, documentId, flushSave } = useStudio();
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  /**
   * Records a restore point before an answer overwrites the draft.
   *
   * Applying a rewrite is the one action here that destroys prose you wrote,
   * and undo doesn't survive a reload — so this runs first, and a failure to
   * snapshot never blocks the edit the writer asked for.
   */
  const snapshot = useCallback(async () => {
    try {
      await flushSave();
      await apiJson(`/api/documents/${documentId}/versions`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'ai' }),
      });
    } catch (error) {
      console.error('[ask] snapshot failed', error);
    }
  }, [documentId, flushSave]);

  const latest = [...state.turns]
    .reverse()
    .find((turn) => turn.role === 'assistant');
  const answer = latest?.content ?? '';

  const canApply = Boolean(editor) && !state.pending && Boolean(answer.trim());

  const [showDiff, setShowDiff] = useState(false);

  /**
   * What Replace would actually do to the highlighted text.
   *
   * Compared as plain text, because the answer is Markdown and the selection
   * isn't — diffing `**tighter**` against `tighter` would report a change that
   * only exists in the syntax.
   */
  const diff = useMemo(() => {
    if (state.pending || !answer.trim()) return null;

    // Routed through the same parse Replace uses, so the diff describes what
    // would actually land rather than a separate reading of the text.
    const plain = docToPlainText({ type: 'doc', content: markdownToDoc(answer) });
    return diffWords(state.selection.text, plain || answer);
  }, [answer, state.pending, state.selection.text]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [state.turns]);

  const handleReplace = async () => {
    if (!editor) return;
    await snapshot();
    replaceRange(editor, state.selection, answer);
    onClose();
  };

  const handleInsertBelow = async () => {
    if (!editor) return;
    await snapshot();
    insertAfterRange(editor, state.selection, answer);
    onClose();
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const send = () => {
    const question = reply.trim();
    if (!question || state.pending) return;
    onFollowUp(question);
    setReply('');
  };

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-raised)]">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
          {state.label}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded px-1.5 text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
        >
          ✕
        </button>
      </header>

      <div className="border-b border-[var(--border)] px-3 py-2">
        <p className="line-clamp-3 border-l-2 border-[var(--accent)] pl-2 text-xs italic text-[var(--text-faint)]">
          {state.selection.text}
        </p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {state.turns.map((turn, index) =>
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
              {index === state.turns.length - 1 && state.pending ? (
                <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--accent)] align-middle" />
              ) : null}
            </div>
          )
        )}

        {state.error ? (
          <p className="text-sm text-[var(--danger)]">{state.error}</p>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {diff && !diff.unchanged ? (
        <div className="border-t border-[var(--border)]">
          <button
            type="button"
            onClick={() => setShowDiff((value) => !value)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
          >
            <span>
              {showDiff ? 'Hide changes' : 'Show changes'} ·{' '}
              <span className="text-[var(--ins)]">+{diff.added}</span>{' '}
              <span className="text-[var(--del)]">−{diff.removed}</span>
            </span>
            <span className="text-[9px]">{showDiff ? '▴' : '▾'}</span>
          </button>

          {showDiff ? (
            <p className="studio-diff max-h-40 overflow-y-auto px-3 pb-2 text-xs leading-relaxed">
              {diff.parts.map((part, index) =>
                part.op === 'keep' ? (
                  <span key={index}>{part.text}</span>
                ) : part.op === 'insert' ? (
                  <ins key={index}>{part.text}</ins>
                ) : (
                  <del key={index}>{part.text}</del>
                )
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="border-t border-[var(--border)] p-2">
        <textarea
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          rows={2}
          disabled={state.pending}
          placeholder="Reply to Claude…  (Enter to send)"
          className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--bg-inset)] px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50 placeholder:text-[var(--text-faint)]"
        />
      </div>

      <footer className="grid grid-cols-2 gap-1.5 border-t border-[var(--border)] p-2">
        <ActionButton onClick={() => void handleReplace()} disabled={!canApply} primary>
          Replace
        </ActionButton>
        <ActionButton onClick={() => void handleInsertBelow()} disabled={!canApply}>
          Insert below
        </ActionButton>
        <ActionButton onClick={handleCopy} disabled={!canApply}>
          {copied ? 'Copied' : 'Copy'}
        </ActionButton>
        <ActionButton onClick={onClose}>Discard</ActionButton>
      </footer>
    </aside>
  );
}

function ActionButton({
  onClick,
  disabled,
  primary,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        primary
          ? 'bg-[var(--accent)] text-[#1a1409] hover:opacity-90'
          : 'border border-[var(--border-strong)] text-[var(--text-muted)] hover:bg-[var(--bg-inset)] hover:text-[var(--text)]'
      }`}
    >
      {children}
    </button>
  );
}
