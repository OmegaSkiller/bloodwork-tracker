import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { db, createSchema, paths } from './db.mjs'
import { AI_MARKER_LIMIT, AI_PROVIDERS, DEFAULT_AI_PROVIDER, DEFAULT_AI_SYSTEM_PROMPT, OPENAI_MODELS } from '../shared/ai.js'

import { hashPassword, verifyPassword, validatePassword } from './passwords.mjs'
import { parseResult, validDateKey } from '../shared/results.js'

createSchema()

const app = express()
const port = Number(process.env.PORT || 8787)
const host = process.env.HOST || '127.0.0.1'
const openRouterTimeoutMs = Math.min(Math.max(Number(process.env.OPENROUTER_TIMEOUT_MS) || 60000, 10000), 120000)
const openRouterAttempts = Math.min(Math.max(Number(process.env.OPENROUTER_ATTEMPTS) || 2, 1), 3)
const openAiTimeoutMs = Math.min(Math.max(Number(process.env.OPENAI_TIMEOUT_MS) || 180000, 10000), 600000)
const openAiAttempts = Math.min(Math.max(Number(process.env.OPENAI_ATTEMPTS) || 2, 1), 3)
const openAiKeyPath = path.resolve(process.env.OPENAI_API_KEY_PATH || path.join(path.dirname(paths.databasePath), 'openai-api-key'))
const authUsername = String(process.env.AUTH_USERNAME || 'admin').trim()
const authHtpasswdPath = String(process.env.AUTH_HTPASSWD_PATH || '').trim()
const authSessionMs = Math.min(Math.max(Number(process.env.AUTH_SESSION_HOURS) || 12, 1), 168) * 60 * 60 * 1000
const sessionCookieName = process.env.NODE_ENV === 'production' ? '__Host-bloodwork_session' : 'bloodwork_session'
const sessions = new Map()
const loginAttempts = new Map()
const loginFailureLimit = 5
const loginFailureWindowMs = 15 * 60 * 1000
const loginBlockMs = 24 * 60 * 60 * 1000
const aiJobTtlMs = 15 * 60 * 1000
const aiJobs = new Map()

const aiJobCleanup = setInterval(() => {
  const cutoff = Date.now() - aiJobTtlMs
  for (const [jobId, job] of aiJobs) {
    if (job.createdAt < cutoff) aiJobs.delete(jobId)
  }
}, 60 * 1000)
aiJobCleanup.unref()

const authCleanup = setInterval(() => {
  const now = Date.now()
  for (const [tokenHash, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(tokenHash)
  }
  for (const [key, attempt] of loginAttempts) {
    if (attempt.resetAt <= now && attempt.blockedUntil <= now) loginAttempts.delete(key)
  }
}, 60 * 1000)
authCleanup.unref()

app.disable('x-powered-by')
app.set('trust proxy', process.env.TRUST_PROXY || false)
app.use(express.json({ limit: '1mb' }))
app.use((_req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'")
  if (_req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  next()
})

const joinedRecords = `
  SELECT
    r.id,
    r.profile_id AS profileId,
    r.marker_id AS markerId,
    r.measured_on AS measuredOn,
    r.value_numeric AS valueNumeric,
    r.value_text AS valueText,
    r.lab,
    r.notes,
    m.name AS marker,
    r.unit,
    r.raw_value AS rawValue,
    coalesce(r.reference_range, '') AS referenceRange,
    coalesce(r.method, '') AS method,
    c.id AS categoryId,
    c.name AS category
  FROM records r
  JOIN markers m ON m.id = r.marker_id
  JOIN categories c ON c.id = m.category_id
`

const joinedLifeEvents = `
  SELECT
    id,
    profile_id AS profileId,
    title,
    starts_on AS startsOn,
    ends_on AS endsOn,
    notes,
    substances,
    color_index AS colorIndex,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM life_events
`

function parseCookies(req) {
  const cookies = new Map()
  for (const item of String(req.headers.cookie || '').split(';')) {
    const separator = item.indexOf('=')
    if (separator < 1) continue
    const key = item.slice(0, separator).trim()
    const value = item.slice(separator + 1).trim()
    try { cookies.set(key, decodeURIComponent(value)) } catch { /* Ignore malformed cookies. */ }
  }
  return cookies
}

function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('base64url')
}

function currentSession(req) {
  const token = parseCookies(req).get(sessionCookieName)
  if (!token) return null
  const tokenHash = hashSessionToken(token)
  const session = sessions.get(tokenHash)
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(tokenHash)
    return null
  }
  return { ...session, tokenHash }
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: authSessionMs,
  }
}

function requestHasValidOrigin(req) {
  const origin = req.get('origin')
  if (!origin) return req.get('sec-fetch-site') !== 'cross-site'
  try {
    return new URL(origin).origin === `${req.protocol}://${req.get('host')}`
  } catch {
    return false
  }
}

function requestCanSubmitSecret(req) {
  if (req.secure) return true
  const hostname = String(req.hostname || '').toLowerCase()
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function clientAddress(req) {
  return String(req.ip || req.socket.remoteAddress || 'unknown').slice(0, 128)
}

function loginThrottle(req) {
  const key = clientAddress(req)
  const now = Date.now()
  let attempt = loginAttempts.get(key)
  if (!attempt || (attempt.blockedUntil <= now && attempt.resetAt <= now)) {
    attempt = { failures: 0, resetAt: now + loginFailureWindowMs, blockedUntil: 0 }
  }
  loginAttempts.set(key, attempt)
  return { key, attempt, now }
}

function verifyHtpasswd(password) {
  return new Promise((resolve, reject) => {
    const child = spawn('htpasswd', ['-vi', authHtpasswdPath, authUsername], { stdio: ['pipe', 'ignore', 'ignore'] })
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Password verification timed out.'))
    }, 5000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timeout)
      resolve(code === 0)
    })
    child.stdin.end(`${password}\n`)
  })
}

