import { DayPicker, getDefaultClassNames } from '@daypicker/react'
import '@daypicker/react/style.css'
import { calendarBounds } from './date-utils.js'

const defaultClassNames = getDefaultClassNames()

export default function Calendar({
  className = '',
  classNames = {},
  captionLayout = 'dropdown',
  startMonth,
  endMonth,
  selected,
  labels,
  ...props
}) {
  const selectedDates = selected?.from || selected?.to
    ? [selected.from, selected.to]
    : [selected]
  const bounds = calendarBounds(selectedDates)

  return (
    <DayPicker
      showOutsideDays
      navLayout="around"
      captionLayout={captionLayout}
      startMonth={startMonth || bounds.startMonth}
      endMonth={endMonth || bounds.endMonth}
      selected={selected}
      className={`shadcn-calendar ${className}`}
      classNames={{ ...defaultClassNames, ...classNames }}
      labels={{
        labelMonthDropdown: () => 'Choose month',
        labelYearDropdown: () => 'Choose year',
        labelPrevious: () => 'Previous month',
        labelNext: () => 'Next month',
        ...labels,
      }}
      {...props}
    />
  )
}
