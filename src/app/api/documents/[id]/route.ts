import { requireSession } from '@/auth';
import { deleteDocument, getDocument, saveDocument } from '@/lib/documents';
import type { DocNode } from '@/types';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const document = await getDocument(id);
  if (!document) {
    return Response.json({ error: 'Document not found' }, { status: 404 });
  }

  return Response.json({ document });
}

/** Autosave target. Accepts a partial update — title, content, or both. */
export async function PATCH(request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const updates: { title?: string; content?: DocNode } = {};

  if (typeof body.title === 'string') {
    updates.title = body.title.trim() || 'Untitled';
  }

  if (body.content && typeof body.content === 'object') {
    updates.content = body.content as DocNode;
  }

  if (Object.keys(updates).length === 0) {
    return Response.json(
      { error: 'Nothing to update — send `title` and/or `content`.' },
      { status: 400 }
    );
  }

  const document = await saveDocument(id, updates);
  if (!document) {
    return Response.json({ error: 'Document not found' }, { status: 404 });
  }

  return Response.json({
    document: { id: document.id, title: document.title, updated_at: document.updated_at },
  });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  await deleteDocument(id);

  return new Response(null, { status: 204 });
}
