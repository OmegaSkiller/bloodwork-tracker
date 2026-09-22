import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'

let db
try {
  const { values: args } = parseArgs({ options: {
    'profile-id': { type: 'string' }, 'profile-name': { type: 'string' },
    manifest: { type: 'string' }, workbook: { type: 'string' },
    apply: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
  } })
  if (!args['profile-id'] || !args['profile-name'] || Boolean(args.manifest) === Boolean(args.workbook) || args.apply && args['dry-run'])
    throw new Error('Usage: npm run import -- --profile-id ID --profile-name NAME --manifest FILE [--apply] (or --workbook FILE). Dry-run is the default; choose one mode and format.')
  const databasePath = path.resolve(process.env.BLOODWORK_DB_PATH || './data/bloodwork.sqlite')
  if (!fs.existsSync(databasePath)) throw new Error('Database not found. Initialize the app and create the target profile first.')
  process.env.BLOODWORK_DB_PATH = databasePath
  process.env.BLOODWORK_DB_READONLY = args.apply ? '0' : '1'
  ;({ db } = await import('./db.mjs'))
  const { importEntries, readManifest, readWorkbook } = await import('./import.mjs')
  const profileName = args['profile-name']
  const manifest = args.manifest ? readManifest(args.manifest) : null
  if (manifest && manifest.profileName !== profileName) throw new Error('Manifest profile name does not match the confirmed target.')
  const entries = manifest?.entries || readWorkbook(args.workbook)
  const options = { profileId: Number(args['profile-id']), profileName }
  const plan = importEntries(entries, options)
  if (!args.apply) console.log(JSON.stringify(plan, null, 2))
  else {
    const folder = path.join(path.dirname(databasePath), 'backups')
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
    const backup = path.join(folder, `before-import-${randomUUID()}.sqlite`)
    await db.backup(backup)
    console.log(JSON.stringify({ ...importEntries(entries, { ...options, dryRun: false }), backup }, null, 2))
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally { db?.close() }
