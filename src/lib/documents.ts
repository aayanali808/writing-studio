import { query, queryOne } from '@/lib/db';
import { docToPlainText } from '@/lib/tiptap';
import { EMPTY_DOC, type DocNode, type Document, type DocumentSummary } from '@/types';

export async function listDocuments(): Promise<DocumentSummary[]> {
  return query<DocumentSummary>(
    `select id, title, updated_at
       from documents
      order by updated_at desc`
  );
}

export async function getDocument(id: string): Promise<Document | null> {
  return queryOne<Document>(
    `select id, title, content, plain_text, created_at, updated_at
       from documents
      where id = $1`,
    [id]
  );
}

export async function createDocument(title = 'Untitled'): Promise<Document> {
  const row = await queryOne<Document>(
    `insert into documents (title, content, plain_text)
     values ($1, $2, '')
     returning id, title, content, plain_text, created_at, updated_at`,
    [title, JSON.stringify(EMPTY_DOC)]
  );

  if (!row) throw new Error('Failed to create document');

  // Every document gets a goals row up front so the Goals pane and the Context
  // Bundle can read it without a null branch.
  await query('insert into goals (document_id) values ($1) on conflict do nothing', [
    row.id,
  ]);

  return row;
}

/**
 * Saves a draft. `plain_text` is derived here rather than trusted from the
 * client, so the column can never drift from `content`.
 */
export async function saveDocument(
  id: string,
  updates: { title?: string; content?: DocNode }
): Promise<Document | null> {
  const sets: string[] = ['updated_at = now()'];
  const values: unknown[] = [id];

  if (updates.title !== undefined) {
    values.push(updates.title);
    sets.push(`title = $${values.length}`);
  }

  if (updates.content !== undefined) {
    values.push(JSON.stringify(updates.content));
    sets.push(`content = $${values.length}`);

    values.push(docToPlainText(updates.content));
    sets.push(`plain_text = $${values.length}`);
  }

  return queryOne<Document>(
    `update documents
        set ${sets.join(', ')}
      where id = $1
      returning id, title, content, plain_text, created_at, updated_at`,
    values
  );
}

export async function deleteDocument(id: string): Promise<void> {
  // layouts / goals / chat_messages / pinned_context all cascade.
  await query('delete from documents where id = $1', [id]);
}

/**
 * The studio's landing target: the most recently edited document, or a fresh
 * one when the database is empty.
 */
export async function getOrCreateLatestDocument(): Promise<Document> {
  const latest = await queryOne<{ id: string }>(
    'select id from documents order by updated_at desc limit 1'
  );

  if (latest) {
    const existing = await getDocument(latest.id);
    if (existing) return existing;
  }

  return createDocument('Untitled');
}
