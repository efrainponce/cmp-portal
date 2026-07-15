-- D1 mirror schema (plan 1 + write-path outbox). Idempotent.
CREATE TABLE IF NOT EXISTS items (
  board_id       INTEGER NOT NULL,
  item_id        INTEGER NOT NULL,
  parent_item_id INTEGER,
  name           TEXT NOT NULL,
  group_id       TEXT,
  vendedor_ids   TEXT NOT NULL DEFAULT '[]',
  monday_updated_at TEXT,
  synced_at      TEXT NOT NULL,
  content_hash   TEXT NOT NULL DEFAULT '',
  columns        TEXT NOT NULL,
  PRIMARY KEY (board_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_item_id);
CREATE INDEX IF NOT EXISTS idx_items_board  ON items(board_id);

CREATE TABLE IF NOT EXISTS identity (
  email          TEXT PRIMARY KEY,
  phone          TEXT UNIQUE,
  nombre         TEXT,
  monday_user_id INTEGER NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('vendedor','compras','admin','cliente')),
  active         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS outbox (   -- portal->Monday writes: optimistic D1 first
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id     INTEGER NOT NULL,
  item_id      INTEGER NOT NULL,
  cols         TEXT NOT NULL,         -- JSON {colId: value} as sent to Monday
  content_hash TEXT NOT NULL,         -- canonical hash of the written state (echo check)
  author_email TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','sent','confirmed','conflict','failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_item ON outbox(board_id, item_id, status);

CREATE TABLE IF NOT EXISTS wa_conversations (  -- WhatsApp bot: one row per phone
  phone      TEXT PRIMARY KEY,                 -- normalized (last 10 digits)
  messages   TEXT NOT NULL DEFAULT '[]',       -- Anthropic MessageParam[] JSON
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_processed (      -- WhatsApp webhook dedupe (Meta retries)
  msg_id TEXT PRIMARY KEY,
  at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                 -- webhook|reconcile|manual|outbox
  board_id INTEGER, item_id INTEGER,
  ok INTEGER NOT NULL, detail TEXT, at TEXT NOT NULL
);
