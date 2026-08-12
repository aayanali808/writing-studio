import type { DocNode } from '@/types';

/** Block-level node types that should produce a line break in plain text. */
const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'listItem',
  'horizontalRule',
]);

/**
 * Flattens a TipTap JSON document to plain text.
 *
 * This is what the Context Bundle sends to Claude — the model doesn't need
 * ProseMirror's node structure, and sending the raw JSON would waste a large
 * number of tokens on syntax.
 */
export function docToPlainText(doc: DocNode | null | undefined): string {
  if (!doc) return '';

  const lines: string[] = [];
  let current = '';

  const walk = (node: DocNode): void => {
    if (node.type === 'text' && node.text) {
      current += node.text;
      return;
    }

    if (node.type === 'hardBreak') {
      current += '\n';
      return;
    }

    node.content?.forEach(walk);

    if (node.type && BLOCK_TYPES.has(node.type)) {
      lines.push(current.trimEnd());
      current = '';
    }
  };

  walk(doc);
  if (current.trim()) lines.push(current.trimEnd());

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// --- Markdown out -----------------------------------------------------------

/**
 * Serialises a TipTap document to Markdown.
 *
 * The exact inverse of `markdownToDoc` in `lib/markdown.ts`, and deliberately
 * limited to the same node set: what this writes, that can read back. Export is
 * the point — a piece shouldn't only exist inside this app's database.
 */

/** Characters that would otherwise be read back as markup. */
function escapeInline(text: string): string {
  return text.replace(/([\\`*[\]])/g, '\\$1');
}

/** A paragraph opening with a marker character would parse as another block. */
function escapeLineStart(text: string): string {
  return text.replace(/^(\s*)(#{1,6}\s|[-*+]\s|>\s|\d{1,9}[.)]\s)/, '$1\\$2');
}

const MARK_WRAPPERS: Record<string, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
};

function inlineToMarkdown(nodes: DocNode[] | undefined): string {
  if (!nodes) return '';

  return nodes
    .map((node) => {
      if (node.type === 'hardBreak') return '  \n';
      if (node.type !== 'text' || !node.text) return '';

      const marks = node.marks ?? [];

      // Code is innermost: its content is literal, so escaping would show up
      // verbatim inside the backticks.
      const isCode = marks.some((mark) => mark.type === 'code');
      let text = isCode ? `\`${node.text}\`` : escapeInline(node.text);

      for (const mark of marks) {
        const wrapper = MARK_WRAPPERS[mark.type];
        if (wrapper) text = `${wrapper}${text}${wrapper}`;
      }

      // A link wraps everything else.
      const link = marks.find((mark) => mark.type === 'link');
      if (link) {
        const href = String(link.attrs?.href ?? '');
        if (href) text = `[${text}](${href})`;
      }

      return text;
    })
    .join('');
}

function blockToMarkdown(node: DocNode): string[] {
  switch (node.type) {
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
      return [`${'#'.repeat(level)} ${inlineToMarkdown(node.content)}`];
    }

    case 'paragraph':
      return [escapeLineStart(inlineToMarkdown(node.content))];

    case 'codeBlock': {
      const language = node.attrs?.language ? String(node.attrs.language) : '';
      const body = (node.content ?? []).map((child) => child.text ?? '').join('');
      return [`\`\`\`${language}`, ...body.split('\n'), '```'];
    }

    case 'blockquote':
      return blocksToMarkdown(node.content, '').map((line) =>
        line ? `> ${line}` : '>'
      );

    case 'horizontalRule':
      return ['---'];

    case 'bulletList':
    case 'orderedList': {
      const ordered = node.type === 'orderedList';
      const start = Number(node.attrs?.start) || 1;
      const lines: string[] = [];

      (node.content ?? []).forEach((item, index) => {
        const marker = ordered ? `${start + index}. ` : '- ';
        // Continuation lines are indented to the marker's own width, which is
        // exactly what the reader treats as belonging to the item.
        const body = blocksToMarkdown(item.content, ' '.repeat(marker.length));

        body.forEach((line, lineIndex) => {
          if (lineIndex === 0) {
            lines.push(marker + line.trimStart());
          } else {
            lines.push(line);
          }
        });
      });

      return lines;
    }

    // listItem is handled by its parent; anything unknown falls back to text.
    default:
      return node.content ? blocksToMarkdown(node.content, '') : [];
  }
}

function blocksToMarkdown(
  nodes: DocNode[] | undefined,
  indent: string
): string[] {
  const out: string[] = [];

  (nodes ?? []).forEach((node, index) => {
    if (index > 0) out.push('');
    for (const line of blockToMarkdown(node)) {
      out.push(line ? indent + line : '');
    }
  });

  return out;
}

export function docToMarkdown(doc: DocNode | null | undefined): string {
  if (!doc) return '';
  return blocksToMarkdown(doc.content, '').join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Rough word count, used for the writing pane's status line. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Truncates text to a character budget, keeping the beginning and the end.
 *
 * Long drafts are trimmed from the middle rather than the tail so the model
 * still sees how the piece currently ends — usually where the writer is working.
 */
export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const headSize = Math.floor(maxChars * 0.6);
  const tailSize = maxChars - headSize;

  return (
    text.slice(0, headSize) +
    `\n\n[... ${text.length - maxChars} characters omitted from the middle ...]\n\n` +
    text.slice(text.length - tailSize)
  );
}
