import type { ExternalSource, SourceProvider } from './provider';

/**
 * Web pages as sources.
 *
 * Closes a loop the research agent left open: it finds URLs and you can drop
 * one into the draft as a citation, but until now you couldn't *pin* one, so
 * Claude could never read the source it had just recommended. This provider
 * fetches a page's readable text so a pinned URL reaches the Context Bundle
 * like any Notion page.
 *
 * Unlike the other providers there is nothing to enumerate — the web isn't a
 * corpus you can list — so `list()` returns nothing and pages enter the cache
 * by being added explicitly. Once cached they behave exactly like every other
 * source, which is the point of the interface.
 */

/** Pages beyond this are truncated; the bundle budgets far less anyway. */
const MAX_CHARS = 200_000;

/** A page that never finishes shouldn't hold a pin request open. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Rejects anything that isn't a public http(s) URL.
 *
 * This provider fetches a URL supplied by the browser, so without a check the
 * server would happily request `http://localhost:5432` or cloud metadata
 * endpoints on the caller's behalf.
 */
export function normaliseUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();

  if (
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  ) {
    return null;
  }

  // Literal private and link-local ranges. DNS names resolving into them are
  // not caught here — a deeper defence would need to resolve and pin the
  // address, which is more than a single-user tool warrants.
  if (
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^0\./.test(host)
  ) {
    return null;
  }

  // The fragment is a position within a page, never a different page, so
  // dropping it keeps one page from being cached under several ids.
  url.hash = '';
  return url.toString();
}

const BLOCK_ELEMENTS =
  /<\/(?:p|div|section|article|header|footer|li|ul|ol|h[1-6]|blockquote|pre|tr|table|br)\s*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Reduces an HTML page to readable text.
 *
 * Deliberately crude: Claude reads this, not a person, so losing the layout
 * costs nothing and a real readability parser would be a large dependency for
 * the benefit. Scripts, styles, and navigation chrome go first because they are
 * pure noise in a Context Bundle.
 */
export function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : '';

  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1\s*>/gi, '')
      .replace(BLOCK_ELEMENTS, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, text: text.slice(0, MAX_CHARS) };
}

export const webProvider: SourceProvider = {
  id: 'web',
  label: 'Web',

  // No credentials to hold — a URL is all it needs.
  isConfigured: () => true,

  // The web can't be enumerated. Pages arrive by being added explicitly and
  // live in the cache from then on, which is where the Sources pane reads them.
  list: async () => [],

  /**
   * Treats a pasted URL as its own search result, so typing one into the
   * Sources pane's search box offers it for pinning.
   */
  search: async (term: string): Promise<ExternalSource[]> => {
    const url = normaliseUrl(term);
    if (!url) return [];
    return [{ externalId: url, title: url, url, content: '' }];
  },

  fetch: async (externalId: string): Promise<ExternalSource | null> => {
    const url = normaliseUrl(externalId);
    if (!url) return null;

    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        // Some sites serve a stub to unknown clients; identify honestly and
        // ask for HTML rather than pretending to be a browser.
        'User-Agent': 'WritingStudio/1.0 (personal writing tool)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
      },
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const body = await response.text();

    if (contentType.includes('text/html')) {
      const { title, text } = htmlToText(body);
      return { externalId: url, title: title || url, url, content: text };
    }

    if (contentType.includes('text/') || contentType.includes('json')) {
      return {
        externalId: url,
        title: url,
        url,
        content: body.slice(0, MAX_CHARS),
      };
    }

    // A PDF or an image has no text this can read; say so rather than caching
    // bytes that would reach Claude as noise.
    throw new Error(`Can't read ${contentType || 'that content type'} as text`);
  },
};
