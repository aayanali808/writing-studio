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
