/** A TipTap/ProseMirror node, as stored in `documents.content`. */
export interface DocNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: DocNode[];
}

export const EMPTY_DOC: DocNode = { type: 'doc', content: [] };

export interface Document {
  id: string;
  title: string;
  content: DocNode;
  plain_text: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentSummary {
  id: string;
  title: string;
  updated_at: string;
}

export interface Source {
  id: string;
  provider: string;
  external_id: string;
  title: string;
  url: string | null;
  content_cache: string;
  last_synced: string;
}

/** A source row plus whether it is pinned into the current document. */
export interface SourceWithPin extends Source {
  pinned: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

/** One web result returned by the research agent. */
export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
}

/**
 * One turn of a conversation held inside an AI output pane.
 *
 * The ask popover and the research pane both let you write back rather than
 * only read, so each result carries its own thread. `[assistant, user,
 * assistant, …]` — the opening user turn is implicit, rebuilt server-side from
 * the highlighted passage, so it never has to survive a round trip.
 */
export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ResearchResult {
  id: string;
  claim: string;
  /** Kept so follow-up questions can be answered against the same passage. */
  surrounding: string;
  turns: Turn[];
  sources: ResearchSource[];
  /** True while a follow-up on this thread is in flight. */
  pending: boolean;
  error: string | null;
  createdAt: string;
}

export type PaneId =
  | 'writing'
  | 'outline'
  | 'chat'
  | 'sources'
  | 'goals'
  | 'research';

/** Titles are also the source of truth for which panes the workspace offers. */
export const PANE_TITLES: Record<PaneId, string> = {
  writing: 'Writing',
  outline: 'Outline',
  chat: 'AI Chat',
  sources: 'Sources',
  goals: 'Goals',
  research: 'Research Results',
};

/** One heading in the draft, as shown in the Outline pane. */
export interface OutlineItem {
  /** ProseMirror position of the heading node, for scrolling to it. */
  pos: number;
  level: number;
  text: string;
}

/** Reading preferences for the editor surface. Not part of the document. */
export interface Typography {
  family: 'serif' | 'sans' | 'mono';
  /** Base font size in px. */
  size: number;
  /** Measure — the max line length, in rem. */
  width: number;
}

/** Matches what the editor looked like before the font menu existed. */
export const DEFAULT_TYPOGRAPHY: Typography = {
  family: 'sans',
  size: 17,
  width: 46,
};

export const FONT_STACKS: Record<Typography['family'], string> = {
  serif: "'Iowan Old Style', 'Palatino', Georgia, ui-serif, serif",
  sans: 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif',
  mono: 'var(--font-geist-mono), ui-monospace, monospace',
};

/** The current TipTap selection, mirrored into shared studio state. */
export interface EditorSelection {
  text: string;
  /** The paragraph(s) the selection sits inside, for surrounding context. */
  surrounding: string;
  from: number;
  to: number;
}
