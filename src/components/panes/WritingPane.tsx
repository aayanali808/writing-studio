'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import { AskPopover, type AskState } from '@/components/editor/AskPopover';
import { readSelection } from '@/components/editor/editor-utils';
import {
  SelectionToolbar,
  type ToolbarAction,
} from '@/components/editor/SelectionToolbar';
import { useStudio } from '@/components/studio/StudioContext';
import { apiJson, apiStream } from '@/lib/client';
import type { DocNode, EditorSelection, ResearchResult } from '@/types';

const ACTION_LABELS: Record<string, string> = {
  improve: 'Improve this',
  explain: 'Explain',
  custom: 'Your question',
};

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
    addResearch,
    setResearchBusy,
    focusPane,
  } = useStudio();

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [ask, setAsk] = useState<AskState | null>(null);

  const editor = useEditor({
    // The studio server-renders first; TipTap must not touch the DOM until
    // it's on the client.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true },
      }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      CharacterCount,
    ],
    content: initialContent,
    editorProps: {
      attributes: { class: 'mx-auto w-full max-w-[46rem] px-8 py-10' },
    },
    onUpdate({ editor: instance }) {
      scheduleSave({ content: instance.getJSON() as DocNode });
    },
    onSelectionUpdate({ editor: instance }) {
      setSelection(readSelection(instance));
    },
  });

  // Publish the instance so other panes — the ask popover, research citations —
  // can write into the document.
  useEffect(() => {
    setEditor(editor ?? null);
    return () => setEditor(null);
  }, [editor, setEditor]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const runAsk = useCallback(
    async (
      action: 'improve' | 'explain' | 'custom',
      current: EditorSelection,
      prompt?: string
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setAsk({
        label: ACTION_LABELS[action] ?? 'Ask',
        selection: current,
        answer: '',
        pending: true,
        error: null,
      });

      try {
        // The Context Bundle reads the draft from Postgres, so the pending
        // autosave has to land before Claude is asked about it.
        await flushSave();

        await apiStream(
          `/api/documents/${documentId}/ask`,
          {
            method: 'POST',
            body: JSON.stringify({
              action,
              prompt,
              selection: current.text,
              surrounding: current.surrounding,
            }),
            signal: controller.signal,
          },
          (accumulated) =>
            setAsk((state) =>
              state ? { ...state, answer: accumulated } : state
            )
        );

        setAsk((state) => (state ? { ...state, pending: false } : state));
      } catch (error) {
        if (controller.signal.aborted) return;
        setAsk((state) =>
          state
            ? {
                ...state,
                pending: false,
                error:
                  error instanceof Error ? error.message : 'The request failed',
              }
            : state
        );
      }
    },
    [documentId, flushSave]
  );

  const runResearch = useCallback(
    async (current: EditorSelection) => {
      setResearchBusy(true);
      focusPane('research');

      try {
        await flushSave();

        const result = await apiJson<{
          claim: string;
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
          ...result,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        addResearch({
          id: crypto.randomUUID(),
          claim: current.text,
          summary:
            error instanceof Error
              ? `Research failed: ${error.message}`
              : 'Research failed.',
          sources: [],
          createdAt: new Date().toISOString(),
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
        void runAsk('custom', selection, action.prompt);
        return;
      }
      void runAsk(action.kind, selection);
    },
    [selection, runAsk, runResearch]
  );

  const words = editor?.storage.characterCount?.words?.() ?? 0;

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

        <div
          ref={scrollRef}
          className="studio-prose relative flex-1 overflow-y-auto"
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

      {ask ? <AskPopover state={ask} onClose={() => setAsk(null)} /> : null}
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
