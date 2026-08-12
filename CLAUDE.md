@AGENTS.md

# Writing Studio — project notes

Personal single-user writing app. See README.md for setup, architecture, and
deployment. This file records decisions whose *reasoning* isn't obvious from the
code, so they don't get relitigated.

## Live

- Production: https://writing-studio-five.vercel.app
- Repo: https://github.com/aayanali808/writing-studio (public)
- Vercel project: `aayanali808s-projects/writing-studio`; database is Neon via
  the Vercel Marketplace integration.

## Decisions

**Next 16 + React 19, not Next 14.** The spec said 14, but 14.2.35 is the last
14.x and still carries two unpatched high-severity advisories. Note Next 16
renames `middleware.ts` to `proxy.ts` — that's why the gate lives in `src/proxy.ts`.

**Claude Sonnet 5 everywhere** (`MODEL` in `src/lib/anthropic.ts`). At ~100 calls
a month against an ~8K-token Context Bundle: Sonnet 5 ≈ $3.40/mo, Opus 5 ≈ $8.50.
Budget is ~$4/mo. Opus 5 tops writing benchmarks but not by enough to justify
2.5x here. Kimi K3 was evaluated and rejected: it is *more* expensive than
Sonnet 5 ($2.80/$14 vs $2/$10) and has no server-side web search, which would
break the research agent.

**Effort is per-task** (`EFFORT` in `src/lib/anthropic.ts`). Sonnet 5 honours
effort more strictly than Opus 5 at the low end, so highlight-to-ask runs at
`medium` — `low` under-thinks a nuanced rewrite.

**Research runs at `low` effort with the basic `web_search_20250305` tool.**
Both are latency decisions, not quality ones. Measured on the live deployment:
`high` + `web_search_20260209` blew the 60s Vercel Hobby function ceiling
outright (bare 504); `medium` spent the whole budget deliberating without
completing a single search. The `_20260209` variant filters results by running
code execution under the hood — a round trip per search. On a plan with a longer
`maxDuration`, raise all three back up.

**The schema applies itself on deploy.** `vercel-build` runs `scripts/migrate.mjs`
before `next build` (Vercel prefers `vercel-build` over `build`). This exists
because the Neon integration provisions an *empty* database and the first deploy
500'd with `relation "documents" does not exist`. A reachable database is
therefore a build dependency on Vercel — intended, so a bad deploy fails rather
than shipping a broken app. Local `npm run build` is unaffected.

## Invariants worth not breaking

**The Context Bundle is assembled server-side from Postgres**, never from the
browser — one source of truth. Consequence: every AI call in the UI must
`await flushSave()` first, or Claude answers against a stale draft. If you add a
fourth AI feature, call `contextSystemPrompt()` rather than re-deriving context.

**`documents.plain_text` is derived in `saveDocument()`**, not trusted from the
client, so it can't drift from `content`.

**Source bodies are fetched at pin time**, not list time — `list()`/`search()`
return `content: ''` and the cache layer preserves existing text on empty.

**Replace inserts inline for single-paragraph answers.** Inserting a paragraph
node mid-paragraph makes ProseMirror split around it, which orphaned the rest of
the paragraph. See `replaceRange` in `src/components/editor/editor-utils.ts`.

## Known, not yet fixed

- The research verdict renders raw markdown (`## heading`, `**bold**`) as literal
  text in the Research Results pane. Either tighten the prompt or render markdown.
- Insert-citation writes at the editor cursor, so it needs the Writing pane
  visible; by default it's tabbed with Research Results, which hides one behind
  the other.
- The Context Bundle orders sections goals → draft → sources, i.e. volatile
  before stable, and sets no `cache_control`. Reordering to put pinned sources
  first and adding a cache breakpoint would cut input cost ~20–30% when sources
  are pinned. Sonnet 5's cache minimum is 1024 tokens.
