'use client';

import type { Editor } from '@tiptap/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useDebouncedSave, type SaveStatus } from '@/hooks/use-debounced-save';
import { apiJson } from '@/lib/client';
import {
  getServerTypography,
  getTypography,
  subscribeTypography,
  writeTypography,
} from '@/lib/typography-store';
import type {
  Comment,
  Document,
  DocNode,
  EditorSelection,
  OutlineItem,
  ResearchResult,
  SourceWithPin,
  Typography,
} from '@/types';

interface ProviderInfo {
  id: string;
  label: string;
  configured: boolean;
}

interface StudioValue {
  documentId: string;

  // --- Draft ---------------------------------------------------------------
  title: string;
  setTitle: (title: string) => void;
  saveStatus: SaveStatus;
  /** Queues a debounced autosave of the title and/or body. */
  scheduleSave: (patch: { title?: string; content?: DocNode }) => void;
  /**
   * Writes any pending autosave and waits for it to land.
   *
   * Every AI call awaits this first: the Context Bundle is assembled
   * server-side from the database, so an unflushed keystroke would mean Claude
   * answers against a stale version of the piece.
   */
  flushSave: () => Promise<void>;

  // --- Editor handle -------------------------------------------------------
  editor: Editor | null;
  setEditor: (editor: Editor | null) => void;
  selection: EditorSelection | null;
  setSelection: (selection: EditorSelection | null) => void;

  /** The draft's headings, in document order. Feeds the Outline pane. */
  outline: OutlineItem[];
  setOutline: (outline: OutlineItem[]) => void;

  /** How the editor surface is displayed. A preference, not document data. */
  typography: Typography;
  setTypography: (patch: Partial<Typography>) => void;

  // --- Goals ---------------------------------------------------------------
  goals: string;
  setGoals: (goals: string) => void;
  goalsStatus: SaveStatus;

  // --- Sources -------------------------------------------------------------
  sources: SourceWithPin[];
  providers: ProviderInfo[];
  sourcesBusy: boolean;
  sourcesError: string | null;
  refreshSources: () => Promise<void>;
  syncSources: (searchTerm?: string) => Promise<void>;
  togglePin: (sourceId: string, pinned: boolean) => Promise<void>;
  /**
   * Caches a web page and pins it in one step.
   *
   * The research agent hands back URLs, not cached sources, so pinning one has
   * to create it first. Returns an error message, or null on success.
   */
  pinUrl: (url: string, title: string) => Promise<string | null>;

  // --- Comments ------------------------------------------------------------
  comments: Comment[];
  setComments: (update: (current: Comment[]) => Comment[]) => void;
  refreshComments: () => Promise<void>;
  /** Writes a note and anchors it to the current selection. */
  addComment: (body: string, quote: string) => Promise<string | null>;

  // --- Research ------------------------------------------------------------
  research: ResearchResult[];
  addResearch: (result: ResearchResult) => void;
  /** Applied to one thread — follow-ups append turns to a result in place. */
  updateResearch: (id: string, patch: Partial<ResearchResult>) => void;
  clearResearch: () => void;
  researchBusy: boolean;
  setResearchBusy: (busy: boolean) => void;

  /** Brings a pane forward, adding it back if it was closed. */
  focusPane: (paneId: string) => void;
  registerFocusHandler: (handler: (paneId: string) => void) => void;
}

const StudioContext = createContext<StudioValue | null>(null);

export function useStudio(): StudioValue {
  const value = useContext(StudioContext);
  if (!value) {
    throw new Error('useStudio must be used inside <StudioProvider>');
  }
  return value;
}

