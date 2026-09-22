import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bloodwork-browser-'))
const env = { PATH: process.env.PATH, BLOODWORK_DB_PATH: path.join(folder, 'synthetic.sqlite'), HOST: '127.0.0.1', PORT: '18787' }
const demo = spawnSync(process.execPath, ['server/demo.mjs'], { env, encoding: 'utf8' })
if (demo.status) throw new Error(demo.stderr)
const importer = spawnSync(process.execPath, ['skills/bloodwork-profile-import/scripts/import_manifest.mjs', '--db', env.BLOODWORK_DB_PATH, '--profile-id', '1', '--profile-name', 'Synthetic demo', '--manifest', 'demo/import-example.json', '--apply'], { env, encoding: 'utf8' })
if (importer.status) throw new Error(importer.stderr)
const server = spawn(process.execPath, ['server/index.mjs'], { env, stdio: 'inherit' })
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.kill('SIGTERM'))
server.on('exit', (code) => { fs.rmSync(folder, { recursive: true, force: true }); process.exit(code || 0) })
