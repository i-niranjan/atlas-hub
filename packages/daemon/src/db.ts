import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DB = Database.Database;

/** Append-only: never edit a shipped migration, add a new one. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    root_path   TEXT NOT NULL UNIQUE,
    git_remote  TEXT,
    first_seen  TEXT NOT NULL,
    last_active TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id                TEXT PRIMARY KEY,
    project_id        TEXT NOT NULL REFERENCES projects(id),
    transcript_path   TEXT NOT NULL,
    title             TEXT,
    byte_offset       INTEGER NOT NULL DEFAULT 0,
    processed_turns   INTEGER NOT NULL DEFAULT 0,
    state             TEXT NOT NULL DEFAULT 'pending',
    error             TEXT,
    last_processed_at TEXT
  );
  CREATE INDEX sessions_project ON sessions(project_id);

  CREATE TABLE entries (
    rowid             INTEGER PRIMARY KEY,
    id                TEXT NOT NULL UNIQUE,
    project_id        TEXT NOT NULL REFERENCES projects(id),
    kind              TEXT NOT NULL,
    title             TEXT NOT NULL,
    summary           TEXT NOT NULL,
    rationale         TEXT NOT NULL,
    alternatives_json TEXT NOT NULL DEFAULT '[]',
    status            TEXT NOT NULL,
    supersedes_id     TEXT,
    confidence        REAL NOT NULL,
    review_state      TEXT NOT NULL,
    source            TEXT NOT NULL,
    decided_at        TEXT NOT NULL,
    created_at        TEXT NOT NULL
  );
  CREATE INDEX entries_project ON entries(project_id, decided_at);
  CREATE INDEX entries_supersedes ON entries(supersedes_id);

  CREATE TABLE evidence (
    id           INTEGER PRIMARY KEY,
    entry_id     TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    session_id   TEXT NOT NULL,
    message_uuid TEXT NOT NULL,
    quote        TEXT NOT NULL,
    UNIQUE (entry_id, quote)
  );

  CREATE VIRTUAL TABLE entries_fts USING fts5(
    title, summary, rationale,
    content='entries', content_rowid='rowid',
    tokenize='porter unicode61'
  );
  CREATE TRIGGER entries_ai AFTER INSERT ON entries BEGIN
    INSERT INTO entries_fts(rowid, title, summary, rationale)
    VALUES (new.rowid, new.title, new.summary, new.rationale);
  END;
  CREATE TRIGGER entries_ad AFTER DELETE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, title, summary, rationale)
    VALUES ('delete', old.rowid, old.title, old.summary, old.rationale);
  END;
  CREATE TRIGGER entries_au AFTER UPDATE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, title, summary, rationale)
    VALUES ('delete', old.rowid, old.title, old.summary, old.rationale);
    INSERT INTO entries_fts(rowid, title, summary, rationale)
    VALUES (new.rowid, new.title, new.summary, new.rationale);
  END;

  CREATE TABLE lenses (
    id         TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    title      TEXT NOT NULL,
    prompt     TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
];

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
