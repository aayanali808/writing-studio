import { requireSession } from '@/auth';
import { query, queryOne } from '@/lib/db';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const row = await queryOne<{ dockview_layout_json: unknown }>(
    'select dockview_layout_json from layouts where document_id = $1',
    [id]
  );

  return Response.json({ layout: row?.dockview_layout_json ?? null });
}

/** Called whenever dockview reports a layout change (debounced client-side). */
export async function PUT(request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json().catch(() => null);

  if (!body?.layout || typeof body.layout !== 'object') {
    return Response.json({ error: 'Expected a `layout` object' }, { status: 400 });
  }

  await query(
    `insert into layouts (document_id, dockview_layout_json, updated_at)
     values ($1, $2, now())
     on conflict (document_id) do update
        set dockview_layout_json = excluded.dockview_layout_json,
            updated_at = now()`,
    [id, JSON.stringify(body.layout)]
  );

  return new Response(null, { status: 204 });
}
