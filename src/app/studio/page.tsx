import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { StudioProvider } from '@/components/studio/StudioContext';
import { Workspace } from '@/components/studio/Workspace';
import { queryOne } from '@/lib/db';
import { getDocument, getOrCreateLatestDocument } from '@/lib/documents';
import { EMPTY_DOC } from '@/types';

export const metadata = { title: 'Writing Studio' };

// The studio is per-request state (draft, goals, layout) — never cache it.
export const dynamic = 'force-dynamic';

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { doc } = await searchParams;

  // ?doc=<id> opens a specific piece; otherwise pick up where we left off.
  const document =
    (doc ? await getDocument(doc) : null) ?? (await getOrCreateLatestDocument());

  const goals = await queryOne<{ content: string }>(
    'select content from goals where document_id = $1',
    [document.id]
  );

  return (
    <StudioProvider document={document} initialGoals={goals?.content ?? ''}>
      <main className="h-screen overflow-hidden">
        <Workspace initialContent={document.content ?? EMPTY_DOC} />
      </main>
    </StudioProvider>
  );
}