function publicUserRow(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    active: Boolean(user.active),
    createdAt: user.createdAt,
  }
}

function findUserByUsername(username) {
  return db.prepare(`
    SELECT id, username, password_hash AS passwordHash, role, active,
      created_at AS createdAt, updated_at AS updatedAt
    FROM users WHERE username = ? COLLATE NOCASE
  `).get(username)
}

async function authenticateUser(username, password) {
  let user = findUserByUsername(username)
  if (user?.active && await verifyPassword(password, user.passwordHash)) return user

  if (user || username.toLowerCase() !== authUsername.toLowerCase() || !authHtpasswdPath || !fs.existsSync(authHtpasswdPath)) return null
  const legacyPasswordValid = await verifyHtpasswd(password)
  if (!legacyPasswordValid) return null

  const passwordHash = await hashPassword(password)
  db.prepare(`
    INSERT INTO users(username, password_hash, role, active)
    VALUES (?, ?, 'admin', 1)
    ON CONFLICT(username) DO UPDATE SET
      password_hash = excluded.password_hash,
      role = 'admin',
      active = 1,
      updated_at = CURRENT_TIMESTAMP
  `).run(authUsername, passwordHash)
  user = findUserByUsername(authUsername)
  return user
}

function parseNewUser(body) {
  const username = String(body.username || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$/.test(username)) throw new Error('Username must be 3–40 characters and use only letters, numbers, dots, underscores, or hyphens.')
  if (username.toLowerCase() === authUsername.toLowerCase()) throw new Error('That username is reserved for the administrator.')
  const password = parseNewPassword(body)
  return { username, password }
}

function parseNewPassword(body) {
  return validatePassword(body.password)
}

function canAccessProfile(req, profileId) {
  return Number.isSafeInteger(Number(profileId)) && Number(profileId) > 0
    && Boolean(db.prepare("SELECT 1 FROM profiles WHERE id = ? AND (owner_user_id = ? OR ? = 'admin')").get(Number(profileId), req.auth.userId, req.auth.role))
}

function requireAdmin(req, res, next) {
  if (req.auth?.role !== 'admin') return res.status(403).json({ error: 'Administrator access is required.' })
  next()
}

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  const publicPath = req.path === '/health' || req.path === '/auth/session' || req.path === '/auth/login'
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !requestHasValidOrigin(req)) {
    return res.status(403).json({ error: 'Request origin was rejected.' })
  }
  if (publicPath) return next()
  const session = currentSession(req)
  if (!session) return res.status(401).json({ error: 'Your session expired. Sign in again.' })
  req.auth = { userId: session.userId, username: session.username, role: session.role }
  next()
})

// Apply account authorization before *every* profile-scoped endpoint. SQL still
// scopes individual resources to the profile, including mismatched child IDs.
app.use('/api', (req, res, next) => {
  const scoped = /^\/(records|markers|life-events)(\/|$)/.test(req.path)
    || /^\/ai\/(chats|chat)(\/|$)/.test(req.path) && req.method !== 'GET'
    || /^\/ai\/chats(\/|$)/.test(req.path);
  if (scoped) {
    const profileId = ['GET', 'DELETE'].includes(req.method) ? req.query.profileId : req.body?.profileId
    if (!canAccessProfile(req, profileId)) return res.status(404).json({ error: 'Profile not found.' })
  }
  next()
})

app.get('/api/auth/session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const session = currentSession(req)
  res.json({ authenticated: Boolean(session), username: session?.username || null, role: session?.role || null })
})

app.post('/api/auth/login', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const { key, attempt, now } = loginThrottle(req)
  if (attempt.blockedUntil > now) {
    res.setHeader('Retry-After', String(Math.ceil((attempt.blockedUntil - now) / 1000)))
    return res.status(429).json({ error: 'Too many failed attempts. Try again later.' })
  }

  const username = String(req.body.username || '').trim()
  const password = String(req.body.password || '')
  if (!username || !password || username.length > 80 || password.length > 256 || /[\r\n\0]/.test(password)) {
    return res.status(400).json({ error: 'Enter a valid username and password.' })
  }

  try {
    const user = await authenticateUser(username, password)
    if (!user) {
      attempt.failures += 1
      if (attempt.failures >= loginFailureLimit) {
        attempt.blockedUntil = now + loginBlockMs
        attempt.resetAt = attempt.blockedUntil
      }
      loginAttempts.set(key, attempt)
      return res.status(401).json({ error: 'Incorrect username or password.' })
    }

    loginAttempts.delete(key)
    const existing = currentSession(req)
    if (existing) sessions.delete(existing.tokenHash)
    const token = randomBytes(32).toString('base64url')
    sessions.set(hashSessionToken(token), { userId: user.id, username: user.username, role: user.role, createdAt: now, expiresAt: now + authSessionMs })
    if (sessions.size > 100) sessions.delete(sessions.keys().next().value)
    res.cookie(sessionCookieName, token, sessionCookieOptions())
    res.json({ authenticated: true, username: user.username, role: user.role })
  } catch {
    res.status(503).json({ error: 'Login service is unavailable. Check the database and administrator password configuration.' })
  }
})

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const session = currentSession(req)
  if (session) sessions.delete(session.tokenHash)
  res.clearCookie(sessionCookieName, { ...sessionCookieOptions(), maxAge: undefined })
  res.status(204).end()
})

app.get('/api/users', requireAdmin, (_req, res) => {
  const users = db.prepare(`
    SELECT id, username, role, active, created_at AS createdAt
    FROM users ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, username COLLATE NOCASE
  `).all()
  res.json(users.map(publicUserRow))
})

