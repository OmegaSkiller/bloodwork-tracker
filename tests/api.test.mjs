import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { hashPassword } from '../server/passwords.mjs'

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bloodwork-api-test-'))
process.env.BLOODWORK_DB_PATH = path.join(folder, 'test.sqlite')
const { db, createSchema } = await import('../server/db.mjs')
createSchema()
for (const [username, role] of [['admin', 'admin'], ['alice', 'member'], ['bob', 'member']]) {
  db.prepare('INSERT INTO users(username, password_hash, role) VALUES (?, ?, ?)').run(username, await hashPassword(`synthetic-${username}-password`), role)
}
const owner = db.prepare("SELECT id FROM users WHERE username='alice'").get().id
const profileId = Number(db.prepare("INSERT INTO profiles(name, owner_user_id) VALUES ('Synthetic Alice', ?)").run(owner).lastInsertRowid)
const otherId = Number(db.prepare("INSERT INTO profiles(name, owner_user_id) SELECT 'Synthetic Bob', id FROM users WHERE username='bob'").run().lastInsertRowid)
const categoryId = db.prepare("SELECT id FROM categories WHERE name='General'").get().id
const markerId = Number(db.prepare("INSERT INTO markers(profile_id, category_id, name, unit) VALUES (?, ?, 'Example', 'mmol/L')").run(profileId, categoryId).lastInsertRowid)
const otherMarker = Number(db.prepare("INSERT INTO markers(profile_id, category_id, name, unit) VALUES (?, ?, 'Private marker', 'U/L')").run(otherId, categoryId).lastInsertRowid)
const capture = path.join(folder, 'provider-request.json')
const server = spawn(process.execPath, ['--import', './tests/helpers/provider-stub.mjs', 'server/index.mjs'], {
  env: { PATH: process.env.PATH, BLOODWORK_DB_PATH: process.env.BLOODWORK_DB_PATH, HOST: '127.0.0.1', PORT: '0', OPENAI_API_KEY: 'synthetic-provider-key-only', OPENAI_ATTEMPTS: '1', PROVIDER_CAPTURE: capture },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverError = ''
server.stderr.on('data', (value) => { serverError += value })
const base = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Server did not start: ${serverError}`)), 10000)
  server.stdout.on('data', (value) => { const match = String(value).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]) } })
  server.once('exit', () => { clearTimeout(timeout); reject(new Error(serverError)) })
})
after(async () => { server.kill(); await once(server, 'exit'); db.close(); fs.rmSync(folder, { recursive: true, force: true }) })
const cookies = {}
async function request(route, { user = 'alice', method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(cookies[user] ? { Cookie: cookies[user] } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null }
}
for (const username of ['admin', 'alice', 'bob']) {
  const login = await request('/api/auth/login', { user: username, method: 'POST', body: { username, password: `synthetic-${username}-password` } })
  assert.equal(login.status, 200)
  cookies[username] = login.headers.get('set-cookie').split(';')[0]
}
const record = { profileId, markerId, measuredOn: '2024-02-29', value: '1.2300', unit: 'mmol/L', lab: 'Synthetic A', referenceRange: '1–2', method: 'Synthetic assay' }
let recordId, eventId, chatId

test('sessions protect data and unsafe requests reject cross-origin mutation', async () => {
  assert.equal((await request('/api/bootstrap', { user: 'anonymous' })).status, 401)
  const result = await request('/api/auth/session')
  assert.equal(result.body.authenticated, true)
  assert.match(result.headers.get('cache-control'), /no-store/)
  assert.match(result.headers.get('x-robots-tag'), /noindex/)
  assert.equal((await request('/api/profiles', { method: 'POST', body: { name: 'Blocked' }, headers: { Origin: 'https://unrelated.example' } })).status, 403)
  assert.equal((await request('/api/users', { user: 'bob' })).status, 403)
})

test('development proxy accepts same-origin login and writes but rejects a foreign origin', async (t) => {
  const root = process.cwd()
  // An empty temporary cwd keeps the real .env out of Vite's configuration.
  const client = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--config', path.join(root, 'vite.config.js'), '--clearScreen', 'false'], {
    cwd: folder,
    env: { PATH: process.env.PATH, PORT: new URL(base).port, VITE_PORT: '0', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(async () => { if (client.exitCode === null && client.signalCode === null) { client.kill(); await once(client, 'exit') } })
  let diagnostic = ''
  client.stderr.on('data', (value) => { diagnostic += value })
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Development proxy did not start: ${diagnostic}`)), 10000)
    client.stdout.on('data', (value) => {
      const match = String(value).match(/http:\/\/127\.0\.0\.1:\d+/)
      if (match) { clearTimeout(timeout); resolve(match[0]) }
    })
    client.once('exit', () => { clearTimeout(timeout); reject(new Error(diagnostic)) })
  })
  const login = await fetch(`${origin}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ username: 'alice', password: 'synthetic-alice-password' }),
  })
  assert.equal(login.status, 200)
  const headers = { 'Content-Type': 'application/json', Origin: origin, Cookie: login.headers.get('set-cookie').split(';')[0] }
  const saved = await fetch(`${origin}/api/life-events`, { method: 'POST', headers, body: JSON.stringify({ profileId, title: 'Proxy test', startsOn: '2020-01-01' }) })
  assert.equal(saved.status, 201)
  const rejected = await fetch(`${origin}/api/life-events`, { method: 'POST', headers: { ...headers, Origin: 'https://unrelated.example' }, body: JSON.stringify({ profileId, title: 'Must not persist', startsOn: '2020-01-01' }) })
  assert.equal(rejected.status, 403)
  assert.equal(db.prepare("SELECT count(*) AS n FROM life_events WHERE title='Must not persist'").get().n, 0)
})

test('account ownership cannot be bypassed by changing a profile ID or catalog clone source', async () => {
  const own = await request('/api/bootstrap')
  assert.deepEqual(own.body.profiles.map((p) => p.id), [profileId])
  assert.equal((await request(`/api/bootstrap?profileId=${profileId}`, { user: 'bob' })).status, 404)
  assert.equal((await request(`/api/bootstrap?profileId=${profileId}`, { user: 'admin' })).status, 200)
  assert.equal((await request('/api/profiles', { user: 'bob', method: 'POST', body: { name: 'Unauthorized clone', cloneFromProfileId: profileId } })).status, 404)
  const created = await request('/api/profiles', { method: 'POST', body: { name: 'Empty own profile', cloneFromProfileId: profileId } })
  assert.equal(created.status, 201)
  const clone = await request(`/api/bootstrap?profileId=${created.body.id}`)
  assert.equal(clone.body.markers.length, 1)
  assert.equal(clone.body.records.length, 0)
})

test('invalid dates and values reject; duplicate result does not overwrite; new marker rolls back on failure', async () => {
  for (const change of [{ measuredOn: '2025-02-30' }, { value: '' }, { value: '1e999' }, { value: '1,25' }, { markerId: otherMarker }]) assert.equal((await request('/api/records', { method: 'POST', body: { ...record, ...change } })).status, 400)
  const failed = await request('/api/records', { method: 'POST', body: { ...record, value: '', newMarker: { categoryId, name: 'Rollback me' } } })
  assert.equal(failed.status, 400)
  assert.equal(db.prepare("SELECT count(*) AS n FROM markers WHERE name='Rollback me'").get().n, 0)
  const created = await request('/api/records', { method: 'POST', body: record })
  assert.equal(created.status, 201)
  recordId = created.body.id
  assert.equal(created.body.rawValue, '1.2300')
  assert.equal((await request('/api/records', { method: 'POST', body: { ...record, value: '9' } })).status, 400)
  assert.equal(db.prepare('SELECT raw_value FROM records WHERE id=?').get(recordId).raw_value, '1.2300')
  assert.throws(() => db.prepare('INSERT INTO records(profile_id, marker_id, measured_on, value_numeric) VALUES (?, ?, ?, 1)').run(otherId, markerId, '2025-01-01'), /different profile/)
})

test('records, events, chats and marker mutations check both account and resource profile', async () => {
  eventId = (await request('/api/life-events', { method: 'POST', body: { profileId, title: 'Synthetic event', startsOn: '2024-02-01', endsOn: '2024-03-01', notes: 'Synthetic note' } })).body.id
  const chat = { profileId, provider: 'openai', model: 'gpt-5.6', markerIds: [markerId], messages: [{ role: 'user', content: 'Synthetic question' }], dateRange: { start: '2024-02-29', end: '2024-02-29' } }
  chatId = (await request('/api/ai/chats', { method: 'POST', body: chat })).body.id
  assert.ok(eventId && chatId)
  for (const [route, method, body] of [
    [`/api/records/${recordId}`, 'PUT', record], [`/api/records/${recordId}?profileId=${profileId}`, 'DELETE'],
    ['/api/records', 'POST', record], ['/api/markers', 'POST', { profileId, categoryId, name: 'Blocked' }],
    [`/api/life-events/${eventId}`, 'PUT', { profileId, title: 'Blocked', startsOn: '2024-01-01' }],
    [`/api/life-events/${eventId}?profileId=${profileId}`, 'DELETE'],
    [`/api/ai/chats?profileId=${profileId}`, 'GET'], [`/api/ai/chats/${chatId}?profileId=${profileId}`, 'GET'],
    ['/api/ai/chats', 'POST', chat], [`/api/ai/chats/${chatId}`, 'PUT', chat], [`/api/ai/chats/${chatId}?profileId=${profileId}`, 'DELETE'],
    ['/api/ai/chat', 'POST', { ...chat, consent: true }],
  ]) assert.equal((await request(route, { user: 'bob', method, body })).status, 404, route)
  assert.equal((await request(`/api/records/${recordId}`, { user: 'bob', method: 'PUT', body: { ...record, profileId: otherId, markerId: otherMarker } })).status, 404)
  assert.equal((await request(`/api/ai/chats/${chatId}?profileId=${otherId}`, { user: 'bob' })).status, 404)
})

test('BYOK AI sends only server-built scoped context, requires consent, and binds jobs to users', async () => {
  await request('/api/records', { method: 'POST', body: { ...record, measuredOn: '2025-01-01', value: '999' } })
  const query = { profileId, provider: 'openai', markerIds: [markerId], dateRange: { start: '2024-02-29', end: '2024-02-29' }, messages: [{ role: 'user', content: 'Summarize this synthetic example' }], observations: [{ value: 'client-forged' }] }
  assert.equal((await request('/api/ai/chat', { method: 'POST', body: query })).status, 400)
  assert.equal((await request('/api/ai/chat', { method: 'POST', body: { ...query, consent: true, provider: 'ollama' } })).status, 400)
  assert.equal((await request('/api/ai/chat', { method: 'POST', body: { ...query, consent: true, markerIds: [otherMarker] } })).status, 400)
  const job = await request('/api/ai/chat', { method: 'POST', body: { ...query, consent: true } })
  assert.equal(job.status, 202)
  assert.equal((await request(`/api/ai/chat/${job.body.jobId}`, { user: 'bob' })).status, 404)
  let result
  for (let i = 0; i < 50; i++) { result = await request(`/api/ai/chat/${job.body.jobId}`); if (result.status !== 202) break; await new Promise((r) => setTimeout(r, 10)) }
  assert.equal(result.status, 200)
  const captured = JSON.parse(fs.readFileSync(capture, 'utf8'))
  assert.equal(captured.request.store, false)
  const prompt = captured.request.input[0].content
  assert.match(prompt, /1\.2300/); assert.match(prompt, /Synthetic note/)
  for (const excluded of ['999', 'client-forged', 'Synthetic Alice', 'Private marker']) assert.equal(prompt.includes(excluded), false, excluded)
  assert.equal((await request('/api/ai/openai-key', { user: 'bob' })).status, 403)
  const status = await request('/api/ai/openai-key', { user: 'admin' })
  assert.equal(JSON.stringify(status.body).includes('synthetic-provider-key-only'), false)
  const saved = await request('/api/ai/openai-key', { user: 'admin', method: 'PUT', body: { apiKey: 'synthetic-saved-key-for-test-only' } })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.source, 'settings')
  assert.equal(fs.statSync(path.join(folder, 'openai-api-key')).mode & 0o777, 0o600)
  assert.equal(JSON.stringify(saved.body).includes('synthetic-saved-key'), false)
  assert.equal((await request('/api/ai/openai-key', { user: 'admin', method: 'DELETE' })).status, 200)
})

test('a rejected provider key does not log the user out of the tracking app', async () => {
  const job = await request('/api/ai/chat', { method: 'POST', body: { profileId, provider: 'openai', consent: true, markerIds: [markerId], dateRange: { start: '2024-02-29', end: '2024-02-29' }, messages: [{ role: 'user', content: 'simulate denied key' }] } })
  let result
  for (let i = 0; i < 50; i++) { result = await request(`/api/ai/chat/${job.body.jobId}`); if (result.status !== 202) break; await new Promise((r) => setTimeout(r, 10)) }
  assert.equal(result.status, 502)
  assert.equal((await request('/api/bootstrap')).status, 200)
})

test('provider failures preserve records; account password resets revoke sessions', async () => {
  const before = db.prepare('SELECT * FROM records').all()
  const job = await request('/api/ai/chat', { method: 'POST', body: { profileId, provider: 'openai', consent: true, markerIds: [markerId], dateRange: { start: '2024-02-29', end: '2024-02-29' }, messages: [{ role: 'user', content: 'simulate failure' }] } })
  let result
  for (let i = 0; i < 50; i++) { result = await request(`/api/ai/chat/${job.body.jobId}`); if (result.status !== 202) break; await new Promise((r) => setTimeout(r, 10)) }
  assert.equal(result.status, 502)
  assert.deepEqual(db.prepare('SELECT * FROM records').all(), before)
  assert.equal((await request(`/api/users/${owner}/password`, { user: 'admin', method: 'PUT', body: { password: 'synthetic-replacement-password' } })).status, 204)
  assert.equal((await request('/api/bootstrap')).status, 401)
})

test('login throttling ignores forged proxy headers', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await request('/api/auth/login', { method: 'POST', body: { username: 'unknown', password: 'incorrect-password' }, headers: { 'cf-connecting-ip': `192.0.2.${i}`, 'x-forwarded-for': `192.0.2.${i}` } })).status, 401)
  const blocked = await request('/api/auth/login', { method: 'POST', body: { username: 'unknown', password: 'incorrect-password' } })
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.headers.get('retry-after')) > 0)
})
