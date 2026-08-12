import { requireSession } from '@/auth';
import {
  getProviders,
  listSourcesForDocument,
  searchProviders,
  syncAllProviders,
} from '@/lib/sources';

// Enumerating a whole Notion workspace can take a while.
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET ?q=term — search the providers live, then return the cached catalogue.
 * GET          — just the cached catalogue, pinned items first.
 */
export async function GET(request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const term = new URL(request.url).searchParams.get('q')?.trim();

  try {
    if (term) await searchProviders(term);
  } catch (error) {
    // A failing provider shouldn't blank the pane — fall through and return
    // whatever is already cached.
    console.error('[sources] search failed', error);
  }

  return Response.json({
    sources: await listSourcesForDocument(id),
    providers: getProviders().map((provider) => ({
      id: provider.id,
      label: provider.label,
      configured: provider.isConfigured(),
    })),
  });
}

/**
 * Re-pulls the catalogue from every configured provider. Titles and URLs only —
 * bodies are fetched when a source is pinned.
 */
export async function POST(_request: Request, { params }: RouteContext) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;

  try {
    const report = await syncAllProviders();

    return Response.json({
      ...report,
      sources: await listSourcesForDocument(id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[sources] sync failed', message, error);
    return Response.json({ error: message }, { status: 502 });
  }
}
