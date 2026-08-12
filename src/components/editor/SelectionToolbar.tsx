'use client';

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { EditorSelection } from '@/types';

export type ToolbarAction =
  | { kind: 'improve' }
  | { kind: 'explain' }
  | { kind: 'research' }
  | { kind: 'custom'; prompt: string };

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
  const [asking, setAsking] = useState(false);
  const [prompt, setPrompt] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (asking) inputRef.current?.focus();
  }, [asking]);

  // Note: the parent remounts this component (keyed on the selection range)
  // whenever the selection moves, which resets `asking` and `prompt` without
  // needing an effect to clear them.

  if (!position) return null;

  const submitCustom = () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    onAction({ kind: 'custom', prompt: trimmed });
    setAsking(false);
    setPrompt('');
  };

  return (
    <div
      className="absolute z-30 -translate-x-1/2 -translate-y-full"
      style={{ top: position.top, left: position.left }}
      // Keep the editor selection alive when the toolbar is clicked.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex items-center gap-0.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-raised)] p-1 shadow-xl">
        {asking ? (
          <>
            <input
              ref={inputRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitCustom();
                }
                if (event.key === 'Escape') setAsking(false);
              }}
              placeholder="Ask about this…"
              className="w-64 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-[var(--text-faint)]"
            />
            <ToolbarButton onClick={submitCustom}>Send</ToolbarButton>
          </>
        ) : (
          <>
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
            <ToolbarButton onClick={() => setAsking(true)}>Ask…</ToolbarButton>
          </>
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
