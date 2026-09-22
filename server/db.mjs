import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDir = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(serverDir, '..')
const databasePath = path.resolve(process.env.BLOODWORK_DB_PATH || path.resolve(appDir, 'data/bloodwork.sqlite'))

const readOnly = process.env.BLOODWORK_DB_READONLY === '1'
if (!readOnly) fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 })
process.umask(0o077)

export const db = new Database(databasePath, { readonly: readOnly, fileMustExist: readOnly })
if (!readOnly) db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

function tableExists(name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
}

function tableHasColumn(table, column) {
  return tableExists(table) && db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column)
}

function migrateLegacySchema() {
  db.pragma('foreign_keys = OFF')
  const migrate = db.transaction(() => {
    db.exec(`
      INSERT OR IGNORE INTO profiles(id, name) VALUES (1, 'Personal profile');

      CREATE TABLE markers_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
        name TEXT NOT NULL COLLATE NOCASE,
        unit TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(profile_id, category_id, name)
      );

      INSERT INTO markers_v2(id, profile_id, category_id, name, unit, created_at)
      SELECT id, 1, category_id, name, unit, created_at FROM markers;

      CREATE TABLE records_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        marker_id INTEGER NOT NULL REFERENCES markers_v2(id) ON DELETE CASCADE,
        measured_on TEXT NOT NULL,
        value_numeric REAL,
        value_text TEXT,
        lab TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK(value_numeric IS NOT NULL OR length(trim(coalesce(value_text, ''))) > 0),
        UNIQUE(profile_id, marker_id, measured_on)
      );

      INSERT INTO records_v2(id, profile_id, marker_id, measured_on, value_numeric, value_text, lab, notes, created_at, updated_at)
      SELECT id, 1, marker_id, measured_on, value_numeric, value_text, lab, notes, created_at, updated_at FROM records;

      DROP TABLE records;
      DROP TABLE markers;
      ALTER TABLE markers_v2 RENAME TO markers;
      ALTER TABLE records_v2 RENAME TO records;
    `)
  })
  try { migrate() } finally { db.pragma('foreign_keys = ON') }
}

export function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `)

  if (tableExists('markers') && !tableHasColumn('markers', 'profile_id')) migrateLegacySchema()

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(length(trim(username)) BETWEEN 3 AND 40)
    );

    CREATE TABLE IF NOT EXISTS markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      name TEXT NOT NULL COLLATE NOCASE,
      unit TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, category_id, name)
    );

    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      marker_id INTEGER NOT NULL REFERENCES markers(id) ON DELETE CASCADE,
      measured_on TEXT NOT NULL,
      value_numeric REAL,
      value_text TEXT,
      lab TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(value_numeric IS NOT NULL OR length(trim(coalesce(value_text, ''))) > 0),
      UNIQUE(profile_id, marker_id, measured_on)
    );

    CREATE TABLE IF NOT EXISTS life_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
      starts_on TEXT NOT NULL,
      ends_on TEXT,
      notes TEXT NOT NULL DEFAULT '',
      substances TEXT NOT NULL DEFAULT '',
      color_index INTEGER NOT NULL CHECK(color_index >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(ends_on IS NULL OR ends_on >= starts_on)
    );

    CREATE TABLE IF NOT EXISTS ai_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      marker_ids TEXT NOT NULL DEFAULT '[]',
      range_start TEXT,
      range_end TEXT,
      system_prompt TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL CHECK(length(trim(content)) > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_markers_profile ON markers(profile_id, category_id, name);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_records_profile_date ON records(profile_id, measured_on);
    CREATE INDEX IF NOT EXISTS idx_records_marker_date ON records(marker_id, measured_on);
    CREATE INDEX IF NOT EXISTS idx_life_events_profile_date ON life_events(profile_id, starts_on, ends_on);
    CREATE INDEX IF NOT EXISTS idx_ai_chats_profile_updated ON ai_chats(profile_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_chat ON ai_chat_messages(chat_id, id);

    CREATE TRIGGER IF NOT EXISTS records_profile_guard_insert
    BEFORE INSERT ON records
    WHEN (SELECT profile_id FROM markers WHERE id = NEW.marker_id) != NEW.profile_id
    BEGIN
      SELECT RAISE(ABORT, 'Marker belongs to a different profile');
    END;

    CREATE TRIGGER IF NOT EXISTS records_profile_guard_update
    BEFORE UPDATE OF profile_id, marker_id ON records
    WHEN (SELECT profile_id FROM markers WHERE id = NEW.marker_id) != NEW.profile_id
    BEGIN
      SELECT RAISE(ABORT, 'Marker belongs to a different profile');
    END;

    INSERT OR IGNORE INTO profiles(id, name) VALUES (1, 'Personal profile');

  `)

  // Legacy profiles remain available to the administrator; never guess ownership.
  if (!tableHasColumn('profiles', 'owner_user_id')) db.exec('ALTER TABLE profiles ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL')
  for (const column of ['raw_value', 'unit', 'reference_range', 'method', 'provenance']) {
    if (!tableHasColumn('records', column)) db.exec(`ALTER TABLE records ADD COLUMN ${column} TEXT`)
  }
  db.exec(`
    UPDATE records SET unit = (SELECT unit FROM markers WHERE markers.id = records.marker_id) WHERE unit IS NULL;
    UPDATE records SET raw_value = coalesce(CAST(value_numeric AS TEXT), value_text) WHERE raw_value IS NULL;
    CREATE INDEX IF NOT EXISTS idx_profiles_owner ON profiles(owner_user_id);
    INSERT OR IGNORE INTO categories(name, sort_order) VALUES ('General', 0);
  `)

  if (!tableHasColumn('life_events', 'notes')) db.exec("ALTER TABLE life_events ADD COLUMN notes TEXT NOT NULL DEFAULT ''")
  if (!tableHasColumn('life_events', 'substances')) db.exec("ALTER TABLE life_events ADD COLUMN substances TEXT NOT NULL DEFAULT ''")
  if (!tableHasColumn('ai_chats', 'range_start')) db.exec('ALTER TABLE ai_chats ADD COLUMN range_start TEXT')
  if (!tableHasColumn('ai_chats', 'range_end')) db.exec('ALTER TABLE ai_chats ADD COLUMN range_end TEXT')
}

export const paths = { appDir, databasePath }
