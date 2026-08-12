'use client';

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useStudio } from '@/components/studio/StudioContext';
import type { Typography } from '@/types';

/**
 * The editor's formatting bar.
 *
 * Two different kinds of control share it, which is worth knowing when adding
 * to it: the block and mark buttons change the *document*, while the type
 * controls on the right change only how the document is *displayed* and are
 * stored as a local preference (see `typography` in StudioContext).
 */

const BLOCKS = [
  { id: 'paragraph', label: 'Body' },
  { id: 'h1', label: 'Title' },
  { id: 'h2', label: 'Heading' },
  { id: 'h3', label: 'Subheading' },
  { id: 'blockquote', label: 'Quote' },
  { id: 'bulletList', label: 'Bulleted' },
  { id: 'orderedList', label: 'Numbered' },
] as const;

type BlockId = (typeof BLOCKS)[number]['id'];

const FAMILIES: { id: Typography['family']; label: string }[] = [
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Mono' },
];

const SIZES = [14, 15, 16, 17, 18, 20, 22];
const WIDTHS = [
  { value: 34, label: 'Narrow' },
  { value: 46, label: 'Regular' },
  { value: 58, label: 'Wide' },
  { value: 200, label: 'Full' },
];

export function EditorToolbar({ editor }: { editor: Editor }) {
  const { typography, setTypography } = useStudio();

  // TipTap mutates its state in place, so React has no way to know a mark was
  // toggled or the cursor entered a heading. This subscribes to the editor's
  // own transactions and forces the re-render that keeps the buttons honest.
  const [, bump] = useState(0);
  useEffect(() => {
    const rerender = () => bump((count) => count + 1);
    editor.on('transaction', rerender);
    return () => {
      editor.off('transaction', rerender);
    };
  }, [editor]);

  const activeBlock = currentBlock(editor);

  const applyBlock = (id: BlockId) => {
    const chain = editor.chain().focus();

    switch (id) {
      case 'paragraph':
        // Lists have to be lifted out of explicitly; clearing the node type
        // alone would leave the paragraph inside its list item.
        chain.liftListItem('listItem');
        chain.setParagraph();
        break;
      case 'h1':
      case 'h2':
      case 'h3':
        chain.liftListItem('listItem');
        chain.setHeading({ level: Number(id[1]) as 1 | 2 | 3 });
        break;
      case 'blockquote':
        chain.toggleBlockquote();
        break;
      case 'bulletList':
        chain.toggleBulletList();
        break;
      case 'orderedList':
        chain.toggleOrderedList();
        break;
    }

    chain.run();
  };

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-[var(--border)] px-8 py-1.5">
      <Select
        value={activeBlock}
        onChange={(value) => applyBlock(value as BlockId)}
        options={BLOCKS.map((block) => ({ value: block.id, label: block.label }))}
        title="Paragraph style"
        className="w-[7.5rem]"
      />

      <Divider />

      <MarkButton
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold  (⌘B)"
      >
        <span className="font-semibold">B</span>
      </MarkButton>
      <MarkButton
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic  (⌘I)"
      >
        <span className="italic">I</span>
      </MarkButton>
      <MarkButton
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
      >
        <span className="line-through">S</span>
      </MarkButton>
      <MarkButton
        active={editor.isActive('code')}
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="Inline code"
      >
        <span className="font-mono text-[11px]">{'<>'}</span>
      </MarkButton>

      <div className="ml-auto flex items-center gap-1">
        <Select
          value={typography.family}
          onChange={(value) =>
            setTypography({ family: value as Typography['family'] })
          }
          options={FAMILIES.map((font) => ({ value: font.id, label: font.label }))}
          title="Typeface"
          className="w-[4.5rem]"
        />
        <Select
          value={String(typography.size)}
          onChange={(value) => setTypography({ size: Number(value) })}
          options={SIZES.map((size) => ({
            value: String(size),
            label: `${size}px`,
          }))}
          title="Text size"
          className="w-[4.25rem]"
        />
        <Select
          value={String(typography.width)}
          onChange={(value) => setTypography({ width: Number(value) })}
          options={WIDTHS.map((width) => ({
            value: String(width.value),
            label: width.label,
          }))}
          title="Line width"
          className="w-[5.25rem]"
        />
      </div>
    </div>
  );
}

/** The paragraph style the cursor currently sits in. */
function currentBlock(editor: Editor): BlockId {
  if (editor.isActive('bulletList')) return 'bulletList';
  if (editor.isActive('orderedList')) return 'orderedList';
  if (editor.isActive('blockquote')) return 'blockquote';
  if (editor.isActive('heading', { level: 1 })) return 'h1';
  if (editor.isActive('heading', { level: 2 })) return 'h2';
  if (editor.isActive('heading', { level: 3 })) return 'h3';
  return 'paragraph';
}

function Select({
  value,
  onChange,
  options,
  title,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  title: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      title={title}
      aria-label={title}
      className={`cursor-pointer rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-[var(--text-muted)] outline-none transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] focus:border-[var(--accent)] ${className ?? ''}`}
    >
      {options.map((option) => (
        <option
          key={option.value}
          value={option.value}
          className="bg-[var(--bg-raised)] text-[var(--text)]"
        >
          {option.label}
        </option>
      ))}
    </select>
  );
}

function MarkButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`h-6 w-6 rounded text-xs transition-colors ${
        active
          ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
          : 'text-[var(--text-muted)] hover:bg-[var(--bg-inset)] hover:text-[var(--text)]'
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-4 w-px bg-[var(--border)]" />;
}