app.post('/api/users', requireAdmin, async (req, res) => {
  try {
    if (!requestCanSubmitSecret(req)) return res.status(400).json({ error: 'Open this app over HTTPS to create a user.' })
    const userInput = parseNewUser(req.body)
    const passwordHash = await hashPassword(userInput.password)
    const result = db.prepare(`
      INSERT INTO users(username, password_hash, role, active, created_by)
      VALUES (?, ?, 'member', 1, ?)
    `).run(userInput.username, passwordHash, req.auth.userId)
    const user = db.prepare(`
      SELECT id, username, role, active, created_at AS createdAt
      FROM users WHERE id = ?
    `).get(result.lastInsertRowid)
    res.status(201).json(publicUserRow(user))
  } catch (error) {
    sendError(res, error)
  }
})

app.put('/api/users/:id/password', requireAdmin, async (req, res) => {
  try {
    if (!requestCanSubmitSecret(req)) return res.status(400).json({ error: 'Open this app over HTTPS to change a password.' })
    const userId = Number(req.params.id)
    if (!Number.isInteger(userId) || userId < 1) throw new Error('Choose a valid user.')
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId)
    if (!user) return res.status(404).json({ error: 'User not found.' })
    if (user.role === 'admin') return res.status(400).json({ error: 'Administrator credentials must be managed by the local operator.' })
    const passwordHash = await hashPassword(parseNewPassword(req.body))
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, userId)
    for (const [tokenHash, session] of sessions) {
      if (session.userId === userId) sessions.delete(tokenHash)
    }
    res.status(204).end()
  } catch (error) {
    sendError(res, error)
  }
})

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  try {
    const userId = Number(req.params.id)
    if (!Number.isInteger(userId) || userId < 1) throw new Error('Choose a valid user.')
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId)
    if (!user) return res.status(404).json({ error: 'User not found.' })
    if (user.role === 'admin') return res.status(400).json({ error: 'The administrator account cannot be removed.' })
    db.prepare('DELETE FROM users WHERE id = ?').run(userId)
    for (const [tokenHash, session] of sessions) {
      if (session.userId === userId) sessions.delete(tokenHash)
    }
    res.status(204).end()
  } catch (error) {
    sendError(res, error)
  }
})

function sendError(res, error, status = 400) {
  const message = error?.code?.startsWith('SQLITE_CONSTRAINT') ? 'That record already exists or contains an invalid value.' : error.message
  res.status(status).json({ error: message })
}

function parseRecord(body) {
  const profileId = Number(body.profileId)
  const markerId = Number(body.markerId)
  const measuredOn = String(body.measuredOn || '')
  if (!Number.isSafeInteger(profileId) || profileId < 1) throw new Error('Choose a profile.')
  if (!Number.isSafeInteger(markerId) || markerId < 1) throw new Error('Choose a marker.')
  if (!validDateKey(measuredOn)) throw new Error('Choose a real collection date.')
  const marker = db.prepare('SELECT unit FROM markers WHERE id = ? AND profile_id = ?').get(markerId, profileId)
  if (!marker) throw new Error('Choose a marker in this profile.')
  const record = {
    profileId, markerId, measuredOn, ...parseResult(body.value),
    unit: String(body.unit ?? marker.unit).trim(),
    lab: String(body.lab || '').trim(), notes: String(body.notes || '').trim(),
    referenceRange: String(body.referenceRange || '').trim(), method: String(body.method || '').trim(),
  }
  if ([record.unit, record.lab, record.referenceRange, record.method].some((v) => v.length > 500) || record.notes.length > 5000) throw new Error('Result metadata is too long.')
  return record
}

function parseDateRange(value) {
  const start = String(value?.start || '').trim()
  const end = String(value?.end || '').trim()
  if (!start && !end) return null
  if (!validDateKey(start) || !validDateKey(end)) throw new Error('Choose a valid chart timeframe.')
  if (end < start) throw new Error('Chart timeframe end cannot be before its start.')
  return { start, end }
}

function validateAiModel(provider, requestedModel) {
  const model = String(requestedModel || AI_PROVIDERS[provider]?.model || '').trim()
  if (provider === 'openrouter' && model !== AI_PROVIDERS.openrouter.model) throw new Error('Choose a valid OpenRouter model.')
  if (provider === 'openai' && !OPENAI_MODELS.includes(model)) throw new Error('Choose a valid OpenAI model.')
  return model
}

function savedOpenAiKeyExists() {
  try { return fs.statSync(openAiKeyPath).isFile() } catch { return false }
}

function readOpenAiKey() {
  if (savedOpenAiKeyExists()) return fs.readFileSync(openAiKeyPath, 'utf8').trim()
  return String(process.env.OPENAI_API_KEY || '').trim()
}

function openAiKeyStatus() {
  if (savedOpenAiKeyExists()) return { configured: true, source: 'settings' }
  if (String(process.env.OPENAI_API_KEY || '').trim()) return { configured: true, source: 'environment' }
  return { configured: false, source: null }
}

function saveOpenAiKey(value) {
  const apiKey = String(value || '').trim()
  if (apiKey.length < 20 || apiKey.length > 512 || /\s/.test(apiKey)) throw new Error('Enter a valid OpenAI API key.')
  fs.mkdirSync(path.dirname(openAiKeyPath), { recursive: true })
  const temporaryPath = `${openAiKeyPath}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporaryPath, `${apiKey}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    fs.renameSync(temporaryPath, openAiKeyPath)
    fs.chmodSync(openAiKeyPath, 0o600)
  } catch (error) {
    try { fs.unlinkSync(temporaryPath) } catch { /* Nothing to clean up. */ }
    throw error
  }
}

function parseLifeEvent(body) {
  const profileId = Number(body.profileId)
  const title = String(body.title || '').trim()
  const startsOn = String(body.startsOn || '').trim()
  const endsOn = String(body.endsOn || '').trim() || null
  const notes = String(body.notes || '').trim()
  const substances = String(body.substances || '').trim()
  if (!Number.isInteger(profileId) || profileId < 1) throw new Error('Choose a profile.')
  if (!title) throw new Error('Enter a life event title.')
  if (title.length > 120) throw new Error('Life event titles must be 120 characters or fewer.')
  if (!validDateKey(startsOn)) throw new Error('Choose a valid event date.')
  if (endsOn && !validDateKey(endsOn)) throw new Error('Choose a valid end date.')
  if (endsOn && endsOn < startsOn) throw new Error('End date cannot be before the start date.')
  if (notes.length > 5000) throw new Error('Notes must be 5,000 characters or fewer.')
  if (substances.length > 3000) throw new Error('Substances must be 3,000 characters or fewer.')
  return { profileId, title, startsOn, endsOn, notes, substances }
}

