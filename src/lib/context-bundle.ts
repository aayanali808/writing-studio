import { query, queryOne } from '@/lib/db';
import { truncateMiddle } from '@/lib/tiptap';
import type { Source } from '@/types';

/**
 * The Context Bundle
 * ------------------
 * Everything Claude should know about the piece being written, assembled in one
 * place and attached to *every* AI call — chat, highlight-to-ask, and the
 * research agent. If a new AI feature is added later, it calls
 * `buildContextBundle` and `renderContextBundle` rather than re-deriving context.
 *
 * The draft is read from the database rather than accepted from the client, so
 * there is exactly one source of truth. The client flushes its pending autosave
 * before making an AI request (see useAutosave), which keeps the two in step.
 */

/** Per-section character budgets, so a long draft can't crowd out the goals. */
const DRAFT_BUDGET = 24_000;
const SOURCE_BUDGET = 6_000;
const TOTAL_SOURCE_BUDGET = 30_000;

export interface ContextBundle {
  documentId: string;
  title: string;
  draft: string;
  goals: string;
  pinnedSources: Source[];
}

export async function buildContextBundle(
  documentId: string
): Promise<ContextBundle | null> {
  const document = await queryOne<{
    id: string;
    title: string;
    plain_text: string;
  }>('select id, title, plain_text from documents where id = $1', [documentId]);

  if (!document) return null;

  const [goalsRow, pinnedSources] = await Promise.all([
    queryOne<{ content: string }>(
      'select content from goals where document_id = $1',
      [documentId]
    ),
    query<Source>(
      `select s.id, s.provider, s.external_id, s.title, s.url,
              s.content_cache, s.last_synced
         from pinned_context p
         join sources s on s.id = p.source_id
        where p.document_id = $1
        order by p.pinned_at asc`,
      [documentId]
    ),
  ]);

  return {
    documentId: document.id,
    title: document.title,
    draft: document.plain_text,
    goals: goalsRow?.content?.trim() ?? '',
    pinnedSources,
  };
}

/**
 * Renders the bundle as the system prompt for an AI call.
 *
 * `task` describes what this particular feature wants Claude to do; the context
 * sections are identical across features so the model sees a consistent picture
 * of the work regardless of which pane the request came from.
 */
export function renderContextBundle(bundle: ContextBundle, task: string): string {
  const sections: string[] = [
    'You are the AI collaborator inside a personal long-form writing studio.',
    'You have the writer\'s current draft, their stated goals for the piece, and any',
    'reference sources they have pinned. Ground every response in that material:',
    'refer to what they have actually written, respect the goals, and cite pinned',
    'sources by title when you draw on them. Never invent a quotation or a fact',
    'about a source you were not given.',
    '',
    task,
    '',
    '=== CONTEXT BUNDLE ===',
    `Document title: ${bundle.title}`,
  ];

  sections.push(
    '',
    '--- Goals for this piece ---',
    bundle.goals
      ? bundle.goals
      : '(The writer has not set any goals yet. Do not invent goals on their behalf.)'
  );

  sections.push(
    '',
    '--- Current draft ---',
    bundle.draft.trim()
      ? truncateMiddle(bundle.draft, DRAFT_BUDGET)
      : '(The draft is empty.)'
  );

  sections.push('', '--- Pinned sources ---');

  if (bundle.pinnedSources.length === 0) {
    sections.push('(No sources are pinned to this document.)');
  } else {
    let remaining = TOTAL_SOURCE_BUDGET;

    for (const source of bundle.pinnedSources) {
      const budget = Math.min(SOURCE_BUDGET, remaining);
      const body =
        budget > 0
          ? truncateMiddle(source.content_cache ?? '', budget)
          : '(omitted — source budget exhausted)';
      remaining -= body.length;

      sections.push(
        '',
        `[${source.provider}] ${source.title}${source.url ? ` — ${source.url}` : ''}`,
        body.trim() || '(This source has no cached text.)'
      );
    }
  }

  sections.push('', '=== END CONTEXT BUNDLE ===');

  return sections.join('\n');
}

/** Convenience wrapper for routes that need both steps. */
export async function contextSystemPrompt(
  documentId: string,
  task: string
): Promise<string | null> {
  const bundle = await buildContextBundle(documentId);
  if (!bundle) return null;
  return renderContextBundle(bundle, task);
}