export function StudioProvider({
  document,
  initialGoals,
  children,
}: {
  document: Document;
  initialGoals: string;
  children: React.ReactNode;
}) {
  const documentId = document.id;

  // --- Draft ---------------------------------------------------------------
  const [title, setTitleState] = useState(document.title);

  // The debounced saver holds one pending value, so we keep the latest of each
  // field here and always send both. That way a title edit landing on top of a
  // body edit can't drop the body.
  const titleRef = useRef(document.title);
  const contentRef = useRef<DocNode>(document.content);

  const draftSave = useDebouncedSave<{ title: string; content: DocNode }>({
    save: async (patch) => {
      await apiJson(`/api/documents/${documentId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
    },
  });

  const { schedule: scheduleDraft, flush: flushSave, status: saveStatus } = draftSave;

  const scheduleSave = useCallback(
    (patch: { title?: string; content?: DocNode }) => {
      if (patch.title !== undefined) titleRef.current = patch.title;
      if (patch.content !== undefined) contentRef.current = patch.content;

      scheduleDraft({ title: titleRef.current, content: contentRef.current });
    },
    [scheduleDraft]
  );

  const setTitle = useCallback(
    (next: string) => {
      setTitleState(next);
      scheduleSave({ title: next });
    },
    [scheduleSave]
  );

  // --- Editor handle -------------------------------------------------------
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);

  // --- Typography ----------------------------------------------------------
  // Kept in localStorage rather than in the database: it's how *this* screen
  // should look, not a property of the piece. See `lib/typography-store`.
  const typography = useSyncExternalStore(
    subscribeTypography,
    getTypography,
    getServerTypography
  );

  const setTypography = useCallback((patch: Partial<Typography>) => {
    writeTypography(patch);
  }, []);

  // --- Goals ---------------------------------------------------------------
  const [goals, setGoalsState] = useState(initialGoals);

  const goalsSave = useDebouncedSave<string>({
    save: async (content) => {
      await apiJson(`/api/documents/${documentId}/goals`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      });
    },
  });

  const { schedule: scheduleGoals, status: goalsStatus } = goalsSave;

  const setGoals = useCallback(
    (next: string) => {
      setGoalsState(next);
      scheduleGoals(next);
    },
    [scheduleGoals]
  );

  // --- Sources -------------------------------------------------------------
  const [sources, setSources] = useState<SourceWithPin[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [sourcesBusy, setSourcesBusy] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);

  const refreshSources = useCallback(async () => {
    try {
      const data = await apiJson<{
        sources: SourceWithPin[];
        providers: ProviderInfo[];
      }>(`/api/documents/${documentId}/sources`);
      setSources(data.sources);
      setProviders(data.providers);
      setSourcesError(null);
    } catch (error) {
      setSourcesError(
        error instanceof Error ? error.message : 'Failed to load sources'
      );
    }
  }, [documentId]);

  /**
   * With a search term, queries the providers live; without one, re-pulls the
   * whole catalogue. Either way the cached rows come back annotated with pins.
   */
  const syncSources = useCallback(
    async (searchTerm?: string) => {
      setSourcesBusy(true);
      setSourcesError(null);

      const term = searchTerm?.trim();
      const url = `/api/documents/${documentId}/sources`;

      try {
        const data = term
          ? await apiJson<{ sources: SourceWithPin[] }>(
              `${url}?q=${encodeURIComponent(term)}`
            )
          : await apiJson<{ sources: SourceWithPin[] }>(url, { method: 'POST' });
        setSources(data.sources);
      } catch (error) {
        setSourcesError(error instanceof Error ? error.message : 'Sync failed');
      } finally {
        setSourcesBusy(false);
      }
    },
    [documentId]
  );

  const togglePin = useCallback(
    async (sourceId: string, pinned: boolean) => {
      // Optimistic — pinning also pulls the body server-side, which is slow.
      setSources((current) =>
        current.map((source) =>
          source.id === sourceId ? { ...source, pinned } : source
        )
      );

      try {
        const data = pinned
          ? await apiJson<{ sources: SourceWithPin[] }>(
              `/api/documents/${documentId}/pins`,
              { method: 'POST', body: JSON.stringify({ sourceId }) }
            )
          : await apiJson<{ sources: SourceWithPin[] }>(
              `/api/documents/${documentId}/pins?sourceId=${sourceId}`,
              { method: 'DELETE' }
            );
        setSources(data.sources);
      } catch (error) {
        setSourcesError(error instanceof Error ? error.message : 'Pin failed');
        await refreshSources();
      }
    },
    [documentId, refreshSources]
  );

  const pinUrl = useCallback(
    async (url: string, title: string): Promise<string | null> => {
      try {
        const data = await apiJson<{
          sources: SourceWithPin[];
          warning: string | null;
        }>(`/api/documents/${documentId}/pins`, {
          method: 'POST',
          body: JSON.stringify({ url, title }),
        });

        setSources(data.sources);
        // The pin stands even when the page couldn't be read; say so rather
        // than reporting success for a source with no text in it.
        return data.warning;
      } catch (error) {
        return error instanceof Error ? error.message : 'Could not pin that page';
      }
    },
    [documentId]
  );

  useEffect(() => {
    let cancelled = false;

    // Awaited before any setState so the updates don't run synchronously
    // inside the effect, and late responses are dropped after unmount.
    (async () => {
      try {
        const data = await apiJson<{
          sources: SourceWithPin[];
          providers: ProviderInfo[];
        }>(`/api/documents/${documentId}/sources`);

        if (cancelled) return;
        setSources(data.sources);
        setProviders(data.providers);
      } catch (error) {
        if (cancelled) return;
        setSourcesError(
          error instanceof Error ? error.message : 'Failed to load sources'
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // --- Comments ------------------------------------------------------------
  const [comments, setCommentsState] = useState<Comment[]>([]);

  const setComments = useCallback(
    (update: (current: Comment[]) => Comment[]) => setCommentsState(update),
    []
  );

  const refreshComments = useCallback(async () => {
    const data = await apiJson<{ comments: Comment[] }>(
      `/api/documents/${documentId}/comments`
    );
    setCommentsState(data.comments);
  }, [documentId]);

  /**
   * Creates the note, then returns its id so the caller can anchor the mark.
   *
   * The row has to exist first: the mark in the document carries the row's id,
   * and that link is what keeps the highlight on its passage through edits.
   */
  const addComment = useCallback(
    async (body: string, quote: string): Promise<string | null> => {
      try {
        const data = await apiJson<{ comment: Comment }>(
          `/api/documents/${documentId}/comments`,
          { method: 'POST', body: JSON.stringify({ body, quote }) }
        );
        setCommentsState((current) => [data.comment, ...current]);
        return data.comment.id;
      } catch {
        return null;
      }
    },
    [documentId]
  );

  // --- Research ------------------------------------------------------------
  const [research, setResearch] = useState<ResearchResult[]>([]);
  const [researchBusy, setResearchBusy] = useState(false);

  const addResearch = useCallback((result: ResearchResult) => {
    setResearch((current) => [result, ...current]);
  }, []);

  const updateResearch = useCallback(
    (id: string, patch: Partial<ResearchResult>) => {
      setResearch((current) =>
        current.map((result) =>
          result.id === id ? { ...result, ...patch } : result
        )
      );
    },
    []
  );

  const clearResearch = useCallback(() => setResearch([]), []);

  // --- Pane focus ----------------------------------------------------------
  const focusHandlerRef = useRef<(paneId: string) => void>(() => {});

  const registerFocusHandler = useCallback(
    (handler: (paneId: string) => void) => {
      focusHandlerRef.current = handler;
    },
    []
  );

  const focusPane = useCallback((paneId: string) => {
    focusHandlerRef.current(paneId);
  }, []);

  const value = useMemo<StudioValue>(
    () => ({
      documentId,
      title,
      setTitle,
      saveStatus,
      scheduleSave,
      flushSave,
      editor,
      setEditor,
      selection,
      setSelection,
      outline,
      setOutline,
      typography,
      setTypography,
      goals,
      setGoals,
      goalsStatus,
      sources,
      providers,
      sourcesBusy,
      sourcesError,
      refreshSources,
      syncSources,
      togglePin,
      pinUrl,
      comments,
      setComments,
      refreshComments,
      addComment,
      research,
      addResearch,
      updateResearch,
      clearResearch,
      researchBusy,
      setResearchBusy,
      focusPane,
      registerFocusHandler,
    }),
    [
      documentId,
      title,
      setTitle,
      saveStatus,
      scheduleSave,
      flushSave,
      editor,
      selection,
      outline,
      typography,
      setTypography,
      goals,
      setGoals,
      goalsStatus,
      sources,
      providers,
      sourcesBusy,
      sourcesError,
      refreshSources,
      syncSources,
      togglePin,
      pinUrl,
      comments,
      setComments,
      refreshComments,
      addComment,
      research,
      addResearch,
      updateResearch,
      clearResearch,
      researchBusy,
      focusPane,
      registerFocusHandler,
    ]
  );

  return (
    <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
  );
}
