'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { CharacterCount, Focus, Placeholder } from '@tiptap/extensions';
import { AskPopover, type AskState } from '@/components/editor/AskPopover';
import { EditorToolbar } from '@/components/editor/EditorToolbar';
import { readSelection } from '@/components/editor/editor-utils';
import {
  SelectionToolbar,
  type ToolbarAction,
} from '@/components/editor/SelectionToolbar';
import { useStudio } from '@/components/studio/StudioContext';
import { apiJson, apiStream } from '@/lib/client';
import {
  FONT_STACKS,
  type DocNode,
  type EditorSelection,
  type OutlineItem,
  type ResearchResult,
  type Turn,
} from '@/types';

const ACTION_LABELS: Record<string, string> = {
  improve: 'Improve this',
  explain: 'Explain',
  custom: 'Your question',
};

/** Walks the top level of the document collecting headings for the Outline. */
function readOutline(editor: Editor): OutlineItem[] {
  const items: OutlineItem[] = [];

  editor.state.doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') return;
    items.push({
      pos: offset,
      level: Number(node.attrs.level) || 1,
      text: node.textContent.trim(),
    });
  });

  return items;
}

export function WritingPane({ initialContent }: { initialContent: DocNode }) {
  const {
    documentId,
    title,
    setTitle,
    saveStatus,
    scheduleSave,
    flushSave,
    setEditor,
    selection,
    setSelection,
    setOutline,
    typography,
    addResearch,
    setResearchBusy,
    focusPane,
  } = useStudio();

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [ask, setAsk] = useState<AskState | null>(null);

  // Follow-ups need the thread as it stands without making the handler depend
  // on it — a state updater can't be used to read it, since React is free to
  // run one twice and that would fire the request twice.
  const askRef = useRef<AskState | null>(null);
  askRef.current = ask;

  const editor = useEditor({
    // The studio server-renders first; TipTap must not touch the DOM until
    // it's on the client.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true },
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      // Marks the block the cursor is in. Focus mode dims the rest in CSS;
      // 'shallowest' keeps the mark on the top-level block rather than on a
      // list item deep inside one.
      Focus.configure({ className: 'has-focus', mode: 'shallowest' }),
      CharacterCount,
    ],
    content: initialContent,
    editorProps: {
      attributes: { class: 'studio-measure mx-auto w-full px-8 py-10' },
    },
    onUpdate({ editor: instance }) {
      scheduleSave({ content: instance.getJSON() as DocNode });
      setOutline(readOutline(instance));
    },
    onSelectionUpdate({ editor: instance }) {
      setSelection(readSelection(instance));
    },
  });

  // Publish the instance so other panes — the ask popover, the outline,
  // research citations — can read and write the document.
  useEffect(() => {
    setEditor(editor ?? null);
    return () => setEditor(null);
  }, [editor, setEditor]);

  // Seed the outline from the loaded draft. `onUpdate` only fires on edits, so
  // without this a document opens with an empty Outline pane until you type.
  useEffect(() => {
    if (editor) setOutline(readOutline(editor));
  }, [editor, setOutline]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * Streams one ask turn into the popover.
   *
   * `history` is everything already said in this thread; the opening user turn
   * is rebuilt server-side from the selection, so it isn't sent.
   */
  const streamAsk = useCallback(
    async (state: AskState, history: Turn[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setAsk({ ...state, pending: true, error: null });

      try {
        // The Context Bundle reads the draft from Postgres, so the pending
        // autosave has to land before Claude is asked about it.
        await flushSave();

        await apiStream(
          `/api/documents/${documentId}/ask`,
          {
            method: 'POST',
            body: JSON.stringify({
              action: state.request.action,
              prompt: state.request.prompt,
              selection: state.selection.text,
              surrounding: state.selection.surrounding,
              history,
            }),
            signal: controller.signal,
          },
          (accumulated) =>
            setAsk((current) => {
              if (!current) return current;
              // The reply is always the last turn — replace it in place as it
              // streams rather than appending.
              const turns = [...current.turns];
              turns[turns.length - 1] = { role: 'assistant', content: accumulated };
              return { ...current, turns };
            })
        );

        setAsk((current) => (current ? { ...current, pending: false } : current));
      } catch (error) {
        if (controller.signal.aborted) return;
        setAsk((current) =>
          current
            ? {
                ...current,
                pending: false,
                error:
                  error instanceof Error ? error.message : 'The request failed',
              }
            : current
        );
      }
    },
    [documentId, flushSave]
  );

  const runAsk = useCallback(
    (
      action: 'improve' | 'explain' | 'custom',
      current: EditorSelection,
      prompt?: string
    ) => {
      void streamAsk(
        {
          label: ACTION_LABELS[action] ?? 'Ask',
          selection: current,
          request: { action, prompt },
          turns: [{ role: 'assistant', content: '' }],
          pending: true,
          error: null,
        },
        []
      );
    },
    [streamAsk]
  );

  /** Sends a written reply and opens a fresh assistant turn for the answer. */
  const followUpAsk = useCallback(
    (question: string) => {
      const current = askRef.current;
      if (!current || current.pending) return;

      const history: Turn[] = [
        ...current.turns,
        { role: 'user', content: question },
      ];

      void streamAsk(
        { ...current, turns: [...history, { role: 'assistant', content: '' }] },
        history
      );
    },
    [streamAsk]
  );

  const runResearch = useCallback(
    async (current: EditorSelection) => {
      setResearchBusy(true);
      focusPane('research');

      const base = {
        id: crypto.randomUUID(),
        claim: current.text,
        surrounding: current.surrounding,
        pending: false,
        createdAt: new Date().toISOString(),
      };

      try {
        await flushSave();

        const result = await apiJson<{
          summary: string;
          sources: ResearchResult['sources'];
        }>(`/api/documents/${documentId}/research`, {
          method: 'POST',
          body: JSON.stringify({
            claim: current.text,
            surrounding: current.surrounding,
          }),
        });

        addResearch({
          ...base,
          turns: [{ role: 'assistant', content: result.summary }],
          sources: result.sources,
          error: null,
        });
      } catch (error) {
        addResearch({
          ...base,
          turns: [],
          sources: [],
          error:
            error instanceof Error ? error.message : 'The search failed.',
        });
      } finally {
        setResearchBusy(false);
      }
    },
    [documentId, flushSave, addResearch, setResearchBusy, focusPane]
  );

  const handleAction = useCallback(
    (action: ToolbarAction) => {
      if (!selection) return;

      if (action.kind === 'research') {
        void runResearch(selection);
        return;
      }
      if (action.kind === 'custom') {
        runAsk('custom', selection, action.prompt);
        return;
      }
      runAsk(action.kind, selection);
    },
    [selection, runAsk, runResearch]
  );

  const words = editor?.storage.characterCount?.words?.() ?? 0;

  // Display preferences reach the editor as custom properties so the rules in
  // globals.css stay the single description of how the prose looks.
  const surfaceStyle = useMemo(
    () =>
      ({
        '--editor-font': FONT_STACKS[typography.family],
        '--editor-size': `${typography.size}px`,
        '--editor-measure': `${typography.width}rem`,
      }) as React.CSSProperties,
    [typography]
  );

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-[var(--border)] px-8 pb-3 pt-4">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Untitled"
            aria-label="Document title"
            className="w-full bg-transparent text-lg font-semibold tracking-tight outline-none placeholder:text-[var(--text-faint)]"
          />
        </div>

        {editor ? <EditorToolbar editor={editor} /> : null}

        <div
          ref={scrollRef}
          style={surfaceStyle}
          className={`studio-prose relative flex-1 overflow-y-auto ${
            typography.focus ? 'is-focus-mode' : ''
          }`}
        >
          <EditorContent editor={editor} />

          {editor && selection ? (
            <SelectionToolbar
              // Remounting on a new range resets the toolbar's own state
              // (the free-text ask box) without an effect.
              key={`${selection.from}-${selection.to}`}
              editor={editor}
              selection={selection}
              containerRef={scrollRef}
              onAction={handleAction}
            />
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border)] px-8 py-1.5 text-[11px] text-[var(--text-faint)]">
          <span>{words.toLocaleString()} words</span>
          <SaveIndicator status={saveStatus} />
        </div>
      </div>

      {ask ? (
        <AskPopover
          state={ask}
          onFollowUp={followUpAsk}
          onClose={() => setAsk(null)}
        />
      ) : null}
    </div>
  );
}

const SAVE_LABELS: Record<string, string> = {
  idle: '',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
};

function SaveIndicator({ status }: { status: string }) {
  return (
    <span className={status === 'error' ? 'text-[var(--danger)]' : undefined}>
      {SAVE_LABELS[status] ?? ''}
    </span>
  );
}
