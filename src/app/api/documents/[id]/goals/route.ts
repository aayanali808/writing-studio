import { requireSession } from '@/auth';
import { query, queryOne } from '@/lib/db';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const row = await queryOne<{ content: string }>(
    'select content from goals where document_id = $1',
    [id]
  );

  return Response.json({ goals: row?.content ?? '' });
}

export async function PUT(request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json().catch(() => null);

  if (typeof body?.content !== 'string') {
    return Response.json({ error: 'Expected a `content` string' }, { status: 400 });
  }

  await query(
    `insert into goals (document_id, content, updated_at)
     values ($1, $2, now())
     on conflict (document_id) do update
        set content = excluded.content,
            updated_at = now()`,
    [id, body.content]
  );

  return new Response(null, { status: 204 });
}
