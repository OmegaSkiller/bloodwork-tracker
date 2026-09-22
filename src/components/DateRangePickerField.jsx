import { useEffect, useState } from 'react'
import { Icon } from './Icons.jsx'
import Calendar from './ui/Calendar.jsx'
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover.jsx'
import { dateValue, displayDate, parseDateValue } from './ui/date-utils.js'

function useCalendarMonthCount() {
  const [count, setCount] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches ? 2 : 1)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 640px)')
    const update = () => setCount(media.matches ? 2 : 1)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return count
}

export default function DateRangePickerField({ label, startValue, endValue, onChange, min = '', max = '', align = 'left' }) {
  const [open, setOpen] = useState(false)
  const monthCount = useCalendarMonthCount()
  const from = parseDateValue(startValue)
  const to = parseDateValue(endValue)
  const minimum = parseDateValue(min)
  const maximum = parseDateValue(max)
  const selected = from ? { from, to } : undefined
  const disabled = [minimum ? { before: minimum } : null, maximum ? { after: maximum } : null].filter(Boolean)
  const rangeLabel = from && to
    ? `${displayDate.format(from)} – ${displayDate.format(to)}`
    : from
      ? `${displayDate.format(from)} – Select end date`
      : 'Choose date range'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-teal-200 bg-white px-3.5 py-2.5 text-left text-sm shadow-sm outline-none transition hover:border-teal-300 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10 data-[state=open]:border-teal-600 data-[state=open]:ring-4 data-[state=open]:ring-teal-600/10"
        >
          <span className={from ? 'font-medium text-stone-900' : 'text-stone-400'}>{rangeLabel}</span>
          <Icon name="calendar" className="size-4 shrink-0 text-teal-700" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align === 'right' ? 'end' : 'start'} className="max-w-[calc(100vw-24px)] overflow-x-auto">
        <Calendar
          mode="range"
          resetOnSelect
          selected={selected}
          defaultMonth={from || minimum || new Date()}
          numberOfMonths={monthCount}
          startMonth={minimum}
          endMonth={maximum}
          disabled={disabled.length ? disabled : undefined}
          onSelect={(range) => {
            const nextStart = dateValue(range?.from)
            const nextEnd = dateValue(range?.to)
            onChange(nextStart, nextEnd)
            if (range?.from && range?.to && range.from.valueOf() !== range.to.valueOf()) setOpen(false)
          }}
        />
        <p className="border-t border-stone-100 px-3 py-2 text-xs text-stone-500">{!from || to ? 'Choose start date, then end date.' : 'Now choose end date.'}</p>
      </PopoverContent>
    </Popover>
  )
}
