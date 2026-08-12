import { Client, isFullPage, isFullBlock } from '@notionhq/client';
import type {
  BlockObjectResponse,
  PageObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import type { ExternalSource, SourceProvider } from './provider';

/**
 * Notion, via an internal integration token — no OAuth.
 *
 * Setup: create an integration at notion.so/my-integrations, then share each
 * page or database you want visible with it. Read-only: nothing here writes
 * back to Notion.
 */

let notion: Client | null = null;

function getClient(): Client {
  if (!notion) {
    const auth = process.env.NOTION_INTEGRATION_TOKEN;
    if (!auth) throw new Error('NOTION_INTEGRATION_TOKEN is not set');
    notion = new Client({ auth });
  }
  return notion;
}

/** Notion paginates at 100; one page of results is plenty for a personal tool. */
const PAGE_SIZE = 100;
/** How deep to follow toggles, columns, and nested lists. */
const MAX_BLOCK_DEPTH = 3;

export const notionProvider: SourceProvider = {
  id: 'notion',
  label: 'Notion',

  isConfigured() {
    return Boolean(process.env.NOTION_INTEGRATION_TOKEN);
  },

  async list() {
    const response = await getClient().search({
      filter: { property: 'object', value: 'page' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      page_size: PAGE_SIZE,
    });

    return response.results
      .filter(isFullPage)
      .map((page) => toSourceStub(page));
  },

  async search(queryText: string) {
    const response = await getClient().search({
      query: queryText,
      filter: { property: 'object', value: 'page' },
      page_size: PAGE_SIZE,
    });

    return response.results
      .filter(isFullPage)
      .map((page) => toSourceStub(page));
  },

  async fetch(externalId: string) {
    const client = getClient();

    const page = await client.pages.retrieve({ page_id: externalId });
    if (!isFullPage(page)) return null;

    const stub = toSourceStub(page);
    const content = await readBlocks(externalId, 0);

    return { ...stub, content };
  },
};

/** Page metadata without its body — enough to show a row in the Sources pane. */
function toSourceStub(page: PageObjectResponse): ExternalSource {
  return {
    externalId: page.id,
    title: extractTitle(page),
    url: page.url ?? null,
    content: '',
  };
}

function extractTitle(page: PageObjectResponse): string {
  for (const property of Object.values(page.properties)) {
    if (property.type === 'title') {
      const text = property.title.map((part) => part.plain_text).join('').trim();
      if (text) return text;
    }
  }
  return 'Untitled';
}

/**
 * Walks a page's block tree and flattens it to plain text.
 *
 * Markdown-ish markers are kept for headings, list items, and quotes because
 * they carry structure the model can use; everything else becomes bare text.
 */
async function readBlocks(blockId: string, depth: number): Promise<string> {
  if (depth > MAX_BLOCK_DEPTH) return '';

  const client = getClient();
  const lines: string[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: PAGE_SIZE,
    });

    for (const block of response.results) {
      if (!isFullBlock(block)) continue;

      const line = renderBlock(block);
      if (line !== null) lines.push(line);

      if (block.has_children) {
        const nested = await readBlocks(block.id, depth + 1);
        if (nested.trim()) {
          lines.push(
            nested
              .split('\n')
              .map((nestedLine) => (nestedLine ? `  ${nestedLine}` : nestedLine))
              .join('\n')
          );
        }
      }
    }

    cursor = response.next_cursor ?? undefined;
  } while (cursor);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function renderBlock(block: BlockObjectResponse): string | null {
  const text = richTextOf(block);

  switch (block.type) {
    case 'heading_1':
      return `\n# ${text}`;
    case 'heading_2':
      return `\n## ${text}`;
    case 'heading_3':
      return `\n### ${text}`;
    case 'bulleted_list_item':
      return `- ${text}`;
    case 'numbered_list_item':
      return `1. ${text}`;
    case 'to_do':
      return `- [${block.to_do.checked ? 'x' : ' '}] ${text}`;
    case 'quote':
      return `> ${text}`;
    case 'code':
      return `\`\`\`${block.code.language}\n${text}\n\`\`\``;
    case 'callout':
      return `> ${text}`;
    case 'divider':
      return '---';
    case 'paragraph':
      return text;
    case 'toggle':
      return text;
    default:
      // Images, embeds, tables, child pages, unsupported types: skip rather
      // than emit noise the model would have to ignore.
      return text || null;
  }
}

/**
 * Pulls the rich_text array off whichever block variant this is.
 * Notion types these per-variant, so a narrow cast is the pragmatic read.
 */
function richTextOf(block: BlockObjectResponse): string {
  const payload = (block as unknown as Record<string, { rich_text?: { plain_text: string }[] }>)[
    block.type
  ];

  if (!payload?.rich_text) return '';
  return payload.rich_text.map((part) => part.plain_text).join('').trim();
}
