import { randomBytes } from 'node:crypto'
import { db, createSchema } from './db.mjs'
import { hashPassword } from './passwords.mjs'

try {
  createSchema()
  if (db.prepare('SELECT count(*) AS n FROM users').get().n) throw new Error('Setup refused: users already exist. Existing credentials were not changed.')
  const username = process.env.AUTH_USERNAME || 'admin'
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$/.test(username)) throw new Error('AUTH_USERNAME must contain 3–40 letters, numbers, dots, underscores, or hyphens.')
  const password = randomBytes(18).toString('base64url')
  const passwordHash = await hashPassword(password)
  db.transaction(() => {
    if (db.prepare('SELECT count(*) AS n FROM users').get().n) throw new Error('Setup already completed.')
    const id = Number(db.prepare("INSERT INTO users(username, password_hash, role) VALUES (?, ?, 'admin')").run(username, passwordHash).lastInsertRowid)
    db.prepare('UPDATE profiles SET owner_user_id = ? WHERE owner_user_id IS NULL').run(id)
  }).immediate()
  console.log(`Administrator created: ${username}\nPassword (save it now in a password manager): ${password}`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally { db.close() }
