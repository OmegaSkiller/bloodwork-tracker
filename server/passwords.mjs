import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const derive = promisify(scrypt)

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256 || /[\r\n\0]/.test(password)) throw new Error('Password must be between 12 and 256 characters.')
  return password
}

export async function hashPassword(password) {
  // Password policy belongs to account creation/reset. Legacy credential
  // migration must be able to hash an already-verified older password.
  const salt = randomBytes(16)
  const key = await derive(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return ['scrypt-v1', 16384, 8, 1, salt.toString('base64url'), key.toString('base64url')].join('$')
}

export async function verifyPassword(password, hash) {
  const [version, n, r, p, salt, key] = String(hash || '').split('$')
  if (version !== 'scrypt-v1' || !salt || !key) return false
  try {
    const expected = Buffer.from(key, 'base64url')
    const actual = await derive(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 })
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch { return false }
}
