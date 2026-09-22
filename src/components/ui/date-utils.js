export const displayDate = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

export function parseDateValue(value) {
  if (!validDateKey(value)) return undefined
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.valueOf()) ? undefined : date
}

export function dateValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) return ''
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

export function calendarBounds(dates = []) {
  const years = dates.filter(Boolean).map((date) => date.getFullYear())
  const currentYear = new Date().getFullYear()
  return {
    startMonth: new Date(Math.min(1900, ...years), 0, 1),
    endMonth: new Date(Math.max(currentYear + 5, ...years), 11, 1),
  }
}
import { validDateKey } from '../../../shared/results.js'