function nextLifeEventColor(profileId) {
  const used = new Set(db.prepare('SELECT color_index AS colorIndex FROM life_events WHERE profile_id = ?').all(profileId).map((item) => item.colorIndex))
  let colorIndex = 0
  while (used.has(colorIndex)) colorIndex += 1
  return colorIndex
}

function cleanChatMessages(messages) {
  if (!Array.isArray(messages)) throw new Error('Chat messages are required.')
  const cleaned = messages.map((message) => ({
    role: message?.role === 'assistant' ? 'assistant' : 'user',
    content: String(message?.content || '').trim(),
  })).filter((message) => message.content)
  if (!cleaned.length || cleaned.at(-1).role !== 'user') throw new Error('Ask a question to continue.')
  return cleaned
}

function parseSavedChat(body) {
  const profileId = Number(body.profileId)
  const provider = String(body.provider || DEFAULT_AI_PROVIDER)
  const requestedModel = body.model
  const markerIds = [...new Set((Array.isArray(body.markerIds) ? body.markerIds : []).map(Number).filter(Number.isInteger))]
  const messages = (Array.isArray(body.messages) ? body.messages : []).map((message) => ({
    role: message?.role === 'assistant' ? 'assistant' : 'user',
    content: String(message?.content || '').trim(),
  })).filter((message) => message.content)
  const fallbackTitle = messages.find((message) => message.role === 'user')?.content || 'Saved analysis'
  const title = String(body.title || fallbackTitle).trim().slice(0, 160)
  const systemPrompt = String(body.systemPrompt || DEFAULT_AI_SYSTEM_PROMPT).trim().slice(0, 12000) || DEFAULT_AI_SYSTEM_PROMPT

  if (!Number.isInteger(profileId) || !db.prepare('SELECT 1 FROM profiles WHERE id = ?').get(profileId)) throw new Error('Choose a valid profile.')
  if (!Object.hasOwn(AI_PROVIDERS, provider)) throw new Error('Choose a valid AI provider.')
  const model = validateAiModel(provider, requestedModel)
  const dateRange = parseDateRange(body.dateRange)
  if (!markerIds.length || markerIds.length > AI_MARKER_LIMIT) throw new Error(`Select between 1 and ${AI_MARKER_LIMIT} markers.`)
  if (!title) throw new Error('Enter a chat title.')
  if (messages.length > 200) throw new Error('This chat has too many messages to save.')

  const placeholders = markerIds.map(() => '?').join(',')
  const ownedMarkerCount = db.prepare(`SELECT COUNT(*) AS count FROM markers WHERE profile_id = ? AND id IN (${placeholders})`).get(profileId, ...markerIds).count
  if (ownedMarkerCount !== markerIds.length) throw new Error('One or more selected markers do not belong to this profile.')
  return { profileId, provider, model, markerIds, messages, title, systemPrompt, rangeStart: dateRange?.start || null, rangeEnd: dateRange?.end || null }
}

function savedChatRow(id, profileId) {
  const chat = db.prepare(`
    SELECT id, profile_id AS profileId, title, provider, model, marker_ids AS markerIds,
      range_start AS rangeStart, range_end AS rangeEnd,
      system_prompt AS systemPrompt, created_at AS createdAt, updated_at AS updatedAt
    FROM ai_chats WHERE id = ? AND profile_id = ?
  `).get(id, profileId)
  if (!chat) return null
  try { chat.markerIds = JSON.parse(chat.markerIds) } catch { chat.markerIds = [] }
  return chat
}

const replaceSavedMessages = db.transaction((chatId, messages) => {
  db.prepare('DELETE FROM ai_chat_messages WHERE chat_id = ?').run(chatId)
  const insert = db.prepare('INSERT INTO ai_chat_messages(chat_id, role, content) VALUES (?, ?, ?)')
  messages.forEach((message) => insert.run(chatId, message.role, message.content))
})

function extractAssistantText(payload) {
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) return content.map((part) => typeof part === 'string' ? part : part?.text || '').join('\n').trim()
  return String(payload?.choices?.[0]?.message?.reasoning || '').trim()
}

function getProviderError(payload) {
  const choice = payload?.choices?.[0]
  if (payload?.error) return payload.error
  if (choice?.error) return choice.error
  if (choice?.finish_reason === 'error') return { code: 502, message: 'Provider stopped before completing the response.', metadata: { error_type: 'provider_error' } }
  return null
}

function normalizeProviderFailure(error, status, attempt) {
  const metadata = error?.metadata || {}
  const message = String(error?.message || '').trim() || 'Provider returned an unknown error.'
  const errorType = String(metadata.error_type || metadata.provider_code || '').trim() || null
  const retryable = status === 408
    || status === 409
    || status === 425
    || status === 429
    || status >= 500
    || /provider|rate.?limit|timeout|temporar|unavailable|overload|disconnect/i.test(`${errorType || ''} ${message}`)
  return { status, message, errorType, retryable, attempt }
}

function publicProviderMessage(failure, provider) {
  const providerName = provider === 'openai' ? 'OpenAI' : 'OpenRouter'
  if (provider === 'openrouter' && (failure.status === 401 || failure.status === 403)) return 'OpenRouter rejected the configured API key. Update OPENROUTER_KEY and restart the app.'
  if (provider === 'openai' && (failure.status === 401 || failure.status === 403)) return 'OpenAI rejected the saved API key. Update it in AI settings.'
  if (failure.status === 429) return `${providerName} is rate-limited right now. Wait briefly, then retry.`
  if (failure.retryable) {
    const detail = failure.errorType ? ` (${failure.errorType})` : ''
    return `${providerName} is temporarily unavailable after ${failure.attempt} attempts${detail}. Retry in a moment.`
  }
  return `${providerName} request failed: ${failure.message}`
}

