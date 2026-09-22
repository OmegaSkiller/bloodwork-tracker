import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hashPassword, verifyPassword, validatePassword } from '../server/passwords.mjs'

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bloodwork-migration-'))
process.env.BLOODWORK_DB_PATH = path.join(folder, 'legacy.sqlite')
const { db, createSchema } = await import('../server/db.mjs')
after(() => { db.close(); fs.rmSync(folder, { recursive: true, force: true }) })

test('legacy passwords can migrate without weakening the policy for new credentials', async () => {
  const legacy = 'old-pass'
  assert.throws(() => validatePassword(legacy), /12 and 256/)
  const migrated = await hashPassword(legacy)
  assert.equal(await verifyPassword(legacy, migrated), true)
  assert.equal(await verifyPassword('wrong-pass', migrated), false)
})

test('upgrade a populated historical schema without renaming, deleting, or guessing profile ownership', () => {
  db.exec(`
    CREATE TABLE profiles(id INTEGER PRIMARY KEY, name TEXT UNIQUE, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE categories(id INTEGER PRIMARY KEY, name TEXT UNIQUE, sort_order INTEGER DEFAULT 0);
    CREATE TABLE markers(id INTEGER PRIMARY KEY, profile_id INTEGER REFERENCES profiles(id), category_id INTEGER REFERENCES categories(id), name TEXT, unit TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(profile_id, category_id, name));
    CREATE TABLE records(id INTEGER PRIMARY KEY, profile_id INTEGER REFERENCES profiles(id), marker_id INTEGER REFERENCES markers(id), measured_on TEXT, value_numeric REAL, value_text TEXT, lab TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(profile_id, marker_id, measured_on));
    INSERT INTO profiles(id, name) VALUES (1, 'Synthetic legacy profile');
    INSERT INTO categories(id, name) VALUES (1, 'Synthetic category');
    INSERT INTO markers(id, profile_id, category_id, name, unit) VALUES (1, 1, 1, 'Synthetic marker', 'mmol/L');
    INSERT INTO records(id, profile_id, marker_id, measured_on, value_numeric, lab, notes) VALUES (1, 1, 1, '2024-02-29', 1.25, 'Synthetic lab', 'Keep this note');
    CREATE TABLE private_tool_metadata(id INTEGER PRIMARY KEY, value TEXT);
    INSERT INTO private_tool_metadata VALUES (1, 'Synthetic provenance');
  `)
  createSchema()
  const row = db.prepare('SELECT * FROM records WHERE id=1').get()
  assert.equal(row.unit, 'mmol/L')
  assert.equal(row.raw_value, '1.25')
  assert.equal(row.notes, 'Keep this note')
  const profile = db.prepare('SELECT * FROM profiles WHERE id=1').get()
  assert.equal(profile.name, 'Synthetic legacy profile')
  assert.equal(profile.owner_user_id, null)
  assert.equal(db.prepare('SELECT value FROM private_tool_metadata').get().value, 'Synthetic provenance')
  createSchema()
  assert.deepEqual(db.prepare('SELECT * FROM records WHERE id=1').get(), row)
  assert.deepEqual(db.pragma('foreign_key_check'), [])
})
