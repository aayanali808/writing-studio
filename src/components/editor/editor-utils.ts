import type { Editor } from '@tiptap/react';
import { markdownToDoc } from '@/lib/markdown';
import type { DocNode, EditorSelection } from '@/types';

/**
 * Helpers for writing AI output back into the draft.
 *
 * All of them work from the selection range captured when the request was made,
 * so clicking around while an answer streams doesn't move the target.
 */

/**
 * Reads the current selection along with the block it sits in and its
 * immediate neighbours.
 *
 * That surrounding text is what lets highlight-to-ask answer about a fragment
 * without the model having to guess at the sentence it belongs to.
 */
export function readSelection(editor: Editor): EditorSelection | null {
  const { state } = editor;
  const { from, to, empty } = state.selection;

  if (empty) return null;

  const text = state.doc.textBetween(from, to, '\n', ' ').trim();
  if (!text) return null;

  return { text, surrounding: readSurrounding(editor, from, to), from, to };
}

/** The top-level block containing the selection, plus one block either side. */
function readSurrounding(editor: Editor, from: number, to: number): string {
  const { doc } = editor.state;

  try {
    const first = Math.max(0, doc.resolve(from).index(0) - 1);
    const last = Math.min(doc.childCount - 1, doc.resolve(to).index(0) + 1);

    const blocks: string[] = [];
    for (let i = first; i <= last; i += 1) {
      const block = doc.child(i).textContent.trim();
      if (block) blocks.push(block);
    }

    return blocks.join('\n\n');
  } catch {
    // Resolving can throw if the document shifted underneath us; the selection
    // text on its own is still enough to ask about.
    return '';
  }
}

/** Clamps a stored position to the document as it stands now. */
function clamp(editor: Editor, position: number): number {
  return Math.max(0, Math.min(position, editor.state.doc.content.size));
}

/**
 * Swaps the original selection for the answer.
 *
 * The answer is read as Markdown, because Claude writes Markdown whether or not
 * it was asked to — inserting it verbatim used to leave literal `**asterisks**`
 * in the draft.
 *
 * Answers that are a single paragraph go in as inline content rather than as a
 * paragraph node. Inserting a block node mid-paragraph makes ProseMirror split
 * the paragraph around it, so rewriting one sentence used to leave the rest of
 * its paragraph orphaned below — not what "replace this sentence" should do.
 * Anything richer still comes through as blocks, since there the split is the
 * point.
 */
export function replaceRange(
  editor: Editor,
  selection: EditorSelection,
  text: string
): void {
  const from = clamp(editor, selection.from);
  const to = clamp(editor, selection.to);

  const blocks = markdownToDoc(text);
  if (!blocks.length) return;

  const spansBlocks =
    editor.state.doc.resolve(from).parent !== editor.state.doc.resolve(to).parent;

  const inline =
    blocks.length === 1 && blocks[0].type === 'paragraph' ? blocks[0].content : null;

  const content: DocNode[] = inline && !spansBlocks ? inline : blocks;

  editor.chain().focus().insertContentAt({ from, to }, content).run();
}

/** Adds the answer as new blocks after the selection, leaving it intact. */
export function insertAfterRange(
  editor: Editor,
  selection: EditorSelection,
  text: string
): void {
  const to = clamp(editor, selection.to);

  const blocks = markdownToDoc(text);
  if (!blocks.length) return;

  // `after()` resolves to the position just past the block the selection ends
  // in, which is where a sibling paragraph belongs.
  let position: number;
  try {
    position = editor.state.doc.resolve(to).after();
  } catch {
    position = to;
  }

  editor.chain().focus().insertContentAt(position, blocks).run();
}

/** Drops a formatted, linked reference at the cursor. */
export function insertCitation(
  editor: Editor,
  title: string,
  url: string
): void {
  editor
    .chain()
    .focus()
    .insertContent([
      { type: 'text', text: ' (' },
      {
        type: 'text',
        text: title,
        marks: [
          {
            type: 'link',
            attrs: { href: url, target: '_blank', rel: 'noopener noreferrer' },
          },
        ],
      },
      { type: 'text', text: ')' },
    ])
    .run();
}
