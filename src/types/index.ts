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

export interface ResearchResult {
  id: string;
  claim: string;
  summary: string;
  sources: ResearchSource[];
  createdAt: string;
}

export type PaneId = 'writing' | 'chat' | 'sources' | 'goals' | 'research';

/** Titles are also the source of truth for which panes the workspace offers. */
export const PANE_TITLES: Record<PaneId, string> = {
  writing: 'Writing',
  chat: 'AI Chat',
  sources: 'Sources',
  goals: 'Goals',
  research: 'Research Results',
};

/** The current TipTap selection, mirrored into shared studio state. */
export interface EditorSelection {
  text: string;
  /** The paragraph(s) the selection sits inside, for surrounding context. */
  surrounding: string;
  from: number;
  to: number;
}