async function requestOpenRouter(apiKey, requestBody) {
  let lastFailure
  for (let attempt = 1; attempt <= openRouterAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), openRouterTimeoutMs)
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost:8787',
          'X-OpenRouter-Title': 'Bloodwork Local',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => ({}))
      const providerError = getProviderError(payload)
      if (response.ok && !providerError) return { payload, attempts: attempt }

      lastFailure = normalizeProviderFailure(providerError, response.ok ? Number(providerError?.code) || 502 : response.status, attempt)
    } catch (error) {
      lastFailure = normalizeProviderFailure(
        { message: error?.name === 'AbortError' ? 'Provider request timed out.' : 'Could not reach the provider.', metadata: { error_type: error?.name === 'AbortError' ? 'provider_timeout' : 'provider_connection_error' } },
        error?.name === 'AbortError' ? 504 : 502,
        attempt,
      )
    } finally {
      clearTimeout(timeout)
    }

    if (!lastFailure.retryable || attempt === openRouterAttempts) break
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
  }
  return { failure: lastFailure }
}

function extractOpenAiText(payload) {
  return (Array.isArray(payload?.output) ? payload.output : [])
    .filter((item) => item?.type === 'message')
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter((item) => item?.type === 'output_text')
    .map((item) => String(item.text || ''))
    .join('\n')
    .trim()
}

async function requestOpenAi(apiKey, messages, model) {
  let lastFailure
  for (let attempt = 1; attempt <= openAiAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), openAiTimeoutMs)
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          input: messages.map((message) => ({
            role: message.role === 'system' ? 'developer' : message.role,
            content: message.content,
          })),
          store: false,
        }),
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok && !payload.error) {
        return {
          message: extractOpenAiText(payload),
          model: payload.model || model,
          usage: payload.usage || null,
          attempts: attempt,
        }
      }
      lastFailure = normalizeProviderFailure(payload.error, response.status, attempt)
    } catch (error) {
      lastFailure = normalizeProviderFailure(
        { message: error?.name === 'AbortError' ? 'OpenAI request timed out.' : 'Could not reach OpenAI.', metadata: { error_type: error?.name === 'AbortError' ? 'provider_timeout' : 'provider_connection_error' } },
        error?.name === 'AbortError' ? 504 : 502,
        attempt,
      )
    } finally {
      clearTimeout(timeout)
    }

    if (!lastFailure.retryable || attempt === openAiAttempts) break
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
  }
  return { failure: lastFailure }
}

async function runAiProvider({ provider, apiKey, messages, markerCount, model }) {
  const result = provider === 'openai'
      ? await requestOpenAi(apiKey, messages, model)
      : await requestOpenRouter(apiKey, {
        model: AI_PROVIDERS.openrouter.model,
        messages,
        provider: { allow_fallbacks: true },
      })
  if (result.failure) {
    return {
      // Provider authentication is not an expired application session.
      httpStatus: result.failure.status === 429 ? 429 : 502,
      payload: {
        error: publicProviderMessage(result.failure, provider),
        code: result.failure.errorType || 'provider_error',
        retryable: result.failure.retryable,
      },
    }
  }

  const message = provider === 'openrouter' ? extractAssistantText(result.payload) : result.message
  if (!message) {
    return {
      httpStatus: 502,
      payload: { error: `${provider === 'openai' ? 'OpenAI' : 'OpenRouter'} returned an empty response.` },
    }
  }
  return {
    httpStatus: 200,
    payload: {
      message,
      provider,
      model: provider === 'openrouter' ? result.payload.model || AI_PROVIDERS.openrouter.model : result.model,
      usage: provider === 'openrouter' ? result.payload.usage || null : result.usage,
      markerCount,
      providerAttempts: result.attempts,
    },
  }
}

app.get('/api/bootstrap', (req, res) => {
  const profiles = db.prepare("SELECT id, name, created_at AS createdAt FROM profiles WHERE owner_user_id = ? OR ? = 'admin' ORDER BY id").all(req.auth.userId, req.auth.role)
  const requestedProfileId = Number(req.query.profileId)
  if (req.query.profileId && !canAccessProfile(req, requestedProfileId)) return res.status(404).json({ error: 'Profile not found.' })
  const activeProfileId = req.query.profileId ? requestedProfileId : profiles[0]?.id ?? null
  const categories = db.prepare('SELECT id, name, sort_order AS sortOrder FROM categories ORDER BY sort_order, name').all()
  const markers = db.prepare(`
    SELECT m.id, m.name, m.unit, m.category_id AS categoryId, c.name AS category
    FROM markers m JOIN categories c ON c.id = m.category_id
    WHERE m.profile_id = ?
    ORDER BY c.sort_order, m.name
  `).all(activeProfileId)
  const records = db.prepare(`${joinedRecords} WHERE r.profile_id = ? ORDER BY r.measured_on, c.sort_order, m.name`).all(activeProfileId)
  const lifeEvents = db.prepare(`${joinedLifeEvents} WHERE profile_id = ? ORDER BY starts_on, id`).all(activeProfileId)
  res.json({ profiles, activeProfileId, categories, markers, records, lifeEvents })
})

app.get('/api/ai/openai-key', requireAdmin, (_req, res) => {
  res.json(openAiKeyStatus())
})

app.put('/api/ai/openai-key', requireAdmin, (req, res) => {
  try {
    if (!requestCanSubmitSecret(req)) return res.status(400).json({ error: 'Open this app over HTTPS to save an API key.' })
    saveOpenAiKey(req.body.apiKey)
    res.json(openAiKeyStatus())
  } catch (error) {
    sendError(res, error)
  }
})

