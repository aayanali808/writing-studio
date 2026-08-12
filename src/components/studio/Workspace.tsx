'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DockviewReact } from 'dockview-react';
import { signOut } from 'next-auth/react';
import type {
  DockviewApi,
  DockviewReadyEvent,
  IDockviewPanelProps,
  SerializedDockview,
} from 'dockview';
import { ChatPane } from '@/components/panes/ChatPane';
import { GoalsPane } from '@/components/panes/GoalsPane';
import { OutlinePane } from '@/components/panes/OutlinePane';
import { ResearchPane } from '@/components/panes/ResearchPane';
import { SourcesPane } from '@/components/panes/SourcesPane';
import { VersionsPane } from '@/components/panes/VersionsPane';
import { WritingPane } from '@/components/panes/WritingPane';
import { DocumentMenu } from '@/components/studio/DocumentMenu';
import { useStudio } from '@/components/studio/StudioContext';
import { apiJson } from '@/lib/client';
import { PANE_TITLES, type DocNode, type PaneId } from '@/types';

const LAYOUT_SAVE_DELAY_MS = 800;

/** Panels that make up the default arrangement, in creation order. */
function buildDefaultLayout(api: DockviewApi): void {
  api.addPanel({
    id: 'writing',
    component: 'writing',
    title: PANE_TITLES.writing,
  });

  // The left rail is the "about this piece" group: where you are in it, what
  // it's for, and what it's built from.
  api.addPanel({
    id: 'outline',
    component: 'outline',
    title: PANE_TITLES.outline,
    position: { direction: 'left' },
  });

  api.addPanel({
    id: 'sources',
    component: 'sources',
    title: PANE_TITLES.sources,
    position: { referencePanel: 'outline', direction: 'within' },
  });

  api.addPanel({
    id: 'goals',
    component: 'goals',
    title: PANE_TITLES.goals,
    position: { referencePanel: 'outline', direction: 'within' },
  });

  api.addPanel({
    id: 'versions',
    component: 'versions',
    title: PANE_TITLES.versions,
    position: { referencePanel: 'outline', direction: 'within' },
  });

  api.addPanel({
    id: 'chat',
    component: 'chat',
    title: PANE_TITLES.chat,
    position: { direction: 'right' },
  });

  api.addPanel({
    id: 'research',
    component: 'research',
    title: PANE_TITLES.research,
    position: { referencePanel: 'chat', direction: 'within' },
  });

  // Writing gets the room; the side rails start narrow.
  try {
    api.getPanel('outline')?.api.group.api.setSize({ width: 230 });
    api.getPanel('chat')?.api.group.api.setSize({ width: 400 });
  } catch {
    // Sizing is cosmetic — a failure here shouldn't break the workspace.
  }

  // Outline is the useful default tab in the left group — `setActive` on the
  // group's tab first, then on Writing, which leaves the caret in the draft.
  api.getPanel('outline')?.api.setActive();
  api.getPanel('writing')?.api.setActive();
}

