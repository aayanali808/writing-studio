'use client';

import { useEffect, useState } from 'react';
import { useStudio } from '@/components/studio/StudioContext';

/**
 * Outline.
 *
 * A live table of contents built from the draft's headings. Clicking one moves
 * the cursor there and scrolls the Writing pane to it.
 *
 * The list is derived in the Writing pane whenever the document changes rather
 * than recomputed here, because that is the one place that already knows when
 * the document changed.
 */
export function OutlinePane() {
  const { outline, editor, title } = useStudio();

  // Which heading the cursor is currently under. Tracked here rather than in
  // shared state because nothing else needs it, and it changes on every
  // keystroke.
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (!editor) return;

    const update = () => setCursor(editor.state.selection.from);
    update();

    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor]);

  // The last heading at or above the cursor is the section it belongs to.
  let activeIndex = -1;
  outline.forEach((item, index) => {
    if (item.pos <= cursor) activeIndex = index;
  });

  const goTo = (pos: number) => {
    if (!editor) return;
    // `pos` is the heading node itself; +1 lands the cursor inside its text.
    editor
      .chain()
      .focus()
      .setTextSelection(Math.min(pos + 1, editor.state.doc.content.size))
      .scrollIntoView()
      .run();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="truncate text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
          {title || 'Untitled'}
        </span>
        {outline.length > 0 ? (
          <span className="shrink-0 text-[10px] text-[var(--text-faint)]">
            {outline.length}
          </span>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {outline.length === 0 ? (
          <p className="px-3 py-2 text-[11px] leading-relaxed text-[var(--text-faint)]">
            No headings yet. Use{' '}
            <span className="text-[var(--text-muted)]">Heading</span> or{' '}
            <span className="text-[var(--text-muted)]">Subheading</span> in the
            editor toolbar, or type <code>##</code> at the start of a line.
          </p>
        ) : null}

        {outline.map((item, index) => (
          <button
            key={`${item.pos}-${index}`}
            type="button"
            onClick={() => goTo(item.pos)}
            style={{ paddingLeft: `${0.75 + (item.level - 1) * 0.75}rem` }}
            className={`block w-full truncate border-l-2 py-1 pr-2 text-left text-xs transition-colors ${
              index === activeIndex
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
                : 'border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-inset)] hover:text-[var(--text)]'
            } ${item.level === 1 ? 'font-medium' : ''}`}
            title={item.text}
          >
            {item.text || <span className="italic opacity-60">Untitled</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