app.delete('/api/ai/openai-key', requireAdmin, (_req, res) => {
  try {
    if (savedOpenAiKeyExists()) fs.unlinkSync(openAiKeyPath)
    else if (String(process.env.OPENAI_API_KEY || '').trim()) return res.status(409).json({ error: 'This key is configured through OPENAI_API_KEY and cannot be removed in the app.' })
    res.json(openAiKeyStatus())
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/ai/chats', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || !db.prepare('SELECT 1 FROM profiles WHERE id = ?').get(profileId)) return res.status(400).json({ error: 'Choose a valid profile.' })
  const chats = db.prepare(`
    SELECT c.id, c.profile_id AS profileId, c.title, c.provider, c.model,
      c.created_at AS createdAt, c.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM ai_chat_messages m WHERE m.chat_id = c.id) AS messageCount,
      (SELECT substr(content, 1, 180) FROM ai_chat_messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS lastMessage
    FROM ai_chats c
    WHERE c.profile_id = ?
    ORDER BY c.updated_at DESC, c.id DESC
  `).all(profileId)
  res.json(chats)
})

app.get('/api/ai/chats/:id', (req, res) => {
  const profileId = Number(req.query.profileId)
  const chat = savedChatRow(Number(req.params.id), profileId)
  if (!chat) return res.status(404).json({ error: 'Saved chat not found.' })
  chat.messages = db.prepare(`
    SELECT id, role, content, created_at AS createdAt
    FROM ai_chat_messages WHERE chat_id = ? ORDER BY id
  `).all(chat.id)
  res.json(chat)
})

app.post('/api/ai/chats', (req, res) => {
  try {
    const chat = parseSavedChat(req.body)
    const create = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO ai_chats(profile_id, title, provider, model, marker_ids, range_start, range_end, system_prompt)
        VALUES (@profileId, @title, @provider, @model, @markerIds, @rangeStart, @rangeEnd, @systemPrompt)
      `).run({ ...chat, markerIds: JSON.stringify(chat.markerIds) })
      const id = Number(result.lastInsertRowid)
      replaceSavedMessages(id, chat.messages)
      return id
    })
    const id = create()
    res.status(201).json({ ...savedChatRow(id, chat.profileId), messages: chat.messages })
  } catch (error) {
    sendError(res, error)
  }
})

app.put('/api/ai/chats/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const chat = parseSavedChat(req.body)
    const update = db.transaction(() => {
      const result = db.prepare(`
        UPDATE ai_chats SET title = @title, provider = @provider, model = @model,
          marker_ids = @markerIds, range_start = @rangeStart, range_end = @rangeEnd,
          system_prompt = @systemPrompt, updated_at = CURRENT_TIMESTAMP
        WHERE id = @id AND profile_id = @profileId
      `).run({ ...chat, id, markerIds: JSON.stringify(chat.markerIds) })
      if (!result.changes) return false
      replaceSavedMessages(id, chat.messages)
      return true
    })
    if (!update()) return res.status(404).json({ error: 'Saved chat not found.' })
    res.json({ ...savedChatRow(id, chat.profileId), messages: chat.messages })
  } catch (error) {
    sendError(res, error)
  }
})

app.delete('/api/ai/chats/:id', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId)) return res.status(400).json({ error: 'Choose a profile.' })
  const result = db.prepare('DELETE FROM ai_chats WHERE id = ? AND profile_id = ?').run(Number(req.params.id), profileId)
  if (!result.changes) return res.status(404).json({ error: 'Saved chat not found.' })
  res.status(204).end()
})

app.post('/api/ai/chat', async (req, res) => {
  try {
    if (req.body.consent !== true) throw new Error('Confirm that you want to send the selected health data to this external provider.')
    const provider = String(req.body.provider || DEFAULT_AI_PROVIDER)
    if (!Object.hasOwn(AI_PROVIDERS, provider)) throw new Error('Choose a valid AI provider.')
    const requestedModel = req.body.model
    const model = validateAiModel(provider, requestedModel)
    const apiKey = provider === 'openai' ? readOpenAiKey() : String(process.env.OPENROUTER_KEY || '').trim()
    if (provider === 'openrouter' && !apiKey) return res.status(503).json({ error: 'OPENROUTER_KEY is not configured in bloodwork-app/.env.' })
    if (provider === 'openai' && !apiKey) return res.status(503).json({ error: 'Add an OpenAI API key in AI settings before using this provider.' })

    const profileId = Number(req.body.profileId)
    const profile = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(profileId)
    if (!profile) throw new Error('Choose a valid profile.')
    const dateRange = parseDateRange(req.body.dateRange)
    if (!dateRange) throw new Error('Open the chart and choose a timeframe before asking the AI.')

    const markerIds = [...new Set((Array.isArray(req.body.markerIds) ? req.body.markerIds : []).map(Number).filter(Number.isInteger))]
    if (!markerIds.length) throw new Error('Select at least one marker to analyze.')
    if (markerIds.length > AI_MARKER_LIMIT) throw new Error(`Select no more than ${AI_MARKER_LIMIT} markers.`)

    const placeholders = markerIds.map(() => '?').join(',')
    const markers = db.prepare(`
      SELECT m.id, m.name, m.unit, c.name AS category
      FROM markers m JOIN categories c ON c.id = m.category_id
      WHERE m.profile_id = ? AND m.id IN (${placeholders})
      ORDER BY c.sort_order, m.name
    `).all(profileId, ...markerIds)
    if (markers.length !== markerIds.length) throw new Error('One or more selected markers do not belong to this profile.')

    const records = db.prepare(`${joinedRecords}
      WHERE r.profile_id = ? AND r.marker_id IN (${placeholders})
        AND r.measured_on BETWEEN ? AND ?
      ORDER BY r.measured_on, c.sort_order, m.name
    `).all(profileId, ...markerIds, dateRange.start, dateRange.end)
    const lifeEvents = db.prepare(`${joinedLifeEvents}
      WHERE profile_id = ?
        AND starts_on <= ?
        AND coalesce(ends_on, starts_on) >= ?
      ORDER BY starts_on, id
    `).all(profileId, dateRange.end, dateRange.start)
    const observationsByMarker = new Map(markers.map((marker) => [marker.id, []]))
    records.forEach((record) => observationsByMarker.get(record.markerId)?.push({
      date: record.measuredOn,
      value: record.rawValue ?? record.valueNumeric ?? record.valueText,
      referenceRange: record.referenceRange || null,
      method: record.method || null,
      unit: record.unit,
      lab: record.lab || null,
      notes: record.notes || null,
    }))

    const context = {
      profile: 'Selected profile',
      analysisTimeframe: {
        start: dateRange.start,
        end: dateRange.end,
        rule: 'Only observations dated inside this inclusive timeframe are supplied and may be analyzed.',
      },
      scope: 'Only the explicitly selected markers and inclusive chart timeframe below. Unselected markers and out-of-range observations must not be inferred as absent or normal.',
      selectedMarkers: markers.map((marker) => ({
        marker: marker.name,
        category: marker.category,
        defaultUnit: marker.unit,
        observations: observationsByMarker.get(marker.id),
      })),
      lifeEventsInTimeframe: lifeEvents.map((lifeEvent) => ({
        title: lifeEvent.title,
        startsOn: lifeEvent.startsOn,
        endsOn: lifeEvent.endsOn,
        notes: lifeEvent.notes || null,
        substances: lifeEvent.substances || null,
      })),
    }
    const customPrompt = String(req.body.systemPrompt || DEFAULT_AI_SYSTEM_PROMPT).trim().slice(0, 12000) || DEFAULT_AI_SYSTEM_PROMPT
    const messages = cleanChatMessages(req.body.messages)
    const systemContent = `${customPrompt}\n\nAPPLICATION GUARDRAILS (not editable):\n- Analyze only the selected markers and observations inside analysisTimeframe. Never use or imply values outside that date range.\n- Analyze only the profile context supplied below and never infer data from another person.\n- Life events are contextual timeline annotations. Discuss temporal associations cautiously and never claim that an event caused a marker change.\n- An empty lifeEventsInTimeframe list means no events were recorded in this app for that period; it does not prove that nothing happened.\n- This is pattern analysis, not diagnosis or treatment. Do not prescribe or recommend medication changes.\n- Never invent missing values, reference intervals, symptoms, or history.\n- State uncertainty and advise qualified medical review for concerning or urgent-looking patterns.\n\nPROFILE CONTEXT (structured data):\n${JSON.stringify(context, null, 2)}`

    const providerMessages = [{ role: 'system', content: systemContent }, ...messages]
    if ([...aiJobs.values()].some((job) => job.userId === req.auth.userId && job.state === 'pending')) return res.status(429).json({ error: 'Wait for your current AI request to finish.' })
    const jobId = randomUUID()
    aiJobs.set(jobId, { state: 'pending', createdAt: Date.now(), userId: req.auth.userId, profileId })
    void runAiProvider({ provider, apiKey, messages: providerMessages, markerCount: markers.length, model })
      .then(({ httpStatus, payload }) => {
        const job = aiJobs.get(jobId)
        if (job) aiJobs.set(jobId, { ...job, state: 'finished', httpStatus, payload: { ...payload, dateRange, lifeEventCount: lifeEvents.length } })
      })
      .catch(() => {
        const job = aiJobs.get(jobId)
        if (job) aiJobs.set(jobId, { ...job, state: 'finished', httpStatus: 502, payload: { error: 'AI request failed unexpectedly. Retry the request.' } })
      })
    res.status(202).json({ jobId, status: 'pending' })
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/ai/chat/:jobId', (req, res) => {
  const job = aiJobs.get(req.params.jobId)
  if (!job || job.userId !== req.auth.userId || !canAccessProfile(req, job.profileId)) return res.status(404).json({ error: 'AI request expired or was not found. Send it again.' })
  if (job.state === 'pending') return res.status(202).json({ jobId: req.params.jobId, status: 'pending' })
  res.status(job.httpStatus).json(job.payload)
})

app.post('/api/profiles', (req, res) => {
  try {
    const name = String(req.body.name || '').trim()
    const requestedSource = Number(req.body.cloneFromProfileId)
    if (!name || name.length > 100) throw new Error('Profile name must have 1–100 characters.')
    if (requestedSource && !canAccessProfile(req, requestedSource)) return res.status(404).json({ error: 'Profile not found.' })
    const sourceProfileId = requestedSource || null

    const createProfile = db.transaction(() => {
      const result = db.prepare('INSERT INTO profiles(name, owner_user_id) VALUES (?, ?)').run(name, req.auth.userId)
      const profileId = Number(result.lastInsertRowid)
      if (sourceProfileId) {
        db.prepare(`
          INSERT INTO markers(profile_id, category_id, name, unit)
          SELECT ?, category_id, name, unit FROM markers WHERE profile_id = ?
        `).run(profileId, sourceProfileId)
      }
      return profileId
    })

    const profileId = createProfile()
    const profile = db.prepare('SELECT id, name, created_at AS createdAt FROM profiles WHERE id = ?').get(profileId)
    res.status(201).json(profile)
  } catch (error) {
    sendError(res, error)
  }
})

app.post('/api/categories', (req, res) => {
  try {
    const name = String(req.body.name || '').trim()
    if (!name) throw new Error('Category name is required.')
    const nextSort = db.prepare('SELECT coalesce(max(sort_order), -1) + 1 AS value FROM categories').get().value
    const result = db.prepare('INSERT INTO categories(name, sort_order) VALUES (?, ?)').run(name, nextSort)
    res.status(201).json({ id: Number(result.lastInsertRowid), name, sortOrder: nextSort })
  } catch (error) {
    sendError(res, error)
  }
})

app.post('/api/markers', (req, res) => {
  try {
    const profileId = Number(req.body.profileId)
    const categoryId = Number(req.body.categoryId)
    const name = String(req.body.name || '').trim()
    const unit = String(req.body.unit || '').trim()
    if (!Number.isInteger(profileId) || !Number.isInteger(categoryId) || !name) throw new Error('Profile, category, and marker name are required.')
    const result = db.prepare('INSERT INTO markers(profile_id, category_id, name, unit) VALUES (?, ?, ?, ?)').run(profileId, categoryId, name, unit)
    const marker = db.prepare(`
      SELECT m.id, m.name, m.unit, m.category_id AS categoryId, c.name AS category
      FROM markers m JOIN categories c ON c.id = m.category_id WHERE m.id = ? AND m.profile_id = ?
    `).get(result.lastInsertRowid, profileId)
    res.status(201).json(marker)
  } catch (error) {
    sendError(res, error)
  }
})

app.post('/api/records', (req, res) => {
  try {
    const created = db.transaction(() => {
      const body = { ...req.body }
      if (body.newMarker) {
        const { categoryId, name, unit = '' } = body.newMarker
        if (!Number.isSafeInteger(Number(categoryId)) || typeof name !== 'string' || !name.trim() || name.length > 200 || String(unit).length > 500) throw new Error('Choose a category and a valid marker name and unit.')
        body.markerId = Number(db.prepare('INSERT INTO markers(profile_id, category_id, name, unit) VALUES (?, ?, ?, ?)').run(Number(body.profileId), Number(categoryId), name.trim(), String(unit).trim()).lastInsertRowid)
      }
      const record = parseRecord(body)
      const result = db.prepare(`
        INSERT INTO records(profile_id, marker_id, measured_on, value_numeric, value_text, raw_value, unit, lab, notes, reference_range, method)
        VALUES (@profileId, @markerId, @measuredOn, @valueNumeric, @valueText, @rawValue, @unit, @lab, @notes, @referenceRange, @method)
      `).run(record)
      return db.prepare(`${joinedRecords} WHERE r.id = ? AND r.profile_id = ?`).get(result.lastInsertRowid, record.profileId)
    })()
    res.status(201).json(created)
  } catch (error) {
    sendError(res, error)
  }
})

app.put('/api/records/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const record = parseRecord(req.body)
    const marker = db.prepare('SELECT id FROM markers WHERE id = ? AND profile_id = ?').get(record.markerId, record.profileId)
    if (!marker) throw new Error('That marker belongs to a different profile.')
    const result = db.prepare(`
      UPDATE records SET
        marker_id = @markerId,
        measured_on = @measuredOn,
        value_numeric = @valueNumeric,
        value_text = @valueText,
        raw_value = @rawValue,
        unit = @unit,
        reference_range = @referenceRange,
        method = @method,
        lab = @lab,
        notes = @notes,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id AND profile_id = @profileId
    `).run({ ...record, id })
    if (!result.changes) return res.status(404).json({ error: 'Record not found.' })
    res.json(db.prepare(`${joinedRecords} WHERE r.id = ? AND r.profile_id = ?`).get(id, record.profileId))
  } catch (error) {
    sendError(res, error)
  }
})

app.delete('/api/records/:id', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId)) return res.status(400).json({ error: 'Choose a profile.' })
  const result = db.prepare('DELETE FROM records WHERE id = ? AND profile_id = ?').run(Number(req.params.id), profileId)
  if (!result.changes) return res.status(404).json({ error: 'Record not found.' })
  res.status(204).end()
})

app.post('/api/life-events', (req, res) => {
  try {
    const lifeEvent = parseLifeEvent(req.body)
    if (!db.prepare('SELECT 1 FROM profiles WHERE id = ?').get(lifeEvent.profileId)) throw new Error('Choose a valid profile.')
    const result = db.prepare(`
      INSERT INTO life_events(profile_id, title, starts_on, ends_on, notes, substances, color_index)
      VALUES (@profileId, @title, @startsOn, @endsOn, @notes, @substances, @colorIndex)
    `).run({ ...lifeEvent, colorIndex: nextLifeEventColor(lifeEvent.profileId) })
    res.status(201).json(db.prepare(`${joinedLifeEvents} WHERE id = ? AND profile_id = ?`).get(result.lastInsertRowid, lifeEvent.profileId))
  } catch (error) {
    sendError(res, error)
  }
})

app.put('/api/life-events/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const lifeEvent = parseLifeEvent(req.body)
    const result = db.prepare(`
      UPDATE life_events SET
        title = @title,
        starts_on = @startsOn,
        ends_on = @endsOn,
        notes = @notes,
        substances = @substances,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id AND profile_id = @profileId
    `).run({ ...lifeEvent, id })
    if (!result.changes) return res.status(404).json({ error: 'Life event not found.' })
    res.json(db.prepare(`${joinedLifeEvents} WHERE id = ? AND profile_id = ?`).get(id, lifeEvent.profileId))
  } catch (error) {
    sendError(res, error)
  }
})

app.delete('/api/life-events/:id', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId)) return res.status(400).json({ error: 'Choose a profile.' })
  const result = db.prepare('DELETE FROM life_events WHERE id = ? AND profile_id = ?').run(Number(req.params.id), profileId)
  if (!result.changes) return res.status(404).json({ error: 'Life event not found.' })
  res.status(204).end()
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

const dist = path.resolve(paths.appDir, 'dist')
app.use(express.static(dist))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next()
  res.sendFile(path.join(dist, 'index.html'))
})

app.use((error, _req, res, _next) => {
  const status = error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500
  res.status(status).json({ error: status === 413 ? 'Request is too large.' : status === 400 ? 'Invalid JSON request.' : 'The request could not be completed.' })
})

const server = app.listen(port, host, () => {
  console.log(`Bloodwork app running at http://${host}:${server.address().port}`)
})
