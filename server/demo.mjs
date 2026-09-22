import fs from 'node:fs'
import path from 'node:path'
import { demoEntries, demoProfile } from '../demo/history.mjs'
import { hashPassword } from './passwords.mjs'

const databasePath = path.resolve(process.env.BLOODWORK_DB_PATH || './data/bloodwork.sqlite')
fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 })
// Reserve the destination atomically. Even an empty existing database is left alone.
try { fs.closeSync(fs.openSync(databasePath, 'wx', 0o600)) }
catch (error) {
  if (error.code === 'EEXIST') {
    console.error('Demo refused: the database already exists. Choose a new BLOODWORK_DB_PATH; no existing data was changed.')
    process.exit(1)
  }
  throw error
}
process.env.BLOODWORK_DB_PATH = databasePath
const { db, createSchema } = await import('./db.mjs')
const { importEntries } = await import('./import.mjs')
try {
  createSchema()
  const passwordHash = await hashPassword('synthetic-demo-only')
  db.transaction(() => {
    const userId = Number(db.prepare("INSERT INTO users(username, password_hash, role) VALUES ('demo', ?, 'admin')").run(passwordHash).lastInsertRowid)
    db.prepare('UPDATE profiles SET name = ?, owner_user_id = ? WHERE id = 1').run(demoProfile, userId)
    importEntries(demoEntries, { profileId: 1, profileName: demoProfile, dryRun: false })
    db.prepare("INSERT INTO profiles(name, owner_user_id) VALUES ('Empty synthetic profile', ?)").run(userId)
    db.prepare("INSERT INTO life_events(profile_id, title, starts_on, ends_on, notes, substances, color_index) VALUES (1, 'Example routine change', '2025-01-01', '2025-06-30', 'Fictional annotation; no causal claim.', '', 0)").run()
  })()
  console.log('Created synthetic demo. Sign in as demo / synthetic-demo-only. Never use these public credentials with real data or an internet-accessible service.')
} finally { db.close() }
