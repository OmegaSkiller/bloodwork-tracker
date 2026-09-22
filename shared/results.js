// Collection dates are calendar dates, never instants in the viewer's time zone.
export function validDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

export function parseResult(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Enter a number or a text result.')
  const rawValue = String(value).trim()
  if (!rawValue || rawValue.length > 500) throw new Error('Enter a result of 1–500 characters.')
  const numeric = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(rawValue)
  if (numeric) {
    const number = Number(rawValue)
    const significant = rawValue.split(/e/i)[0].replace(/[-+.]/g, '').replace(/^0+/, '').length
    if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER || significant > 15 || (number === 0 && /[1-9]/.test(rawValue.split(/e/i)[0]))) {
      throw new Error('Numeric results must be finite and have at most 15 significant digits.')
    }
    return { valueNumeric: number, valueText: null, rawValue }
  }
  if (/^[+-]?(?:nan|infinity)$/i.test(rawValue) || /^[+\-\d.,]/.test(rawValue)) {
    throw new Error('Use a decimal point for numbers; put units in the unit field. Qualitative or limit results such as Negative or <0.1 are allowed.')
  }
  return { valueNumeric: null, valueText: rawValue, rawValue }
}

export function resultLabel(record) {
  return record.rawValue ?? String(record.valueNumeric ?? record.valueText ?? '')
}

// Lines are descriptive, not clinical equivalence claims. Unknown labs/methods
// and missing or qualitative measurements break a line instead of imputing data.
export function comparisonKey(record) {
  return JSON.stringify([record.unit, record.lab, record.method, record.referenceRange])
}

export function chartRows(records, selectedIds, range) {
  return records.filter((record) => selectedIds.includes(record.markerId)
    && (!range || (record.measuredOn >= range.start && record.measuredOn <= range.end)))
    .sort((a, b) => a.measuredOn.localeCompare(b.measuredOn) || a.markerId - b.markerId)
}

export function chartSegments(records, markerId, dates) {
  const byDate = new Map(records.filter((record) => record.markerId === markerId).map((record) => [record.measuredOn, record]))
  const segments = []
  let segment = null
  let previous = null
  for (const date of dates) {
    const record = byDate.get(date)
    if (!record || record.valueNumeric === null || !Number.isFinite(record.valueNumeric)) {
      segment = previous = null
      continue
    }
    if (!previous || !record.lab || !record.method || !record.unit || comparisonKey(previous) !== comparisonKey(record)) {
      segment = []
      segments.push(segment)
    }
    segment.push(record)
    previous = record
  }
  return segments
}
