import fs from 'node:fs'
import * as XLSX from '@e965/xlsx'
import { db } from './db.mjs'
import { parseResult, validDateKey } from '../shared/results.js'

const clean = (value) => String(value ?? '').trim()
const identity = (entry) => JSON.stringify([entry.category.toLowerCase(), entry.marker.toLowerCase(), entry.date])

export function validateEntries(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 20000) throw new Error('Import must contain 1–20000 observations.')
  const seen = new Set()
  return entries.map((entry, index) => {
    if (!entry || !validDateKey(entry.date)) throw new Error(`Row ${index + 1}: use a real ISO collection date (YYYY-MM-DD).`)
    const result = {
      category: clean(entry.category), marker: clean(entry.marker), date: entry.date,
      unit: clean(entry.unit), lab: clean(entry.lab), notes: clean(entry.notes),
      referenceRange: clean(entry.reference), method: clean(entry.method),
      ...parseResult(entry.value),
      provenance: entry.provenance ? JSON.stringify(entry.provenance) : null,
    }
    if (!result.category || !result.marker || result.category.length > 100 || result.marker.length > 200) throw new Error(`Row ${index + 1}: category and marker labels are required and must be short.`)
    if ([result.unit, result.lab, result.referenceRange, result.method].some((v) => v.length > 500) || result.notes.length > 5000 || result.provenance?.length > 10000) throw new Error(`Row ${index + 1}: metadata is too long.`)
    const key = identity(result)
    if (seen.has(key)) throw new Error(`Row ${index + 1}: duplicate marker and collection date. Resolve duplicates before import.`)
    seen.add(key)
    return result
  })
}

// No overwrite mode: conflicting results must be reviewed in the UI. Planning
// and writing share one immediate transaction, so a concurrent edit cannot turn
// a clean plan into a silent replacement.
export function importEntries(input, { profileId, profileName, dryRun = true } = {}) {
  const entries = validateEntries(input)
  const run = db.transaction(() => {
    const profile = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(Number(profileId))
    if (!profile || !profileName || profile.name !== profileName) throw new Error('Confirm both the existing profile ID and its exact name before importing.')
    const planned = []
    let identical = 0
    for (const entry of entries) {
      const existing = db.prepare(`SELECT r.* FROM records r JOIN markers m ON m.id = r.marker_id JOIN categories c ON c.id = m.category_id
        WHERE r.profile_id = ? AND c.name = ? COLLATE NOCASE AND m.name = ? COLLATE NOCASE AND r.measured_on = ?`).get(profile.id, entry.category, entry.marker, entry.date)
      if (!existing) { planned.push(entry); continue }
      const same = existing.value_numeric === entry.valueNumeric && existing.value_text === entry.valueText
        && existing.unit === entry.unit && existing.lab === entry.lab && existing.notes === entry.notes
        && (existing.reference_range || '') === entry.referenceRange && (existing.method || '') === entry.method
        && existing.raw_value === entry.rawValue && (existing.provenance || null) === entry.provenance
      if (!same) throw new Error('Import conflicts with an existing result. No observations were changed; review the matching marker/date in the app.')
      identical += 1
    }
    if (!dryRun) {
      for (const entry of planned) {
        db.prepare('INSERT OR IGNORE INTO categories(name, sort_order) VALUES (?, (SELECT coalesce(max(sort_order), 0) + 1 FROM categories))').run(entry.category)
        const categoryId = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(entry.category).id
        db.prepare('INSERT OR IGNORE INTO markers(profile_id, category_id, name, unit) VALUES (?, ?, ?, ?)').run(profile.id, categoryId, entry.marker, entry.unit)
        const markerId = db.prepare('SELECT id FROM markers WHERE profile_id = ? AND category_id = ? AND name = ? COLLATE NOCASE').get(profile.id, categoryId, entry.marker).id
        db.prepare(`INSERT INTO records(profile_id, marker_id, measured_on, value_numeric, value_text, raw_value, unit, lab, notes, reference_range, method, provenance)
          VALUES (@profileId, @markerId, @date, @valueNumeric, @valueText, @rawValue, @unit, @lab, @notes, @referenceRange, @method, @provenance)`)
          .run({ ...entry, profileId: profile.id, markerId })
      }
    }
    return { dryRun, profileId: profile.id, added: planned.length, identical, total: entries.length }
  })
  return dryRun ? run() : run.immediate()
}

