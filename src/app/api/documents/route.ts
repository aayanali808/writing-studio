import { requireSession } from '@/auth';
import { createDocument, listDocuments } from '@/lib/documents';

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  return Response.json({ documents: await listDocuments() });
}

export async function POST(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => ({}));
  const title =
    typeof body?.title === 'string' && body.title.trim()
      ? body.title.trim()
      : 'Untitled';

  return Response.json({ document: await createDocument(title) }, { status: 201 });
}
