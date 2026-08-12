# Writing Studio

A personal, single-user workspace for long-form writing, with an AI layer that
is context-aware of the piece you're writing and of your external notes.

The interface is a rearrangeable pane workspace — drag, resize, float, close,
reopen — not a fixed three-column layout. The arrangement is saved per document.

## Panes

| Pane | What it does |
| --- | --- |
| **Writing** | TipTap editor with autosave. Highlight any passage for the floating ask toolbar. |
| **AI Chat** | Conversation about the piece. Every turn carries the Context Bundle. |
| **Sources** | Read-only external material (Notion today), pinnable into the Context Bundle. |
| **Goals** | Free-text goals for the piece — audience, argument, constraints, tone. |
| **Research Results** | Web sources found by the research agent, insertable as citations. |

## The Context Bundle

`src/lib/context-bundle.ts` is the one place that decides what Claude knows
about your work: **the current draft + your goals + every pinned source**. Chat,
highlight-to-ask, and the research agent all call it, so adding a fourth AI
feature means calling `contextSystemPrompt()` rather than re-deriving context.

The bundle is assembled server-side from Postgres, never from the browser. That
means the draft has to be on disk before an AI call goes out, so every AI action
in the UI awaits `flushSave()` first.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind · TipTap · dockview · Postgres
(`pg`) · Auth.js (single hardcoded Credentials user) · Anthropic API
(`claude-sonnet-5`, including Claude's server-side web search tool)

### Model and cost

Everything runs on Claude Sonnet 5, set in one place — `MODEL` in
`src/lib/anthropic.ts`. At roughly 100 calls a month against an ~8K-token
Context Bundle that works out to about **$3.40/month** ($2/$10 per MTok);
the same workload on Opus 5 is about $8.50. Point `MODEL` at `claude-opus-5`
if a particular piece justifies it — nothing else needs to change.

Per-task effort lives next to it in `EFFORT`. Sonnet 5 honours effort more
strictly than Opus 5 at the low end, so the highlight-to-ask route runs at
`medium` rather than `low`: a mechanical edit is fine at `low`, but "improve
this passage" under-thinks there. Drop it if you'd rather have faster popovers.

## Setup

```bash
npm install
cp .env.example .env.local     # then fill it in — see below
npm run hash-password -- 'the-password-you-want'   # → AUTH_USER_PASSWORD_HASH
npm run db:migrate             # creates the tables
npm run dev
```

### Environment variables

| Variable | Where to get it |
| --- | --- |
| `DATABASE_URL` | Neon or Supabase. Use the **pooled** connection string — Neon's `-pooler` host, or Supabase's port 6543. |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_USER_EMAIL` | The one email allowed to sign in. |
| `AUTH_USER_PASSWORD_HASH` | `npm run hash-password -- 'your-password'` |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys |
| `NOTION_INTEGRATION_TOKEN` | Optional. https://www.notion.so/my-integrations — create an *internal* integration, then share the pages and databases you want visible with it. |

There is no signup and no user table: the single account is defined entirely by
those three `AUTH_*` variables.

## Deploying to Vercel

1. Push this repo to GitHub and import it at vercel.com/new.
2. Add all the environment variables above under **Settings → Environment
   Variables** (Production, Preview, and Development).
3. Run `npm run db:migrate` once against the production `DATABASE_URL`, or paste
   `src/lib/schema.sql` into the Neon/Supabase SQL editor.
4. Deploy.

**Function timeouts.** The AI routes set `maxDuration = 60`, which is the
ceiling on Vercel's Hobby plan. The research agent is the one that can approach
it — it runs several web searches per request at `EFFORT.RESEARCH` (`high`). On Pro you
can raise `maxDuration` to 300 in
`src/app/api/documents/[id]/research/route.ts`; on Hobby, if searches get cut
off, drop `EFFORT.RESEARCH` to `'medium'` or lower `WEB_SEARCH_TOOL.max_uses`
in `src/lib/anthropic.ts`.

## Adding a source provider

`src/lib/sources/provider.ts` defines the interface — `list()`, `fetch(id)`,
`search(query)`. Implement it in a new file, then add it to the array in
`src/lib/sources/registry.ts`. Nothing else changes: caching, pinning, and the
Sources pane are all provider-agnostic.

Providers return titles and URLs from `list()`/`search()` and leave `content`
empty; the body is fetched only when a source is pinned, since that is the point
at which its text actually goes to Claude.

## Layout of the code

```
src/
  app/
    studio/page.tsx              the workspace (?doc=<id> opens a piece)
    login/page.tsx               the single-user sign-in
    api/documents/[id]/...       draft, layout, goals, chat, pins, sources, ask, research
  components/
    studio/StudioContext.tsx     shared client state for all panes
    studio/Workspace.tsx         dockview host + layout persistence
    panes/                       the five panes
    editor/                      TipTap glue: selection reading, toolbar, ask popover
  lib/
    context-bundle.ts            what Claude knows (see above)
    anthropic.ts                 model id + web search tool config
    sources/                     provider interface, registry, Postgres cache
    db.ts, documents.ts, tiptap.ts, client.ts
```

## Scripts

| Command | |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run db:migrate` | Apply `src/lib/schema.sql` (safe to re-run) |
| `npm run hash-password -- 'pw'` | Generate `AUTH_USER_PASSWORD_HASH` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
