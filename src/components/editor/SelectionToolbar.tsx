'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/react';
import {
  deletePrompt,
  getPrompts,
  getServerPrompts,
  savePrompt,
  subscribePrompts,
} from '@/lib/prompt-store';
import type { EditorSelection } from '@/types';

export type ToolbarAction =
  | { kind: 'improve' }
  | { kind: 'explain' }
  | { kind: 'research' }
  | { kind: 'custom'; prompt: string }
  | { kind: 'note'; body: string };

/**
 * The floating toolbar that appears over a selection.
 *
 * Positioned against the editor's own scroll container rather than the
 * viewport, so it tracks the text as the pane scrolls or resizes.
 */
export function SelectionToolbar({
  editor,
  selection,
  containerRef,
  onAction,
}: {
  editor: Editor;
  selection: EditorSelection;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onAction: (action: ToolbarAction) => void;
}) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null
  );
  const [mode, setMode] = useState<'actions' | 'ask' | 'note'>('actions');
  const [prompt, setPrompt] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const prompts = useSyncExternalStore(
    subscribePrompts,
    getPrompts,
    getServerPrompts
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const update = () => {
      try {
        const start = editor.view.coordsAtPos(selection.from);
        const end = editor.view.coordsAtPos(selection.to);
        const box = container.getBoundingClientRect();
        const centre = (start.left + end.right) / 2;

        setPosition({
          top: start.top - box.top + container.scrollTop - 10,
          left: Math.min(
            Math.max(centre - box.left, 140),
            Math.max(container.clientWidth - 140, 140)
          ),
        });
      } catch {
        setPosition(null);
      }
    };

    update();
    container.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      container.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [editor, selection.from, selection.to, containerRef]);

  useEffect(() => {
    if (mode !== 'actions') inputRef.current?.focus();
  }, [mode]);

  // Note: the parent remounts this component (keyed on the selection range)
  // whenever the selection moves, which resets `mode` and `prompt` without
  // needing an effect to clear them.

  if (!position) return null;

  const submit = (keep: boolean) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    if (mode === 'note') {
      onAction({ kind: 'note', body: trimmed });
    } else {
      // Shift-Enter keeps the ask around as a chip for next time.
      if (keep) savePrompt(trimmed);
      onAction({ kind: 'custom', prompt: trimmed });
    }

    setMode('actions');
    setPrompt('');
  };

  return (
    <div
      className="absolute z-30 -translate-x-1/2 -translate-y-full"
      style={{ top: position.top, left: position.left }}
      // Keep the editor selection alive when the toolbar is clicked.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex flex-col gap-1 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-raised)] p-1 shadow-xl">
        {mode !== 'actions' ? (
          <>
            <div className="flex items-center gap-0.5">
              <input
                ref={inputRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submit(event.shiftKey);
                  }
                  if (event.key === 'Escape') setMode('actions');
                }}
                placeholder={
                  mode === 'note'
                    ? 'Note to yourself…'
                    : 'Ask about this…  (⇧⏎ to save it too)'
                }
                className="w-72 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-[var(--text-faint)]"
              />
              <ToolbarButton onClick={() => submit(false)}>
                {mode === 'note' ? 'Save' : 'Send'}
              </ToolbarButton>
            </div>

            {/* Saved asks. Clicking one sends it; ⇧⏎ above saves a new one. */}
            {mode === 'ask' && prompts.length ? (
              <div className="flex max-w-[22rem] flex-wrap gap-1 border-t border-[var(--border)] px-1 pb-0.5 pt-1.5">
                {prompts.map((saved) => (
                  <span
                    key={saved.prompt}
                    className="group/chip flex items-center rounded border border-[var(--border-strong)] text-[11px]"
                  >
                    <button
                      type="button"
                      title={saved.prompt}
                      onClick={() => {
                        onAction({ kind: 'custom', prompt: saved.prompt });
                        setMode('actions');
                      }}
                      className="px-1.5 py-0.5 text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]"
                    >
                      {saved.label}
                    </button>
                    <button
                      type="button"
                      aria-label={`Forget "${saved.label}"`}
                      onClick={() => deletePrompt(saved.prompt)}
                      className="px-1 text-[var(--text-faint)] opacity-0 transition-opacity hover:text-[var(--danger)] focus:opacity-100 group-hover/chip:opacity-100"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex items-center gap-0.5">
            <ToolbarButton onClick={() => onAction({ kind: 'improve' })}>
              Improve
            </ToolbarButton>
            <ToolbarButton onClick={() => onAction({ kind: 'explain' })}>
              Explain
            </ToolbarButton>
            <ToolbarButton onClick={() => onAction({ kind: 'research' })}>
              Find sources
            </ToolbarButton>
            <span className="mx-0.5 h-4 w-px bg-[var(--border-strong)]" />
            <ToolbarButton onClick={() => setMode('ask')}>Ask…</ToolbarButton>
            <ToolbarButton onClick={() => setMode('note')}>Note</ToolbarButton>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-2.5 py-1 text-xs font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--text)]"
    >
      {children}
    </button>
  );
}
