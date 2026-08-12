import { requireSession } from '@/auth';
import { query } from '@/lib/db';
import { cacheSource, listSourcesForDocument, syncSourceContent } from '@/lib/sources/cache';
import { normaliseUrl } from '@/lib/sources/web';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Pin a source into this document's Context Bundle.
 *
 * The body is fetched at pin time rather than at list time — a pinned source is
 * about to be sent to Claude, so this is the moment its text actually matters.
 *
 * Takes either a `sourceId` for something already cached, or a `url` for a page
 * that isn't — which is how a research result becomes a source Claude can
 * actually read rather than just a link in the margin.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json().catch(() => null);

  let sourceId = typeof body?.sourceId === 'string' ? body.sourceId : '';

  if (!sourceId && typeof body?.url === 'string') {
    const url = normaliseUrl(body.url);
    if (!url) {
      return Response.json(
        { error: 'That needs to be a public http(s) URL.' },
        { status: 400 }
      );
    }

    const title = typeof body?.title === 'string' && body.title.trim()
      ? body.title.trim()
      : url;

    // Cached as a stub; the fetch below fills in the body, and the real page
    // title replaces this one if the fetch succeeds.
    const cached = await cacheSource('web', {
      externalId: url,
      title,
      url,
      content: '',
    });
    sourceId = cached.id;
  }

  if (!sourceId) {
    return Response.json({ error: 'Expected a `sourceId` or `url`' }, { status: 400 });
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
