import { requireSession } from '@/auth';
import { query } from '@/lib/db';
import { listSourcesForDocument, syncSourceContent } from '@/lib/sources/cache';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Pin a source into this document's Context Bundle.
 *
 * The body is fetched at pin time rather than at list time — a pinned source is
 * about to be sent to Claude, so this is the moment its text actually matters.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const sourceId = typeof body?.sourceId === 'string' ? body.sourceId : '';

  if (!sourceId) {
    return Response.json({ error: 'Expected a `sourceId`' }, { status: 400 });
  }

  await query(
    `insert into pinned_context (document_id, source_id)
     values ($1, $2)
     on conflict do nothing`,
    [id, sourceId]
  );

  let warning: string | null = null;
  try {
    await syncSourceContent(sourceId);
  } catch (error) {
    // The pin still stands; the bundle just uses whatever text was cached.
    warning = error instanceof Error ? error.message : 'Failed to refresh source';
    console.error('[pins] content sync failed', error);
  }

  return Response.json({ sources: await listSourcesForDocument(id), warning });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const sourceId = new URL(request.url).searchParams.get('sourceId');

  if (!sourceId) {
    return Response.json({ error: 'Expected a `sourceId` query param' }, { status: 400 });
  }

  await query(
    'delete from pinned_context where document_id = $1 and source_id = $2',
    [id, sourceId]
  );

  return Response.json({ sources: await listSourcesForDocument(id) });
}
