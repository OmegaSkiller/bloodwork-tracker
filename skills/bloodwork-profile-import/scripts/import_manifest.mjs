#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
function take(name) {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`)
  args.splice(index, 2)
  return value
}
try {
  const appRoot = path.resolve(take('--app-root') || process.cwd())
  const database = take('--db')
  const importer = path.join(appRoot, 'server/import-cli.mjs')
  if (!fs.existsSync(importer)) throw new Error('No Bloodwork Local import adapter at this app root. Use the destination application\'s own adapter; do not guess its schema.')
  const env = { ...process.env, ...(database ? { BLOODWORK_DB_PATH: path.resolve(database) } : {}) }
  const result = spawnSync(process.execPath, ['--env-file-if-exists=.env', importer, ...args], { cwd: appRoot, env, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
