import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import * as XLSX from '@e965/xlsx'

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bloodwork-import-test-'))
process.env.BLOODWORK_DB_PATH = path.join(folder, 'test.sqlite')
const { db, createSchema } = await import('../server/db.mjs')
const { importEntries, readWorkbook, readManifest } = await import('../server/import.mjs')
createSchema()
after(() => { db.close(); fs.rmSync(folder, { recursive: true, force: true }) })
const options = { profileId: 1, profileName: 'Personal profile', dryRun: false }
const entry = { category: 'Synthetic', marker: 'Example', date: '2024-02-29', value: '1.2300', unit: 'mmol/L', lab: 'Synthetic A', reference: '1–2', method: 'Assay A' }

test('additive migrations preserve populated data and remain idempotent', () => {
  importEntries([entry], options)
  const before = db.prepare('SELECT * FROM records').all()
  createSchema(); createSchema()
  assert.deepEqual(db.prepare('SELECT * FROM records').all(), before)
  assert.deepEqual(db.pragma('foreign_key_check'), [])
})

test('dry-run and duplicate imports leave existing results unchanged', () => {
  const incoming = { ...entry, date: '2025-01-01', value: '2.500' }
  assert.equal(importEntries([incoming], { ...options, dryRun: true }).added, 1)
  assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n, 1)
  assert.equal(importEntries([entry], options).identical, 1)
  assert.equal(db.prepare('SELECT raw_value FROM records').get().raw_value, '1.2300')
})

test('a later conflict, invalid row or wrong profile rolls back the whole import', () => {
  const before = db.prepare('SELECT * FROM records').all()
  assert.throws(() => importEntries([{ ...entry, marker: 'New marker' }, { ...entry, value: '9' }], options), /conflicts/)
  assert.throws(() => importEntries([{ ...entry, marker: 'New marker' }, { ...entry, date: '2025-02-30' }], options), /date/)
  assert.throws(() => importEntries([entry, entry], options), /duplicate/)
  assert.throws(() => importEntries([entry], { ...options, profileName: 'Different profile' }), /Confirm/)
  assert.deepEqual(db.prepare('SELECT * FROM records').all(), before)
  assert.equal(db.prepare("SELECT count(*) AS n FROM markers WHERE name='New marker'").get().n, 0)
})

test('same marker with new unit preserves both units and per-report reference ranges', () => {
  importEntries([{ ...entry, date: '2025-02-01', value: '91.0', unit: 'mg/dL', reference: '70–110' }], options)
  const rows = db.prepare('SELECT unit, reference_range FROM records ORDER BY measured_on').all()
  assert.deepEqual(rows, [{ unit: 'mmol/L', reference_range: '1–2' }, { unit: 'mg/dL', reference_range: '70–110' }])
})

test('workbook import reads UTC dates, preserves missing and text cells, rejects formulas and ambiguous dates', () => {
  const book = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([['Marker', 'Unit', new Date('2024-02-29T00:00:00Z'), '2025-03-01'], ['Example', 'mmol/L', 0, null], ['Qualitative', '', 'Negative', '<0.1']], { cellDates: true })
  XLSX.utils.book_append_sheet(book, sheet, 'Synthetic')
  const file = path.join(folder, 'synthetic.xlsx')
  fs.writeFileSync(file, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
  const rows = readWorkbook(file)
  assert.equal(rows.length, 3)
  assert.equal(rows[0].date, '2024-02-29')
  assert.equal(rows[0].value, 0)
  sheet.C2.f = '1+1'
  fs.writeFileSync(file, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
  assert.throws(() => readWorkbook(file), /formulas/)
  delete sheet.C2.f
  sheet.C1 = { t: 's', v: '2025-02-30' }
  fs.writeFileSync(file, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
  assert.throws(() => readWorkbook(file), /headers/)
})

test('manifest sources must match identity context; source metadata is retained', () => {
  const file = path.join(folder, 'manifest.json')
  const manifest = { profile: { name: options.profileName }, sources: [{ current_file: 'synthetic.pdf', status: 'Complete', date: entry.date, lab: entry.lab }], entries: [{ ...entry, source_file: 'synthetic.pdf', page: 2, marker_raw: 'Reported label' }] }
  fs.writeFileSync(file, JSON.stringify(manifest))
  assert.equal(readManifest(file).entries[0].provenance.page, 2)
  manifest.sources[0].status = 'Exact duplicate'
  fs.writeFileSync(file, JSON.stringify(manifest))
  assert.throws(() => readManifest(file), /complete source/)
})

test('demo seeding refuses any existing destination and does not overwrite it', () => {
  const destination = path.join(folder, 'occupied.sqlite')
  fs.writeFileSync(destination, 'preserve me')
  const result = spawnSync(process.execPath, ['server/demo.mjs'], { cwd: path.resolve('.'), env: { ...process.env, BLOODWORK_DB_PATH: destination }, encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /already exists/)
  assert.equal(fs.readFileSync(destination, 'utf8'), 'preserve me')
})
