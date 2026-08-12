import { requireSession } from '@/auth';
import { query, queryOne } from '@/lib/db';
import type { Comment } from '@/types';

type RouteContext = { params: Promise<{ id: string }> };

const SELECT = 'id, document_id, quote, body, resolved, created_at';

export async function GET(_request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;

  return Response.json({
    comments: await query<Comment>(
      `select ${SELECT}
         from comments
        where document_id = $1
        order by resolved asc, created_at desc`,
      [id]
    ),
  });
}

/**
 * Creates a note.
 *
 * The row is written first so the client has an id to anchor the mark to —
 * the mark in the document carries that id, which is what keeps the highlight
 * attached to its passage through later edits.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const payload = await request.json().catch(() => null);

  const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
  const quote = typeof payload?.quote === 'string' ? payload.quote.trim() : '';

  if (!body) {
    return Response.json({ error: 'A note needs a `body`' }, { status: 400 });
  }

  const comment = await queryOne<Comment>(
    `insert into comments (document_id, quote, body)
     values ($1, $2, $3)
     returning ${SELECT}`,
    [id, quote.slice(0, 500), body]
  );

  return Response.json({ comment }, { status: 201 });
}

/** Resolves or reopens a note, or edits its text. */
export async function PATCH(request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const payload = await request.json().catch(() => null);
  const commentId = typeof payload?.commentId === 'string' ? payload.commentId : '';

  if (!commentId) {
    return Response.json({ error: 'Expected a `commentId`' }, { status: 400 });
  }

  const sets: string[] = [];
  const values: unknown[] = [commentId, id];

  if (typeof payload.resolved === 'boolean') {
    values.push(payload.resolved);
    sets.push(`resolved = $${values.length}`);
  }

  if (typeof payload.body === 'string' && payload.body.trim()) {
    values.push(payload.body.trim());
    sets.push(`body = $${values.length}`);
  }

  if (!sets.length) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const comment = await queryOne<Comment>(
    `update comments set ${sets.join(', ')}
      where id = $1 and document_id = $2
      returning ${SELECT}`,
    values
  );

  if (!comment) {
    return Response.json({ error: 'Comment not found' }, { status: 404 });
  }

  return Response.json({ comment });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const commentId = new URL(request.url).searchParams.get('commentId');

  if (!commentId) {
    return Response.json(
      { error: 'Expected a `commentId` query param' },
      { status: 400 }
    );
  }

  await query('delete from comments where id = $1 and document_id = $2', [
    commentId,
    id,
  ]);

  return new Response(null, { status: 204 });
}
