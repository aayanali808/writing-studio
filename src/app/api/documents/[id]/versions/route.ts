import { requireSession } from '@/auth';
import { saveDocument } from '@/lib/documents';
import {
  getVersion,
  listVersions,
  snapshotDocument,
  type SnapshotReason,
} from '@/lib/versions';

type RouteContext = { params: Promise<{ id: string }> };

/** The snapshot list, newest first, without bodies. */
export async function GET(_request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  return Response.json({ versions: await listVersions(id) });
}

/**
 * Takes a snapshot of the draft as it currently stands.
 *
 * Called explicitly before anything that overwrites prose — applying an AI
 * rewrite, or restoring an older version — and from the Versions pane's
 * "Snapshot now". Routine autosave snapshots happen inside PATCH instead.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json().catch(() => null);

  const reason: SnapshotReason =
    body?.reason === 'ai' || body?.reason === 'manual' ? body.reason : 'manual';

  const version = await snapshotDocument(id, reason);
  return Response.json({ version, versions: await listVersions(id) });
}

/**
 * Restores a snapshot.
 *
 * The current draft is snapshotted first, so restoring is itself undoable —
 * otherwise the safety net would have a hole exactly where you reach for it.
 */
export async function PUT(request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const versionId = typeof body?.versionId === 'string' ? body.versionId : '';

  if (!versionId) {
    return Response.json({ error: 'Expected a `versionId`' }, { status: 400 });
  }

  const version = await getVersion(id, versionId);
  if (!version) {
    return Response.json({ error: 'Version not found' }, { status: 404 });
  }

  await snapshotDocument(id, 'manual');

  const document = await saveDocument(id, {
    title: version.title,
    content: version.content,
  });

  if (!document) {
    return Response.json({ error: 'Document not found' }, { status: 404 });
  }

  return Response.json({ document, versions: await listVersions(id) });
}
