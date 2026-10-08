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
function syntheticPdf(label = 'SYNTHETIC_REPORT') {
  const stream = `BT /F1 12 Tf 20 260 Td (${label}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf)
}
async function request(route, { user = 'alice', method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(cookies[user] ? { Cookie: cookies[user] } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null }
}
async function pdfUpload({ user = 'alice', consent = true, profile = profileId, pdf = syntheticPdf() } = {}) {
  const response = await fetch(`${base}/api/pdf-import?profileId=${profile}`, {
    method: 'POST', headers: { 'Content-Type': 'application/pdf', ...(consent ? { 'X-Pdf-Transfer-Consent': 'true' } : {}), ...(cookies[user] ? { Cookie: cookies[user] } : {}) }, body: pdf,
  })
  return { status: response.status, body: await response.json() }
}
async function pdfResult(jobId, user = 'alice') {
  for (let i = 0; i < 100; i += 1) {
    const result = await request(`/api/pdf-import/${jobId}`, { user })
    if (result.status !== 202) return result
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Synthetic PDF job did not finish.')
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

test('PDF extraction requires consent and profile ownership; provider failures preserve results', async () => {
  const before = db.prepare('SELECT count(*) AS n FROM records').get().n
  assert.equal((await pdfUpload({ user: 'bob' })).status, 404)
  assert.equal((await pdfUpload({ user: 'anonymous' })).status, 401)
  assert.equal((await pdfUpload({ consent: false })).status, 400)
  assert.equal((await pdfUpload({ pdf: Buffer.from('not a PDF') })).status, 400)
  const oversized = Buffer.alloc(10 * 1024 * 1024 + 1)
  oversized.write('%PDF-1.4')
  assert.equal((await pdfUpload({ pdf: oversized })).status, 413)
  for (const label of ['SIMULATE_FAILURE', 'SIMULATE_INCOMPLETE', 'SIMULATE_INVALID']) {
    const started = await pdfUpload({ pdf: syntheticPdf(label) })
    assert.equal(started.status, 202)
    assert.equal((await pdfResult(started.body.jobId)).status, 502)
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n, before)
})

test('reviewed PDF requires exact preview, corrects missing data, backs up, and imports atomically', async () => {
  const started = await pdfUpload()
  assert.equal(started.status, 202)
  assert.equal((await request(`/api/pdf-import/${started.body.jobId}`, { user: 'bob' })).status, 404)
  const ready = await pdfResult(started.body.jobId)
  assert.equal(ready.status, 200)
  assert.equal(ready.body.patientName, 'Synthetic Alice')
  assert.equal(ready.body.rows.length, 2)
  const captured = JSON.parse(fs.readFileSync(capture, 'utf8')).request
  assert.equal(captured.store, false)
  assert.equal(captured.model, 'gpt-4.1-mini')
  assert.equal(captured.input[1].content[0].type, 'input_file')
  const route = `/api/pdf-import/${started.body.jobId}/review`
  const review = (mode, rows, extra = {}) => request(route, { method: 'POST', body: { mode, rows, profileName: 'Synthetic Alice', confirmedProfile: true, ...extra } })
  const rows = ready.body.rows
  assert.equal((await review('apply', rows)).status, 400)
  assert.equal((await review('preview', rows)).status, 400)
  assert.equal((await review('preview', rows, { confirmedProfile: false })).status, 400)
  assert.equal((await review('preview', rows.map((row) => ({ ...row, date: '2024-02-29' })))).status, 400)
  const corrected = rows.map((row, index) => index === 1 ? { ...row, date: '2025-04-01' } : row)
  const preview = await review('preview', corrected)
  assert.equal(preview.status, 200)
  assert.equal(preview.body.added, 2)
  assert.equal((await review('apply', corrected.map((row, index) => index ? { ...row, value: '9' } : row))).status, 400)
  const backupsBefore = fs.existsSync(path.join(folder, 'backups')) ? fs.readdirSync(path.join(folder, 'backups')).length : 0
  const applied = await review('apply', corrected)
  assert.equal(applied.status, 200)
  assert.equal(applied.body.added, 2)
  assert.equal(fs.readdirSync(path.join(folder, 'backups')).length, backupsBefore + 1)
  assert.equal(db.prepare("SELECT raw_value FROM records WHERE profile_id=? AND measured_on='2025-03-01'").get(profileId).raw_value, '2.3450')
  assert.equal(db.prepare("SELECT raw_value FROM records WHERE profile_id=? AND measured_on='2025-04-01'").get(profileId).raw_value, '4.10')
  assert.equal((await review('apply', corrected)).status, 409)
  const duplicate = await pdfUpload()
  const duplicateReady = await pdfResult(duplicate.body.jobId)
  const duplicateRows = duplicateReady.body.rows.map((row, index) => index === 1 ? { ...row, date: '2025-04-01' } : row)
  const identical = await request(`/api/pdf-import/${duplicate.body.jobId}/review`, { method: 'POST', body: { mode: 'preview', rows: duplicateRows, profileName: 'Synthetic Alice', confirmedProfile: true } })
  assert.equal(identical.status, 200)
  assert.equal(identical.body.identical, 2)
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
