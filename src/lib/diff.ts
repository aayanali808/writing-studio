/**
 * Word-level diffing, for showing what a rewrite actually changed.
 *
 * "Improve this passage" otherwise asks you to eyeball two blocks of prose and
 * trust that only what you wanted to change did. On a paragraph the difference
 * is often three words, and those three words are the whole decision.
 *
 * Words rather than characters: a character diff of prose produces confetti,
 * highlighting the shared letters inside two different words.
 */

export type DiffOp = 'keep' | 'insert' | 'delete';

export interface DiffPart {
  op: DiffOp;
  text: string;
}

/**
 * Above this many tokens on either side the O(n·m) table stops being free.
 * A passage that long is a restructure, not an edit, and the diff would be
 * unreadable anyway — so it's skipped rather than made slow.
 */
const MAX_TOKENS = 1_500;

/**
 * Splits into words *and* the whitespace between them, so the parts can be
 * concatenated back into the original text exactly.
 */
function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/** True when a token is only whitespace. */
function isGap(token: string): boolean {
  return /^\s+$/.test(token);
}

/**
 * Longest common subsequence over tokens, walked back into a run of edits.
 *
 * Returns null when either side is too long to be worth the table — callers
 * treat that as "no diff available" rather than showing something misleading.
 */
export function diffWords(before: string, after: string): DiffParts | null {
  const a = tokenize(before);
  const b = tokenize(after);

  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null;

  // lengths[i][j] = LCS length of a[i..] and b[j..].
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        a[i] === b[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];

  const push = (op: DiffOp, text: string) => {
    const last = parts[parts.length - 1];
    // Merge runs so the renderer emits one span per change, not one per word.
    if (last && last.op === op) last.text += text;
    else parts.push({ op, text });
  };

  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('keep', a[i]);
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      push('delete', a[i]);
      i += 1;
    } else {
      push('insert', b[j]);
      j += 1;
    }
  }

  while (i < a.length) {
    push('delete', a[i]);
    i += 1;
  }
  while (j < b.length) {
    push('insert', b[j]);
    j += 1;
  }

  return summarise(parts);
}

export interface DiffParts {
  parts: DiffPart[];
  /** Words added and removed, for the "3 added, 5 removed" line. */
  added: number;
  removed: number;
  /** True when the two texts are identical. */
  unchanged: boolean;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function summarise(parts: DiffPart[]): DiffParts {
  let added = 0;
  let removed = 0;

  for (const part of parts) {
    if (part.op === 'insert') added += countWords(part.text);
    if (part.op === 'delete') removed += countWords(part.text);
  }

  return {
    // Whitespace-only changes are noise in a rendered diff — a paragraph that
    // only re-wrapped would light up end to end for no reason.
    parts: parts.filter((part) => part.op === 'keep' || !isGap(part.text)),
    added,
    removed,
    unchanged: added === 0 && removed === 0,
  };
}
