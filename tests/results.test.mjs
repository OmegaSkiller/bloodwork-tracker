import test from 'node:test'
import assert from 'node:assert/strict'
import { validDateKey, parseResult, chartRows, chartSegments, resultLabel } from '../shared/results.js'
import { dateValue, parseDateValue } from '../src/components/ui/date-utils.js'

test('real calendar dates, including leap days, use strict ISO ordering', () => {
  for (const value of ['2024-02-29', '2026-01-01']) assert.equal(validDateKey(value), true)
  for (const value of ['2025-02-29', '2026-02-30', '2026-13-01', '1/2/2026', '2026-01-01T00:00:00Z']) assert.equal(validDateKey(value), false)
  assert.equal(parseDateValue('2025-02-30'), undefined)
  assert.equal(dateValue(parseDateValue('2024-02-29')), '2024-02-29')
})

test('preserve numeric spelling and precision; limits stay qualitative; missing is not zero', () => {
  assert.deepEqual(parseResult('1.2300'), { valueNumeric: 1.23, valueText: null, rawValue: '1.2300' })
  assert.equal(parseResult('0').valueNumeric, 0)
  assert.equal(parseResult('1.2e-3').valueNumeric, 0.0012)
  for (const value of ['<0.1', 'Negative', 'Trace']) assert.equal(parseResult(value).valueNumeric, null)
  for (const value of ['', null, {}, true, 'NaN', 'Infinity', '1e999', '1e-999', '1,25', '12 mg/dL', '1234567890123456']) assert.throws(() => parseResult(value))
})

test('chart table shares an inclusive chronological scope and retains text measurements', () => {
  const rows = [
    { id: 3, markerId: 1, measuredOn: '2025-03-01', ...parseResult('1.2300') },
    { id: 1, markerId: 1, measuredOn: '2025-01-01', ...parseResult('Negative') },
    { id: 2, markerId: 2, measuredOn: '2025-02-01', ...parseResult('2') },
  ]
  assert.deepEqual(chartRows(rows, [1], { start: '2025-01-01', end: '2025-03-01' }).map((r) => r.id), [1, 3])
  assert.equal(resultLabel(chartRows(rows, [1], { start: '2025-03-01', end: '2025-03-01' })[0]), '1.2300')
  assert.equal(chartRows(rows, [], null).length, 0)
})

test('missing, qualitative, and incompatible observations never form a continuous line', () => {
  const make = (date, extra = {}) => ({ markerId: 1, measuredOn: date, unit: 'mmol/L', lab: 'Synthetic A', method: 'Assay A', referenceRange: '3–6', valueNumeric: 5, ...extra })
  const dates = Array.from({ length: 8 }, (_, i) => `2025-01-0${i + 1}`)
  const rows = [make(dates[0]), make(dates[1]), make(dates[3]), make(dates[4], { unit: 'mg/dL' }), make(dates[5], { lab: 'Synthetic B' }), make(dates[6], { method: '' }), make(dates[7], { valueNumeric: null })]
  assert.deepEqual(chartSegments(rows, 1, dates).map((s) => s.length), [2, 1, 1, 1, 1])
  for (const field of ['unit', 'lab', 'method', 'referenceRange']) {
    assert.equal(chartSegments([make(dates[0]), make(dates[1], { [field]: 'changed' })], 1, dates.slice(0, 2)).length, 2)
  }
})
