import type { DocNode } from '@/types';

/**
 * A small Markdown reader for Claude's replies.
 *
 * Claude answers in Markdown whether or not you ask it to, and the panes were
 * showing the raw syntax. Rather than add a renderer dependency, this parses
 * the subset that actually turns up in prose feedback — headings, lists,
 * quotes, code, tables, inline emphasis — into a small AST.
 *
 * The AST has two consumers, which is the reason it exists rather than a
 * markdown-to-HTML function: `<Markdown>` renders it to React for the panes,
 * and `markdownToDoc` renders it to TipTap JSON so Replace and Insert below put
 * *formatted* prose into the draft instead of literal asterisks. One parser,
 * two outputs, and they cannot drift apart.
 *
 * Nothing here ever turns source text into HTML, so model output cannot inject
 * markup — the React renderer only emits the elements enumerated below.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; content: Inline[] }
  | { type: 'em'; content: Inline[] }
  | { type: 'strike'; content: Inline[] }
  | { type: 'link'; href: string; content: Inline[] };

export type Block =
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'heading'; level: number; content: Inline[] }
  | { type: 'quote'; content: Block[] }
  | { type: 'code'; text: string; language?: string }
  | { type: 'list'; ordered: boolean; start?: number; items: Block[][] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'rule' };

// --- Block-level patterns ---------------------------------------------------

const RULE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*(\S*)\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TABLE_DIVIDER = /^ {0,3}\|?(?:\s*:?-{1,}:?\s*\|)+\s*:?-{1,}:?\s*\|?\s*$/;

export function parseMarkdown(source: string): Block[] {
  // Tabs are only ever indentation in this subset, and normalising them here
  // means every indent comparison below can just count spaces.
  const lines = source.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  return parseBlocks(lines);
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Whether a line would open a block, used to end paragraphs and list items. */
function startsBlock(line: string): boolean {
  return (
    RULE.test(line) ||
    HEADING.test(line) ||
    FENCE.test(line) ||
    QUOTE.test(line) ||
    matchItem(line) !== null
  );
}

interface ItemMatch {
  indent: number;
  ordered: boolean;
  start: number;
  /** Column the item's own content begins at, for dedenting its body. */
  contentIndent: number;
  text: string;
}