export function readManifest(filename) {
  if (fs.statSync(filename).size > 10 * 1024 * 1024) throw new Error('Manifest exceeds the 10 MB limit.')
  const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'))
  if (!manifest.profile?.name || !Array.isArray(manifest.entries)) throw new Error('Manifest requires profile.name and entries.')
  if (manifest.conversions?.length) throw new Error('This importer preserves reported units. Supply original observations; automatic conversions are not supported.')
  const sources = new Map()
  for (const source of manifest.sources || []) {
    const label = source.current_file || source.source_file
    if (!label || sources.has(label)) throw new Error('Source labels must be unique.')
    sources.set(label, source)
  }
  const entries = manifest.entries.map((entry) => {
    const source = entry.source_file ? sources.get(entry.source_file) : null
    if (entry.source_file && (!source || source.status !== 'Complete' || source.date !== entry.date || source.lab !== entry.lab)) throw new Error('Every sourced observation must match a complete source, collection date, and lab.')
    return { ...entry, provenance: source ? {
      source: entry.source_file, sha256: source.sha256 || null, page: entry.page || null,
      markerRaw: entry.marker_raw || entry.marker, valueRaw: entry.value_raw ?? String(entry.value),
    } : null }
  })
  return { profileName: manifest.profile.name, entries }
}

export function readWorkbook(filename) {
  if (fs.statSync(filename).size > 5 * 1024 * 1024) throw new Error('Workbook exceeds the 5 MB limit. Only trusted local workbooks are supported.')
  const book = XLSX.read(fs.readFileSync(filename), { type: 'buffer', cellDates: true })
  const rowsOf = (sheet) => {
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1')
    if (range.e.r > 20000 || range.e.c > 500) throw new Error('Workbook dimensions exceed the import limit.')
    for (const [key, cell] of Object.entries(sheet)) {
      if (!key.startsWith('!') && (cell.f || cell.t === 'e')) throw new Error('Import values only: formulas and spreadsheet errors must be resolved first.')
    }
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
  }
  const dateKey = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : clean(value)
  const labs = new Map()
  if (book.Sheets.Sources) {
    const rows = rowsOf(book.Sheets.Sources)
    const header = rows.findIndex((row) => row.some((v) => clean(v).toLowerCase() === 'date'))
    if (header < 0) throw new Error('Sources must have Date and Lab columns.')
    const labels = rows[header].map((v) => clean(v).toLowerCase())
    const dateColumn = labels.indexOf('date')
    const labColumn = labels.includes('lab') ? labels.indexOf('lab') : labels.indexOf('lab name')
    if (labColumn < 0) throw new Error('Sources must have a Lab column.')
    for (const row of rows.slice(header + 1).filter((row) => row.some((v) => v != null))) {
      const date = dateKey(row[dateColumn])
      if (!validDateKey(date)) throw new Error('Sources contains an invalid collection date.')
      const lab = clean(row[labColumn])
      if (labs.has(date) && labs.get(date) !== lab) throw new Error('Multiple labs on one date require the observation-level manifest format.')
      labs.set(date, lab)
    }
  }
  const entries = []
  const excluded = new Set(['Profile', 'Sources', 'Trends', 'Conversions', 'Conversion Rules', 'Chart Data'])
  for (const name of book.SheetNames) {
    if (excluded.has(name)) continue
    const rows = rowsOf(book.Sheets[name])
    const header = rows.slice(0, 12).findIndex((row) => row.includes('Marker') && row.includes('Unit'))
    if (header < 0) throw new Error('Each category sheet must have Marker and Unit headers.')
    const labels = rows[header]
    const markerColumn = labels.indexOf('Marker')
    const unitColumn = labels.indexOf('Unit')
    const columns = labels.map((v, column) => ({ column, date: dateKey(v) })).filter(({ column }) => column !== markerColumn && column !== unitColumn)
    if (columns.some(({ date }) => !validDateKey(date))) throw new Error('Result headers must be real ISO or typed spreadsheet dates.')
    for (const row of rows.slice(header + 1)) {
      if (!row.some((v) => v != null && v !== '')) continue
      for (const { column, date } of columns) {
        const value = row[column]
        if (value === null || value === undefined || clean(value) === '') continue
        entries.push({ category: name, marker: clean(row[markerColumn]), unit: clean(row[unitColumn]), date, value, lab: labs.get(date) || '' })
      }
    }
  }
  return entries
}
