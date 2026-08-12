'use client';

import { useState } from 'react';
import { useStudio } from '@/components/studio/StudioContext';
import { insertAfterRange, replaceRange } from './editor-utils';
import type { EditorSelection } from '@/types';

export interface AskState {
  label: string;
  selection: EditorSelection;
  answer: string;
  pending: boolean;
  error: string | null;
}

/**
 * The side popover holding a highlight-to-ask response, with the actions that
 * put it back into the draft.
 */
export function AskPopover({
  state,
  onClose,
}: {
  state: AskState;
  onClose: () => void;
}) {
  const { editor } = useStudio();
  const [copied, setCopied] = useState(false);

  const canApply =
    Boolean(editor) && !state.pending && Boolean(state.answer.trim());

  const handleReplace = () => {
    if (!editor) return;
    replaceRange(editor, state.selection, state.answer);
    onClose();
  };

  const handleInsertBelow = () => {
    if (!editor) return;
    insertAfterRange(editor, state.selection, state.answer);
    onClose();
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(state.answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {state.error ? (
          <p className="text-sm text-[var(--danger)]">{state.error}</p>
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {state.answer}
            {state.pending ? (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--accent)] align-middle" />
            ) : null}
          </p>
        )}
      </div>

      <footer className="grid grid-cols-2 gap-1.5 border-t border-[var(--border)] p-2">
        <ActionButton onClick={handleReplace} disabled={!canApply} primary>
          Replace
        </ActionButton>
        <ActionButton onClick={handleInsertBelow} disabled={!canApply}>
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
