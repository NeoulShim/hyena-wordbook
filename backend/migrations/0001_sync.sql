CREATE TABLE IF NOT EXISTS board_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  commit_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
INSERT OR IGNORE INTO board_meta (id) VALUES (1);
CREATE TABLE IF NOT EXISTS board_chunks (part INTEGER PRIMARY KEY, content TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  key_version TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS login_attempts (
  bucket_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
