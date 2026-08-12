import { Mark, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * The anchor for a margin comment.
 *
 * A mark rather than a stored position: ProseMirror maps marks through every
 * edit, so the highlight stays on its passage as you rewrite around it. A
 * character offset would drift the moment you typed above it.
 *
 * The mark holds only the comment's id — the note itself lives in Postgres, so
 * editing it doesn't rewrite the document, and the draft's JSON stays about the
 * writing.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      setComment: (id: string) => ReturnType;
      unsetComment: (id: string) => ReturnType;
    };
  }
}

export const CommentMark = Mark.create({
  name: 'comment',

  // Two notes can cover the same words without one replacing the other.
  excludes: '',

  // Typing at the very end of a commented passage shouldn't silently join it.
  inclusive: false,

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes) =>
          attributes.commentId
            ? { 'data-comment-id': attributes.commentId }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'studio-comment' }),
      0,
    ];
  },

  addCommands() {
    return {
      setComment:
        (id: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { commentId: id }),

      /**
       * Removes one comment's mark, leaving any others on the same words.
       *
       * `unsetMark` would strip every comment mark in range, which is why this
       * walks the document and removes only the matching one.
       */
      unsetComment:
        (id: string) =>
        ({ tr, state, dispatch }) => {
          const type = state.schema.marks[this.name];
          if (!type) return false;

          let found = false;

          state.doc.descendants((node, pos) => {
            if (!node.isText) return;

            for (const mark of node.marks) {
              if (mark.type === type && mark.attrs.commentId === id) {
                tr.removeMark(pos, pos + node.nodeSize, mark);
                found = true;
              }
            }
          });

          if (found && dispatch) dispatch(tr);
          return found;
        },
    };
  },
});

/**
 * Where a comment's mark currently sits, or null if the text it was on has
 * been deleted. That null is what makes a comment "orphaned" in the pane.
 */
export function findCommentRange(
  doc: ProseMirrorNode,
  id: string
): { from: number; to: number } | null {
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;

  doc.descendants((node, pos) => {
    if (!node.isText) return;

    for (const mark of node.marks) {
      if (mark.type.name === 'comment' && mark.attrs.commentId === id) {
        from = Math.min(from, pos);
        to = Math.max(to, pos + node.nodeSize);
      }
    }
  });

  return Number.isFinite(from) ? { from, to } : null;
}
