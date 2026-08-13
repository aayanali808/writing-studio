import { JWT } from 'google-auth-library';
import type { ExternalSource, SourceProvider } from './provider';

/**
 * Google Drive, via a service account — no OAuth.
 *
 * Deliberately the same shape as the Notion provider: you create a machine
 * identity, share the folders and documents you want visible with its email
 * address, and it can read those and nothing else. OAuth would have meant a
 * redirect URI, a consent screen, and refresh tokens to store and rotate — all
 * of it to reach one person's own files in a single-user app.
 *
 * Setup:
 *   1. In Google Cloud Console, create a project and enable the Drive API and
 *      the Docs API.
 *   2. Create a service account, add a JSON key, and download it.
 *   3. Put the whole JSON file in GOOGLE_SERVICE_ACCOUNT_JSON (one line).
 *   4. In Drive, share the folders or files you want with the service
 *      account's `client_email`. Nothing is visible until you do.
 *
 * Read-only throughout: the scope requested is `drive.readonly`, so a bug here
 * cannot write to or delete anything in Drive.
 */

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

/** Drive returns 100 by default; one page is plenty for a personal corpus. */
const PAGE_SIZE = 100;

/** Long documents are truncated — the Context Bundle budgets far less anyway. */
const MAX_CHARS = 200_000;

/**
 * The file types worth reading as text.
 *
 * Google-native formats have to be exported rather than downloaded, which is
 * why they're listed separately from the types that are already text.
 */
const EXPORTABLE: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
};

const READABLE = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/rtf',
  'application/json',
]);

const MIME_FILTER = [...Object.keys(EXPORTABLE), ...READABLE]
  .map((type) => `mimeType='${type}'`)
  .join(' or ');

let client: JWT | null = null;

function getClient(): JWT {
  if (client) return client;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');

  let credentials: { client_email?: string; private_key?: string };
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON — paste the whole key file.'
    );
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON needs `client_email` and `private_key`.'
    );
  }

  client = new JWT({
    email: credentials.client_email,
    // Environment variables flatten newlines; the PEM parser needs them back.
    key: credentials.private_key.replace(/\\n/g, '\n'),
    scopes: SCOPES,
  });

  return client;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
}

async function driveRequest<T>(
  path: string,
  params: Record<string, string>
): Promise<T> {
  const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await getClient().request<T>({ url: url.toString() });
  return response.data;
}

function toStub(file: DriveFile): ExternalSource {
  return {
    externalId: file.id,
    title: file.name || 'Untitled',
    url: file.webViewLink ?? `https://drive.google.com/open?id=${file.id}`,
    content: '',
  };
}

/** `'` is the only character that can break out of a Drive query string. */
function escapeQuery(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export const driveProvider: SourceProvider = {
  id: 'drive',
  label: 'Google Drive',

  isConfigured() {
    return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  },

  async list() {
    const data = await driveRequest<{ files?: DriveFile[] }>('files', {
      q: `trashed=false and (${MIME_FILTER})`,
      fields: 'files(id,name,mimeType,webViewLink)',
      orderBy: 'modifiedTime desc',
      pageSize: String(PAGE_SIZE),
      // Shared drives are off by default in the v3 API; a service account is
      // just as likely to have been given access through one as through My
      // Drive, so ask for both.
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
    });

    return (data.files ?? []).map(toStub);
  },

  async search(term: string) {
    const trimmed = term.trim();
    if (!trimmed) return [];

    const data = await driveRequest<{ files?: DriveFile[] }>('files', {
      q: `trashed=false and (${MIME_FILTER}) and (name contains '${escapeQuery(trimmed)}' or fullText contains '${escapeQuery(trimmed)}')`,
      fields: 'files(id,name,mimeType,webViewLink)',
      pageSize: String(PAGE_SIZE),
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
    });

    return (data.files ?? []).map(toStub);
  },

  async fetch(externalId: string) {
    const file = await driveRequest<DriveFile>(`files/${externalId}`, {
      fields: 'id,name,mimeType,webViewLink',
      supportsAllDrives: 'true',
    });

    if (!file?.id) return null;

    const exportAs = EXPORTABLE[file.mimeType];
    const url = new URL(
      `https://www.googleapis.com/drive/v3/files/${externalId}${
        exportAs ? '/export' : ''
      }`
    );

    if (exportAs) {
      url.searchParams.set('mimeType', exportAs);
    } else if (READABLE.has(file.mimeType)) {
      url.searchParams.set('alt', 'media');
      url.searchParams.set('supportsAllDrives', 'true');
    } else {
      // A PDF or an image has no text this can read. Return the stub so the
      // source still lists and links, with an empty body the cache preserves.
      return toStub(file);
    }

    const response = await getClient().request<string>({
      url: url.toString(),
      responseType: 'text',
    });

    return {
      ...toStub(file),
      content: String(response.data ?? '').slice(0, MAX_CHARS),
    };
  },
};