function matchItem(line: string): ItemMatch | null {
  if (RULE.test(line)) return null;

  const bullet = /^( *)([-*+])( +)(.*)$/.exec(line);
  if (bullet) {
    return {
      indent: bullet[1].length,
      ordered: false,
      start: 1,
      contentIndent: bullet[1].length + 1 + bullet[3].length,
      text: bullet[4],
    };
  }

  const ordered = /^( *)(\d{1,9})([.)])( +)(.*)$/.exec(line);
  if (ordered) {
    return {
      indent: ordered[1].length,
      ordered: true,
      start: Number(ordered[2]),
      contentIndent:
        ordered[1].length + ordered[2].length + 1 + ordered[4].length,
      text: ordered[5],
    };
  }

  return null;
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const closing = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`);
      const body: string[] = [];

      i += 1;
      while (i < lines.length && !closing.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // Step over the closing fence (or past the end, unterminated).

      blocks.push({
        type: 'code',
        text: body.join('\n'),
        language: fence[2] || undefined,
      });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        content: parseInline(heading[2]),
      });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length) {
        const match = QUOTE.exec(lines[i]);
        if (match) {
          quoted.push(match[1]);
          i += 1;
          continue;
        }
        // Lazy continuation: an unmarked line still belongs to the quote.
        if (lines[i].trim() && !startsBlock(lines[i])) {
          quoted.push(lines[i]);
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: 'quote', content: parseBlocks(quoted) });
      continue;
    }

    if (matchItem(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    if (line.includes('|') && TABLE_DIVIDER.test(lines[i + 1] ?? '')) {
      const { block, next } = parseTable(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    // A single newline inside a paragraph is a space, per Markdown.
    blocks.push({ type: 'paragraph', content: parseInline(paragraph.join(' ')) });
  }

  return blocks;
}

/**
 * Reads one list, including nested ones.
 *
 * Lines more indented than the marker's content column belong to the current
 * item; they are dedented and parsed recursively, which is what makes nesting
 * and multi-paragraph items work without a second code path.
 */
function parseList(lines: string[], start: number): { block: Block; next: number } {
  const first = matchItem(lines[start]) as ItemMatch;
  const { ordered, indent: baseIndent } = first;

  const items: string[][] = [];
  let current: string[] = [];
  let contentIndent = first.contentIndent;
  let i = start;

  const closeItem = () => {
    if (current.length) items.push(current);
    current = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const item = matchItem(line);

    // A marker at this level starts a sibling item — unless it switched
    // between bulleted and numbered, which starts a different list.
    if (item && item.indent <= baseIndent + 1) {
      if (item.ordered !== ordered && items.length + current.length > 0) break;
      closeItem();
      current = [item.text];
      contentIndent = item.contentIndent;
      i += 1;
      continue;
    }

    if (!line.trim()) {
      const next = lines[i + 1];
      const nextItem = next === undefined ? null : matchItem(next);
      const listContinues =
        next !== undefined &&
        (indentOf(next) >= contentIndent ||
          (nextItem !== null && nextItem.indent <= baseIndent + 1));

      if (!listContinues) break;
      current.push('');
      i += 1;
      continue;
    }

    if (indentOf(line) >= contentIndent) {
      current.push(line.slice(contentIndent));
      i += 1;
      continue;
    }

    // Lazy continuation: a wrapped line of the item's paragraph.
    if (current.length && current[current.length - 1].trim() && !startsBlock(line)) {
      current.push(line.trim());
      i += 1;
      continue;
    }

    break;
  }

  closeItem();

  return {
    block: {
      type: 'list',
      ordered,
      start: ordered && first.start !== 1 ? first.start : undefined,
      items: items.map(parseBlocks),
    },
    next: i,
  };
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function parseTable(lines: string[], start: number): { block: Block; next: number } {
  const header = splitRow(lines[start]).map(parseInline);
  const rows: Inline[][][] = [];

  let i = start + 2; // Skip the header and the `---|---` divider.
  while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
    rows.push(splitRow(lines[i]).map(parseInline));
    i += 1;
  }

  return { block: { type: 'table', header, rows }, next: i };
}

// --- Inline -----------------------------------------------------------------

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~>|]/;
const WORD = /[\p{L}\p{N}]/u;

/** Blocks `javascript:` and friends; anything not clearly safe becomes text. */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (/^[/#]/.test(trimmed)) return trimmed;
  // A bare domain or path with no scheme is fine as long as it has no colon
  // before the first slash, which is what would smuggle a scheme through.
  if (!/^[a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return null;
}

export function parseInline(input: string): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (buffer) {
      out.push({ type: 'text', text: buffer });
      buffer = '';
    }
  };

  const push = (node: Inline) => {
    flush();
    out.push(node);
  };

  while (i < input.length) {
    const rest = input.slice(i);
    const before = i > 0 ? input[i - 1] : '';
    let match: RegExpExecArray | null;

    if (rest[0] === '\\' && ESCAPABLE.test(rest[1] ?? '')) {
      buffer += rest[1];
      i += 2;
      continue;
    }

    if ((match = /^(`+)([\s\S]+?)\1(?!`)/.exec(rest))) {
      push({ type: 'code', text: match[2].trim() });
      i += match[0].length;
      continue;
    }

    // Images are rendered as plain links — the panes are too narrow for them
    // and an inserted image node would not round-trip into the draft.
    //
    // The destination allows one level of balanced parentheses, without which
    // a Wikipedia-style `.../Foo_(bar)` link loses its closing bracket.
    if (
      (match =
        /^!?\[([^\]]*)\]\(\s*(?:<([^>]*)>|((?:[^\s()]|\([^\s()]*\))*))\s*(?:"[^"]*")?\s*\)/.exec(
          rest
        ))
    ) {
      const destination = match[2] ?? match[3] ?? '';
      const href = safeHref(destination);
      const label = match[1] || destination;
      if (href) {
        push({ type: 'link', href, content: parseInline(label) });
      } else {
        buffer += label;
      }
      i += match[0].length;
      continue;
    }

    if ((match = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/.exec(rest))) {
      push({ type: 'link', href: match[1], content: [{ type: 'text', text: match[1] }] });
      i += match[0].length;
      continue;
    }

    const emphasis = matchEmphasis(rest, before, input, i);
    if (emphasis) {
      push(emphasis.node);
      i += emphasis.length;
      continue;
    }

    if ((match = /^https?:\/\/[^\s<>)\]]+[^\s<>)\].,;:!?'"]/.exec(rest))) {
      push({ type: 'link', href: match[0], content: [{ type: 'text', text: match[0] }] });
      i += match[0].length;
      continue;
    }

    buffer += input[i];
    i += 1;
  }

  flush();
  return out;
}

/**
 * Emphasis, longest delimiter first so `***x***` nests rather than mis-parsing.
 *
 * Underscore runs are only treated as emphasis at a word boundary, which is
 * what keeps `snake_case_names` intact.
 */
function matchEmphasis(
  rest: string,
  before: string,
  input: string,
  offset: number
): { node: Inline; length: number } | null {
  const patterns: { re: RegExp; wrap: (content: Inline[]) => Inline }[] = [
    {
      re: /^(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/,
      wrap: (content) => ({ type: 'strong', content: [{ type: 'em', content }] }),
    },
    {
      re: /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/,
      wrap: (content) => ({ type: 'strong', content }),
    },
    { re: /^(~~)(?=\S)([\s\S]*?\S)\1/, wrap: (content) => ({ type: 'strike', content }) },
    { re: /^(\*|_)(?=\S)([\s\S]*?\S)\1/, wrap: (content) => ({ type: 'em', content }) },
  ];

  for (const { re, wrap } of patterns) {
    const match = re.exec(rest);
    if (!match) continue;

    if (match[1][0] === '_') {
      const after = input[offset + match[0].length] ?? '';
      if (WORD.test(before) || WORD.test(after)) continue;
    }

    return { node: wrap(parseInline(match[2])), length: match[0].length };
  }

  return null;
}

// --- TipTap output ----------------------------------------------------------

function inlineToDoc(nodes: Inline[]): DocNode[] {
  const out: DocNode[] = [];

  const walk = (list: Inline[], marks: DocNode['marks']) => {
    for (const node of list) {
      switch (node.type) {
        case 'text':
          if (node.text) out.push({ type: 'text', text: node.text, marks });
          break;
        case 'code':
          out.push({
            type: 'text',
            text: node.text,
            marks: [...(marks ?? []), { type: 'code' }],
          });
          break;
        case 'strong':
          walk(node.content, [...(marks ?? []), { type: 'bold' }]);
          break;
        case 'em':
          walk(node.content, [...(marks ?? []), { type: 'italic' }]);
          break;
        case 'strike':
          walk(node.content, [...(marks ?? []), { type: 'strike' }]);
          break;
        case 'link':
          walk(node.content, [
            ...(marks ?? []),
            {
              type: 'link',
              attrs: {
                href: node.href,
                target: '_blank',
                rel: 'noopener noreferrer',
              },
            },
          ]);
          break;
      }
    }
  };

  walk(nodes, undefined);
  return out;
}

/** Flattens inline nodes to their text, for the places that can't hold marks. */
export function inlineToText(nodes: Inline[]): string {
  return nodes
    .map((node) =>
      node.type === 'text' || node.type === 'code'
        ? node.text
        : inlineToText(node.content)
    )
    .join('');
}

function blockToDoc(block: Block): DocNode[] {
  switch (block.type) {
    case 'paragraph': {
      const content = inlineToDoc(block.content);
      return content.length ? [{ type: 'paragraph', content }] : [];
    }
    case 'heading': {
      const content = inlineToDoc(block.content);
      return content.length
        ? [
            {
              type: 'heading',
              // The editor only styles h1–h3; deeper headings flatten into one.
              attrs: { level: Math.min(block.level, 3) },
              content,
            },
          ]
        : [];
    }
    case 'quote':
      return [{ type: 'blockquote', content: blocksToDoc(block.content) }];
    case 'code':
      return [
        {
          type: 'codeBlock',
          attrs: block.language ? { language: block.language } : undefined,
          content: block.text ? [{ type: 'text', text: block.text }] : undefined,
        },
      ];
    case 'list':
      return [
        {
          type: block.ordered ? 'orderedList' : 'bulletList',
          attrs: block.start ? { start: block.start } : undefined,
          content: block.items.map((item) => ({
            type: 'listItem',
            // A list item must hold at least one block for ProseMirror to
            // accept it, and an empty bullet is a legitimate thing to write.
            content: blocksToDoc(item).length
              ? blocksToDoc(item)
              : [{ type: 'paragraph' }],
          })),
        },
      ];
    case 'table':
      // StarterKit has no table nodes, so a table lands in the draft as one
      // line per row. Rare enough in prose feedback to not be worth more.
      return [block.header, ...block.rows].map((row) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: row.map(inlineToText).join(' — ') }],
      }));
    case 'rule':
      return [{ type: 'horizontalRule' }];
  }
}

function blocksToDoc(blocks: Block[]): DocNode[] {
  return blocks.flatMap(blockToDoc);
}

/** Renders Markdown to TipTap block nodes, ready for `insertContentAt`. */
export function markdownToDoc(source: string): DocNode[] {
  return blocksToDoc(parseMarkdown(source));
}
