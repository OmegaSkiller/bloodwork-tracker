import { useState } from 'react'
import { Icon } from './Icons.jsx'
import Calendar from './ui/Calendar.jsx'
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover.jsx'
import { calendarBounds, dateValue, displayDate, parseDateValue } from './ui/date-utils.js'

export default function DatePickerField({ label, value, onChange, placeholder, required = false, min = '', max = '', allowClear = false, align = 'left' }) {
  const [open, setOpen] = useState(false)
  const selected = parseDateValue(value)
  const minimum = parseDateValue(min)
  const maximum = parseDateValue(max)
  const bounds = calendarBounds([selected, minimum, maximum])
  const disabled = [minimum ? { before: minimum } : null, maximum ? { after: maximum } : null].filter(Boolean)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-required={required}
          className="mt-1.5 flex w-full items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-left text-sm shadow-sm outline-none transition hover:border-stone-300 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10 data-[state=open]:border-teal-600 data-[state=open]:ring-4 data-[state=open]:ring-teal-600/10"
        >
          <span className={selected ? 'font-medium text-stone-900' : 'text-stone-400'}>{selected ? displayDate.format(selected) : placeholder}</span>
          <Icon name="calendar" className="size-4 shrink-0 text-stone-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align === 'right' ? 'end' : 'start'}>
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected || minimum || new Date()}
            startMonth={minimum || bounds.startMonth}
            endMonth={maximum || bounds.endMonth}
            disabled={disabled.length ? disabled : undefined}
            onSelect={(date) => {
              if (!date && required) return
              onChange(dateValue(date))
              if (date) setOpen(false)
            }}
          />
          {allowClear && value && <button type="button" onClick={() => { onChange(''); setOpen(false) }} className="mb-1 w-full rounded-xl px-3 py-2 text-xs font-semibold text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 focus:outline-none focus:ring-2 focus:ring-teal-600">Clear end date · single-day event</button>}
      </PopoverContent>
    </Popover>
  )
}
