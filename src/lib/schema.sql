-- Writing Studio schema.
-- Single-user app: no user_id columns, the whole DB belongs to the one Auth.js user.
-- Run with: npm run db:migrate

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL DEFAULT 'Untitled',
  -- TipTap JSON document. Kept as jsonb so we can query/inspect it later.
  content     JSONB NOT NULL DEFAULT '{"type":"doc","content":[]}'::jsonb,
  -- Denormalised plain text of `content`, maintained by the app on every save.
  -- The Context Bundle reads this instead of walking the JSON on every AI call.
  plain_text  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_updated_at_idx ON documents (updated_at DESC);

-- One dockview layout per document.
CREATE TABLE IF NOT EXISTS layouts (
  document_id           UUID PRIMARY KEY REFERENCES documents (id) ON DELETE CASCADE,
  dockview_layout_json  JSONB NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cached external sources. `provider` + `external_id` is the natural key so a
-- re-sync updates in place rather than duplicating.
CREATE TABLE IF NOT EXISTS sources (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider       TEXT NOT NULL,
  external_id    TEXT NOT NULL,
  title          TEXT NOT NULL DEFAULT 'Untitled',
  url            TEXT,
  content_cache  TEXT NOT NULL DEFAULT '',
  last_synced    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS sources_provider_idx ON sources (provider);

-- Which sources are pinned into a given document's Context Bundle.
CREATE TABLE IF NOT EXISTS pinned_context (
  document_id  UUID NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  source_id    UUID NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  pinned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, source_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_document_idx
  ON chat_messages (document_id, created_at);

-- Point-in-time snapshots of a draft.
--
-- This app rewrites your prose in place from the ask popover, and autosave
-- overwrites the only copy — so undo dying on reload would mean a paragraph you
-- liked is simply gone. A snapshot holds the content as it was BEFORE the save
-- that created it, which is what makes "restore" mean "put it back".
CREATE TABLE IF NOT EXISTS document_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  title        TEXT NOT NULL DEFAULT 'Untitled',
  content      JSONB NOT NULL,
  plain_text   TEXT NOT NULL DEFAULT '',
  -- Why it was taken: 'auto', 'ai', or 'manual'. Shown in the Versions pane.
  reason       TEXT NOT NULL DEFAULT 'auto',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_versions_document_idx
  ON document_versions (document_id, created_at DESC);

-- One goals record per document.
CREATE TABLE IF NOT EXISTS goals (
  document_id  UUID PRIMARY KEY REFERENCES documents (id) ON DELETE CASCADE,
  content      TEXT NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
