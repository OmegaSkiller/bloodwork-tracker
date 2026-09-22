import { chartRows, chartSegments, resultLabel } from '../../shared/results.js'
import { useEffect, useMemo, useState } from 'react'
import DateRangePickerField from './DateRangePickerField.jsx'

const palette = ['#0f766e', '#ea580c', '#4f46e5', '#be123c', '#0284c7', '#7c3aed']
const dateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const fullDate = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const dimensions = { width: 920, height: 440, left: 54, right: 24, top: 28, bottom: 88 }

function formatNumber(value) {
  if (Math.abs(value) >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (Math.abs(value) >= 10) return value.toLocaleString('en-US', { maximumFractionDigits: 1 })
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function eventColors(colorIndex) {
  const hue = Math.round((Number(colorIndex) * 137.508 + 24) % 360)
  return {
    stroke: `hsl(${hue}, 58%, 45%)`,
    gradientTop: `hsla(${hue}, 58%, 45%, 0.28)`,
    gradientBottom: `hsla(${hue}, 58%, 45%, 0)`,
    label: `hsla(${hue}, 72%, 91%, 0.98)`,
  }
}

function eventBoundaryLabel(value) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

function timestampKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function dateTimestamp(value) {
  const parsed = new Date(`${value}T00:00:00Z`).valueOf()
  return Number.isNaN(parsed) ? null : parsed
}

function subtractUtc(timestamp, amount, unit) {
  const date = new Date(timestamp)
  if (unit === 'month') date.setUTCMonth(date.getUTCMonth() - amount)
  else date.setUTCFullYear(date.getUTCFullYear() - amount)
  return date.valueOf()
}

export default function TrendChart({ markers, records, selectedIds, lifeEvents = [], onEditLifeEvent, onRangeChange }) {
  const [hoveredDate, setHoveredDate] = useState(null)
  const [highlightedEventId, setHighlightedEventId] = useState(null)
  const [plotHoveredEventId, setPlotHoveredEventId] = useState(null)
  const [copyStatus, setCopyStatus] = useState(null)
  const [rangePreset, setRangePreset] = useState('all')
  const [viewRange, setViewRange] = useState(null)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [customRangeVisible, setCustomRangeVisible] = useState(false)
  const chosen = markers.filter((marker) => selectedIds.includes(marker.id)).slice(0, 6)

  const timelineBounds = useMemo(() => {
    const pointDates = records
      .filter((record) => selectedIds.includes(record.markerId))
      .map((record) => new Date(`${record.measuredOn}T00:00:00Z`).valueOf())
    const eventDates = lifeEvents.flatMap((lifeEvent) => [lifeEvent.startsOn, lifeEvent.endsOn].filter(Boolean).map((date) => new Date(`${date}T00:00:00Z`).valueOf()))
    const dates = [...pointDates, ...eventDates].filter(Number.isFinite).sort((a, b) => a - b)
    const min = dates[0] ?? Date.now()
    const max = dates.at(-1) ?? min
    return { min, max }
  }, [lifeEvents, records, selectedIds])

  const model = useMemo(() => {
    const baseSeries = chosen.flatMap((marker, index) => {
      const markerRecords = records.filter((record) => record.markerId === marker.id)
      return [...new Set(markerRecords.map((record) => record.unit))].map((unit, unitIndex) => ({
        marker: { ...marker, unit }, key: JSON.stringify([marker.id, unit]),
        color: palette[index], dash: unitIndex ? '7 5' : undefined,
        allPoints: markerRecords.filter((record) => record.unit === unit && record.valueNumeric !== null)
          .map((record) => ({ date: new Date(`${record.measuredOn}T00:00:00Z`), value: record.valueNumeric, record }))
          .sort((a, b) => a.date - b.date),
      }))
    })
    let minDate = viewRange?.start ?? timelineBounds.min
    let maxDate = viewRange?.end ?? timelineBounds.max
    minDate = Math.max(timelineBounds.min, Math.min(minDate, timelineBounds.max))
    maxDate = Math.min(timelineBounds.max, Math.max(maxDate, minDate))
    const series = baseSeries.map((item) => ({
      ...item,
      points: item.allPoints.filter((point) => point.date.valueOf() >= minDate && point.date.valueOf() <= maxDate),
    })).filter((item) => item.points.length)
    const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.date.valueOf())))].sort((a, b) => a - b)
    const units = new Set(series.map((item) => item.marker.unit || 'No unit'))
    const normalized = units.size > 1
    const allValues = series.flatMap((item) => item.points.map((point) => point.value))
    let minValue = Math.min(...allValues)
    let maxValue = Math.max(...allValues)
    if (!allValues.length) [minValue, maxValue] = [0, 1]
    if (minValue === maxValue) [minValue, maxValue] = [minValue - 1, maxValue + 1]
    const padding = (maxValue - minValue) * 0.08
    minValue -= padding
    maxValue += padding

    const plotWidth = dimensions.width - dimensions.left - dimensions.right
    const plotHeight = dimensions.height - dimensions.top - dimensions.bottom
    const x = (date) => dimensions.left + ((date.valueOf() - minDate) / Math.max(maxDate - minDate, 1)) * plotWidth
    const y = (value, item) => {
      if (normalized) {
        const values = item.points.map((point) => point.value)
        const low = Math.min(...values)
        const high = Math.max(...values)
        const ratio = high === low ? 0.5 : (value - low) / (high - low)
        return dimensions.top + (1 - ratio) * plotHeight
      }
      return dimensions.top + (1 - (value - minValue) / (maxValue - minValue)) * plotHeight
    }
    return { series, dates, normalized, minDate, maxDate, minValue, maxValue, x, y, plotHeight, plotWidth, hasAnySeries: baseSeries.some((item) => item.allPoints.length) }
  }, [chosen, records, timelineBounds, viewRange])

  function pointsAtDate(timestamp) {
    return model.series.map((item) => {
      const point = item.points.find((candidate) => candidate.date.valueOf() === timestamp)
      return point ? { ...point, item } : null
    }).filter(Boolean)
  }

  const hoverPoints = hoveredDate === null ? [] : pointsAtDate(hoveredDate)

  function nearestDateForX(svgX) {
    const targetTime = model.minDate + ((svgX - dimensions.left) / model.plotWidth) * Math.max(model.maxDate - model.minDate, 1)
    return model.dates.reduce((best, date) => Math.abs(date - targetTime) < Math.abs(best - targetTime) ? date : best)
  }

  async function writeMarkdown(markdown, status) {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopyStatus({ ...status, error: false })
    } catch {
      setCopyStatus({ pointId: null, copiedDate: null, message: 'Clipboard access was unavailable', error: true })
    }
  }

  function markdownValue(point, item) {
    const unit = item.marker.unit ? ` ${item.marker.unit}` : ''
    return `- **${item.marker.name}:** ${resultLabel(point.record)}${unit}`
  }

  async function copyPoint(point, item) {
    await writeMarkdown(`${markdownValue(point, item)} — ${fullDate.format(point.date)}`, {
      pointId: point.record.id,
      copiedDate: null,
      message: `${item.marker.name} copied as Markdown`,
    })
  }

  async function handleChartClick(event) {
    if (!model.dates.length) return
    const { x: svgX, y: svgY } = pointerPosition(event)
    if (svgX < dimensions.left || svgX > dimensions.width - dimensions.right || svgY < dimensions.top || svgY > dimensions.height - dimensions.bottom) return
    const timestamp = nearestDateForX(svgX)
    const points = pointsAtDate(timestamp)
    if (!points.length) return
    const markdown = [`## Bloodwork — ${fullDate.format(new Date(timestamp))}`, '', ...points.map(({ item, ...point }) => markdownValue(point, item))].join('\n')
    await writeMarkdown(markdown, {
      pointId: null,
      copiedDate: timestamp,
      message: `${points.length} ${points.length === 1 ? 'marker' : 'markers'} copied as Markdown`,
    })
  }

  useEffect(() => {
    onRangeChange?.({
      start: timestampKey(model.minDate),
      end: timestampKey(model.maxDate),
      preset: rangePreset,
    })
  }, [model.minDate, model.maxDate, onRangeChange, rangePreset])

  useEffect(() => {
    if (!copyStatus) return
    const timeout = window.setTimeout(() => setCopyStatus(null), 2400)
    return () => window.clearTimeout(timeout)
  }, [copyStatus])

  function pointerPosition(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * dimensions.width,
      y: ((event.clientY - rect.top) / rect.height) * dimensions.height,
    }
  }

  function handlePointerMove(event) {
    if (!model.dates.length) {
      setHoveredDate(null)
      return
    }
    const { x: svgX } = pointerPosition(event)
    setHoveredDate(nearestDateForX(svgX))
  }

  function chooseRangePreset(preset) {
    setRangePreset(preset)
    setHoveredDate(null)
    if (preset === 'all') {
      setCustomRangeVisible(false)
      setViewRange(null)
      setCustomStart(timestampKey(timelineBounds.min))
      setCustomEnd(timestampKey(timelineBounds.max))
      return
    }
    if (preset === 'custom') {
      setCustomRangeVisible(true)
      setCustomStart(timestampKey(model.minDate))
      setCustomEnd(timestampKey(model.maxDate))
      return
    }
    setCustomRangeVisible(false)
    const durations = {
      '3m': [3, 'month'],
      '6m': [6, 'month'],
      '1y': [1, 'year'],
      '2y': [2, 'year'],
    }
    const [amount, unit] = durations[preset]
    const end = timelineBounds.max
    const start = Math.max(timelineBounds.min, subtractUtc(end, amount, unit))
    setViewRange({ start, end })
    setCustomStart(timestampKey(start))
    setCustomEnd(timestampKey(end))
  }

  function updateCustomRange(nextStart, nextEnd) {
    setRangePreset('custom')
    setHoveredDate(null)
    setCustomStart(nextStart)
    setCustomEnd(nextEnd)
    const start = dateTimestamp(nextStart)
    const end = dateTimestamp(nextEnd)
    if (start === null || end === null || end < start) return
    setViewRange({ start, end })
  }

  function handleWheel(event) {
    const fullSpan = timelineBounds.max - timelineBounds.min
    const currentSpan = model.maxDate - model.minDate
    if (fullSpan <= 14 * 86400000 || (event.deltaY > 0 && currentSpan >= fullSpan * 0.995)) return
    event.preventDefault()
    const { x: svgX } = pointerPosition(event)
    const anchorRatio = Math.max(0, Math.min(1, (svgX - dimensions.left) / model.plotWidth))
    const factor = event.deltaY > 0 ? 1.28 : 0.78
    const nextSpan = Math.max(14 * 86400000, Math.min(fullSpan, currentSpan * factor))
    const anchor = model.minDate + currentSpan * anchorRatio
    let start = anchor - nextSpan * anchorRatio
    let end = start + nextSpan
    if (start < timelineBounds.min) {
      start = timelineBounds.min
      end = start + nextSpan
    }
    if (end > timelineBounds.max) {
      end = timelineBounds.max
      start = end - nextSpan
    }
    if (nextSpan >= fullSpan * 0.995) {
      setRangePreset('all')
      setCustomRangeVisible(false)
      setViewRange(null)
      setCustomStart(timestampKey(timelineBounds.min))
      setCustomEnd(timestampKey(timelineBounds.max))
      return
    }
    setRangePreset('custom')
    setCustomRangeVisible(false)
    setViewRange({ start, end })
    setCustomStart(timestampKey(start))
    setCustomEnd(timestampKey(end))
  }

  if (!model.hasAnySeries) {
    return (
      <div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-stone-300 bg-stone-50/60 text-center">
        <div className="max-w-sm px-6">
          <p className="font-semibold text-stone-800">Choose a marker with numeric results</p>
          <p className="mt-1 text-sm text-stone-500">Text results remain available in the records table but are not plotted.</p>
        </div>
      </div>
    )
  }

  const yTicks = Array.from({ length: 5 }, (_, index) => index / 4)
  const xTicks = [...new Set(Array.from({ length: 5 }, (_, index) => model.minDate + ((model.maxDate - model.minDate) * index) / 4))]
  const visibleRows = chartRows(records, selectedIds, { start: timestampKey(model.minDate), end: timestampKey(model.maxDate) })
  const collectionDates = [...new Set(records.map((record) => record.measuredOn))].sort().filter((date) => date >= timestampKey(model.minDate) && date <= timestampKey(model.maxDate))
  const laneEnds = []
  const eventLayouts = lifeEvents
    .filter((lifeEvent) => {
      const eventStart = dateTimestamp(lifeEvent.startsOn)
      const eventEnd = dateTimestamp(lifeEvent.endsOn || lifeEvent.startsOn)
      return eventStart !== null && eventEnd !== null && eventEnd >= model.minDate && eventStart <= model.maxDate
    })
    .map((lifeEvent) => {
      const eventStart = Math.max(model.minDate, dateTimestamp(lifeEvent.startsOn))
      const eventEnd = Math.min(model.maxDate, dateTimestamp(lifeEvent.endsOn || lifeEvent.startsOn))
      const startX = model.x(new Date(eventStart))
      const endX = model.x(new Date(eventEnd))
      const bandX = Math.max(dimensions.left, Math.min(startX, endX) - (lifeEvent.endsOn ? 0 : 5))
      const bandRight = Math.min(dimensions.width - dimensions.right, Math.max(startX, endX) + (lifeEvent.endsOn ? 0 : 5))
      const bandWidth = Math.max(bandRight - bandX, 3)
      return { lifeEvent, startX, endX, bandX, bandRight, bandWidth }
    })
    .sort((a, b) => a.bandX - b.bandX || b.bandRight - a.bandRight)
    .map((layout) => {
      let lane = laneEnds.findIndex((laneEnd) => laneEnd + 6 < layout.bandX)
      if (lane < 0) lane = laneEnds.length
      laneEnds[lane] = Math.max(laneEnds[lane] ?? -Infinity, layout.bandRight)
      const colors = eventColors(layout.lifeEvent.colorIndex)
      return { ...layout, lane, capY: dimensions.top + 12 + lane * 16, colors }
    })
  const orderedEventLayouts = highlightedEventId
    ? [...eventLayouts.filter((layout) => layout.lifeEvent.id !== highlightedEventId), ...eventLayouts.filter((layout) => layout.lifeEvent.id === highlightedEventId)]
    : eventLayouts

  return (
    <div className="relative">
      <p className="mb-3 text-xs leading-5 text-stone-600" id="chart-scale">{model.normalized ? 'Each marker/unit series uses its own low-to-high visual scale in this view; line heights cannot be compared.' : 'Shared numeric scale for the displayed unit.'} Lines stop at missing results and changes in lab, method, range, or unit. Unknown lab, method, or unit is shown as points only. This does not establish clinical comparability.</p>
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-50/80 p-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-fit max-w-full overflow-x-auto rounded-xl border border-stone-200 bg-white p-1 shadow-sm" aria-label="Chart timeframe">
          {[
            ['3m', '3M'],
            ['6m', '6M'],
            ['1y', '1Y'],
            ['2y', '2Y'],
            ['all', 'All time'],
            ['custom', 'Custom'],
          ].map(([value, label]) => <button key={value} type="button" aria-pressed={rangePreset === value} onClick={() => chooseRangePreset(value)} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition ${rangePreset === value ? 'bg-stone-100 text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-900'}`}>{label}</button>)}
        </div>
        <p className="px-1 text-[11px] font-medium text-stone-400">Scroll over the plot to zoom around the pointer</p>
      </div>

      {customRangeVisible && <div className="relative z-20 mb-4 rounded-2xl border border-teal-100 bg-teal-50/60 p-3">
        <div className="text-xs font-semibold text-stone-600">
          Custom period
          <div className="mt-1.5">
            <DateRangePickerField label="Custom chart period" startValue={customStart} endValue={customEnd} min={timestampKey(timelineBounds.min)} max={timestampKey(timelineBounds.max)} onChange={updateCustomRange} />
          </div>
        </div>
      </div>}

      <div className="relative">
        <svg
          role="group"
          aria-label="Interactive marker trend chart. Click a data point to copy that marker, or click elsewhere in the plot to copy all visible markers at the nearest date. Scroll to zoom the timeframe."
          viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
          className="w-full touch-pan-y overflow-visible" aria-describedby="chart-scale"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoveredDate(null)}
          onClick={handleChartClick}
          onWheel={handleWheel}
        >
        <defs>
          {lifeEvents.map((lifeEvent) => {
            const colors = eventColors(lifeEvent.colorIndex)
            return <linearGradient key={lifeEvent.id} id={`life-event-gradient-${lifeEvent.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colors.gradientTop} /><stop offset="100%" stopColor={colors.gradientBottom} /></linearGradient>
          })}
        </defs>
        <rect x={dimensions.left} y={dimensions.top} width={model.plotWidth} height={model.plotHeight} fill="transparent" className="cursor-copy" />

        {orderedEventLayouts.map(({ lifeEvent, bandX, bandWidth, capY }) => {
          const highlighted = highlightedEventId === lifeEvent.id
          const dimmed = highlightedEventId !== null && !highlighted
          return <rect
            key={lifeEvent.id}
            className="pointer-events-none transition-[opacity,filter] duration-150"
            x={bandX}
            y={capY}
            width={bandWidth}
            height={dimensions.height - dimensions.bottom - capY}
            fill={`url(#life-event-gradient-${lifeEvent.id})`}
            opacity={dimmed ? 0.14 : 1}
            style={{ filter: highlighted ? 'brightness(1.16) saturate(1.2)' : 'none' }}
          />
        })}

        {yTicks.map((ratio) => {
          const y = dimensions.top + ratio * model.plotHeight
          return <g key={ratio}><line x1={dimensions.left} x2={dimensions.width - dimensions.right} y1={y} y2={y} stroke="#e7e5e4" strokeDasharray="4 7" /><text x={dimensions.left - 8} y={y + 4} textAnchor="end" className="fill-stone-600 text-[10px]">{model.normalized ? ratio === 0 ? 'High' : ratio === 1 ? 'Low' : '' : formatNumber(model.maxValue - ratio * (model.maxValue - model.minValue))}</text></g>
        })}

        {xTicks.map((timestamp) => {
          const x = model.x(new Date(timestamp))
          return <text key={timestamp} x={x} y={dimensions.height - 17} textAnchor="middle" className="fill-stone-400 text-[11px]">{dateLabel.format(new Date(timestamp))}</text>
        })}

        {model.series.map((item) => {
          const segments = chartSegments(visibleRows, item.marker.id, collectionDates).filter((segment) => segment[0].unit === item.marker.unit)
          const d = segments.map((segment) => segment.map((record, index) => `${index ? 'L' : 'M'} ${model.x(new Date(record.measuredOn + 'T00:00:00Z'))} ${model.y(record.valueNumeric, item)}`).join(' ')).join(' ')
          return (
            <g key={item.key}>
              <path className="pointer-events-none" d={d} fill="none" stroke={item.color} strokeDasharray={item.dash} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              {item.points.map((point) => {
                const copied = copyStatus?.pointId === point.record.id || copyStatus?.copiedDate === point.date.valueOf()
                const label = `${item.marker.name}, ${resultLabel(point.record)}${item.marker.unit ? ` ${item.marker.unit}` : ''}, ${fullDate.format(point.date)}`
                return <g
                  key={point.record.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Copy ${label} as Markdown`}
                  className="group cursor-copy outline-none"
                  onPointerEnter={() => setHoveredDate(point.date.valueOf())}
                  onFocus={() => setHoveredDate(point.date.valueOf())}
                  onClick={(event) => { event.stopPropagation(); copyPoint(point, item) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      copyPoint(point, item)
                    }
                  }}
                >
                  <circle cx={model.x(point.date)} cy={model.y(point.value, item)} r="11" fill="transparent" />
                  <circle className="pointer-events-none transition-[r,filter] group-focus-visible:stroke-[4]" cx={model.x(point.date)} cy={model.y(point.value, item)} r={copied ? 6 : 4} fill={copied ? item.color : 'white'} stroke={item.color} strokeWidth="2.5" />
                </g>
              })}
            </g>
          )
        })}

        {!model.series.length && <text x={dimensions.width / 2} y={dimensions.top + model.plotHeight / 2} textAnchor="middle" className="fill-stone-400 text-[13px] font-medium">No numeric results in this timeframe</text>}

        {orderedEventLayouts.map(({ lifeEvent, startX, endX, bandX, bandRight, bandWidth, capY, colors }) => {
          const startNearLeft = startX < dimensions.left + 135
          const endNearRight = endX > dimensions.width - dimensions.right - 135
          const highlighted = highlightedEventId === lifeEvent.id
          const dimmed = highlightedEventId !== null && !highlighted
          const showDates = plotHoveredEventId === lifeEvent.id
          return <g
            key={lifeEvent.id}
            className="cursor-copy transition-[opacity,filter] duration-150"
            opacity={dimmed ? 0.18 : 1}
            style={{ filter: highlighted ? 'brightness(1.16) saturate(1.2)' : 'none' }}
            onPointerEnter={() => {
              setHighlightedEventId(lifeEvent.id)
              setPlotHoveredEventId(lifeEvent.id)
            }}
            onPointerLeave={() => {
              setHighlightedEventId(null)
              setPlotHoveredEventId(null)
            }}
          >
            <rect x={bandX} y={capY - 5} width={bandWidth} height={Math.max(dimensions.height - dimensions.bottom - capY + 5, 10)} fill="transparent" />
            <line x1={bandX} x2={Math.max(bandRight, bandX + bandWidth)} y1={capY} y2={capY} stroke={colors.stroke} strokeWidth="1.5" strokeLinecap="round" />
            {showDates && <text x={startX + (startNearLeft ? 4 : -4)} y={dimensions.height - dimensions.bottom + 18} textAnchor={startNearLeft ? 'start' : 'end'} className="pointer-events-none select-none text-[9px] font-semibold" fill={colors.stroke}>{lifeEvent.endsOn ? 'Start' : 'Date'} · {eventBoundaryLabel(lifeEvent.startsOn)}</text>}
            {showDates && lifeEvent.endsOn && <text x={endX + (endNearRight ? -4 : 4)} y={dimensions.height - dimensions.bottom + 34} textAnchor={endNearRight ? 'end' : 'start'} className="pointer-events-none select-none text-[9px] font-semibold" fill={colors.stroke}>End · {eventBoundaryLabel(lifeEvent.endsOn)}</text>}
          </g>
        })}

        {hoveredDate !== null && hoverPoints.length > 0 && <line className="pointer-events-none" x1={model.x(new Date(hoveredDate))} x2={model.x(new Date(hoveredDate))} y1={dimensions.top} y2={dimensions.height - dimensions.bottom} stroke="#78716c" strokeDasharray="3 4" />}
        </svg>

        {hoveredDate !== null && hoverPoints.length > 0 && (
          <div className="pointer-events-none absolute right-3 top-3 min-w-48 rounded-xl border border-stone-200 bg-white/95 p-3 shadow-lg backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">{fullDate.format(new Date(hoveredDate))}</p>
            <div className="mt-2 space-y-1.5">
              {hoverPoints.map(({ item, record }) => (
                <div key={item.key} className="flex items-center justify-between gap-5 text-sm">
                  <span className="flex min-w-0 items-center gap-2 text-stone-600"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} /><span className="truncate">{item.marker.name}</span></span>
                  <strong className="whitespace-nowrap text-stone-900">{resultLabel(record)} {item.marker.unit}</strong>
                </div>
              ))}
            </div>
            <p className="mt-2 border-t border-stone-100 pt-2 text-[10px] font-medium text-stone-400">Point click: one marker · Plot click: all markers shown here</p>
          </div>
        )}
        {copyStatus && <div role="status" className={`pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow-lg ${copyStatus.error ? 'bg-red-700' : 'bg-stone-900'}`}>{copyStatus.message}</div>}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {model.series.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-2 text-xs font-medium text-stone-600">
            <span className="h-0.5 w-5 rounded-full" style={{ backgroundColor: item.color }} />
            {item.marker.name} <span className="text-stone-400">{item.marker.unit || 'no unit'}</span>
          </span>
        ))}
      </div>

      <details className="mt-4 rounded-xl border border-stone-200 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-teal-800">Chart data · {visibleRows.length} results · {timestampKey(model.minDate)} to {timestampKey(model.maxDate)}</summary>
        <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Chart data table">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Selected markers in the exact inclusive chart period. Text and limit results are listed but not plotted.</caption>
            <thead><tr>{['Date', 'Marker', 'Result', 'Unit', 'Lab', 'Method', 'Reference range'].map((label) => <th key={label} scope="col" className="whitespace-nowrap p-2">{label}</th>)}</tr></thead>
            <tbody>{visibleRows.map((record) => <tr key={record.id} className="border-t border-stone-200">{[record.measuredOn, record.marker, resultLabel(record), record.unit || 'Not supplied', record.lab || 'Not supplied', record.method || 'Not supplied', record.referenceRange || 'Not supplied'].map((value, i) => <td key={i} className="whitespace-nowrap p-2">{value}</td>)}</tr>)}</tbody>
          </table>
          {!visibleRows.length && <p className="p-3 text-stone-600">No results in this timeframe.</p>}
        </div>
      </details>
      <div className="mt-4 border-t border-stone-200 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-stone-400">Life events</span>
          {lifeEvents.map((lifeEvent) => {
            const colors = eventColors(lifeEvent.colorIndex)
            const highlighted = highlightedEventId === lifeEvent.id
            const dimmed = highlightedEventId !== null && !highlighted
            return <button
              key={lifeEvent.id}
              type="button"
              aria-label={`Edit life event: ${lifeEvent.title}`}
              onMouseEnter={() => setHighlightedEventId(lifeEvent.id)}
              onMouseLeave={() => setHighlightedEventId(null)}
              onFocus={() => setHighlightedEventId(lifeEvent.id)}
              onBlur={() => setHighlightedEventId(null)}
              onClick={() => onEditLifeEvent?.(lifeEvent)}
              className="rounded-full border px-2.5 py-1 text-xs font-semibold transition-[color,background-color,box-shadow,opacity,transform,filter] duration-150"
              style={{
                backgroundColor: colors.label,
                borderColor: colors.stroke,
                color: '#292524',
                opacity: dimmed ? 0.42 : 1,
                boxShadow: highlighted ? `0 0 0 3px ${colors.label}` : 'none',
                filter: highlighted ? 'brightness(1.08) saturate(1.08)' : 'none',
                transform: highlighted ? 'translateY(-1px)' : 'none',
              }}
            >{lifeEvent.title}</button>
          })}
          {!lifeEvents.length && <span className="text-xs text-stone-400">Use the Life event button above to add one.</span>}
        </div>
      </div>
    </div>
  )
}