export function Workspace({ initialContent }: { initialContent: DocNode }) {
  const { documentId, registerFocusHandler } = useStudio();

  const apiRef = useRef<DockviewApi | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Suppresses layout saves while we're the ones mutating the layout.
  const restoringRef = useRef(true);
  const [ready, setReady] = useState(false);

  // Stable component map — a new object identity on each render would make
  // dockview tear panels down and rebuild them.
  const components = useMemo(
    () => ({
      writing: (_props: IDockviewPanelProps) => (
        <WritingPane initialContent={initialContent} />
      ),
      outline: () => <OutlinePane />,
      chat: () => <ChatPane />,
      sources: () => <SourcesPane />,
      goals: () => <GoalsPane />,
      research: () => <ResearchPane />,
      versions: () => <VersionsPane />,
    }),
    [initialContent]
  );

  const saveLayout = useCallback(() => {
    if (restoringRef.current || !apiRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const api = apiRef.current;
      if (!api) return;

      apiJson(`/api/documents/${documentId}/layout`, {
        method: 'PUT',
        body: JSON.stringify({ layout: api.toJSON() }),
      }).catch(() => {
        // A dropped layout save is recoverable — the next change retries.
      });
    }, LAYOUT_SAVE_DELAY_MS);
  }, [documentId]);

  const onReady = useCallback(
    async (event: DockviewReadyEvent) => {
      apiRef.current = event.api;
      restoringRef.current = true;

      let restored = false;
      try {
        const { layout } = await apiJson<{ layout: SerializedDockview | null }>(
          `/api/documents/${documentId}/layout`
        );

        if (layout) {
          event.api.fromJSON(layout);
          restored = true;
        }
      } catch {
        // A saved layout from an older pane set can fail to deserialise.
        // Fall through and rebuild the default rather than showing an empty grid.
      }

      if (!restored) {
        try {
          event.api.clear();
        } catch {
          // Nothing to clear on a fresh grid.
        }
        buildDefaultLayout(event.api);
      }

      restoringRef.current = false;
      setReady(true);

      event.api.onDidLayoutChange(saveLayout);
    },
    [documentId, saveLayout]
  );

  // Let panes ask the workspace to bring another pane forward — the research
  // agent uses this when results are on the way.
  useEffect(() => {
    registerFocusHandler((paneId: string) => {
      const api = apiRef.current;
      if (!api) return;

      const existing = api.getPanel(paneId);
      if (existing) {
        existing.api.setActive();
        return;
      }

      api.addPanel({
        id: paneId,
        component: paneId,
        title: PANE_TITLES[paneId as PaneId] ?? paneId,
        position: { direction: 'right' },
      });
    });
  }, [registerFocusHandler]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    []
  );

  const resetLayout = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;

    restoringRef.current = true;
    api.clear();
    buildDefaultLayout(api);
    restoringRef.current = false;
    saveLayout();
  }, [saveLayout]);

  const addPane = useCallback((paneId: PaneId) => {
    const api = apiRef.current;
    if (!api) return;

    const existing = api.getPanel(paneId);
    if (existing) {
      existing.api.setActive();
      return;
    }

    api.addPanel({
      id: paneId,
      component: paneId,
      title: PANE_TITLES[paneId],
      position: { direction: 'right' },
    });
  }, []);

  return (
    <div className="flex h-full flex-col">
      <WorkspaceToolbar ready={ready} onAddPane={addPane} onReset={resetLayout} />

      <div className="min-h-0 flex-1">
        <DockviewReact
          components={components}
          onReady={onReady}
          className="dockview-theme-studio h-full"
        />
      </div>
    </div>
  );
}

function WorkspaceToolbar({
  ready,
  onAddPane,
  onReset,
}: {
  ready: boolean;
  onAddPane: (paneId: PaneId) => void;
  onReset: () => void;
}) {
  const { saveStatus } = useStudio();
  const [open, setOpen] = useState(false);

  return (
    <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-inset)] px-3 py-1.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <DocumentMenu />
        <span className="shrink-0 text-[10px] text-[var(--text-faint)]">
          {saveStatus === 'saving'
            ? 'saving…'
            : saveStatus === 'error'
              ? 'save failed'
              : ''}
        </span>
      </div>

      <div className="relative flex items-center gap-1">
        <button
          type="button"
          disabled={!ready}
          onClick={() => setOpen((value) => !value)}
          className="rounded px-2 py-0.5 text-[11px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text)] disabled:opacity-40"
        >
          Panes ▾
        </button>

        {open ? (
          <>
            <button
              type="button"
              aria-hidden
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setOpen(false)}
            />
            <div className="absolute right-0 top-7 z-20 w-44 overflow-hidden rounded-md border border-[var(--border-strong)] bg-[var(--bg-raised)] py-1 shadow-xl">
              {(Object.keys(PANE_TITLES) as PaneId[]).map((paneId) => (
                <button
                  key={paneId}
                  type="button"
                  onClick={() => {
                    onAddPane(paneId);
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--text)]"
                >
                  {PANE_TITLES[paneId]}
                </button>
              ))}
              <div className="my-1 h-px bg-[var(--border)]" />
              <button
                type="button"
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--text)]"
              >
                Reset layout
              </button>
            </div>
          </>
        ) : null}

        <button
          type="button"
          onClick={() => void signOut({ redirectTo: '/login' })}
          className="rounded px-2 py-0.5 text-[11px] text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
