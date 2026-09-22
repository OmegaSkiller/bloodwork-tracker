import { dateValue } from './components/ui/date-utils.js'
import { resultLabel } from '../shared/results.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { Icon } from './components/Icons.jsx'
import AIChatPanel from './components/AIChatPanel.jsx'
import LifeEventModal from './components/LifeEventModal.jsx'
import ProfileModal from './components/ProfileModal.jsx'
import RecordModal from './components/RecordModal.jsx'
import TrendChart from './components/TrendChart.jsx'
import UserManagementModal from './components/UserManagementModal.jsx'

const fullDate = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const compactDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

function formatDate(date) {
  return fullDate.format(new Date(`${date}T00:00:00Z`))
}

function chooseInitialMarkers(markers, records) {
  const count = new Map()
  records.forEach((record) => {
    if (record.valueNumeric !== null) count.set(record.markerId, (count.get(record.markerId) || 0) + 1)
  })
  const wanted = [
    ['Hormones', 'total testosterone'],
    ['Liver', 'alt'],
    ['Glycemic', 'glucose'],
    ['Lipids', 'ldl cholesterol'],
  ]
  const selected = wanted.map(([category, fragment]) => markers.find((marker) => marker.category === category && marker.name.toLowerCase().includes(fragment) && count.get(marker.id) >= 2)).filter(Boolean)
  const fallback = [...markers].filter((marker) => count.get(marker.id) >= 2).sort((a, b) => (count.get(b.id) || 0) - (count.get(a.id) || 0))
  return [...new Map([...selected, ...fallback].map((marker) => [marker.id, marker])).values()].slice(0, 4).map((marker) => marker.id)
}

function StatCard({ label, value, detail, icon }) {
  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-stone-500">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-stone-900">{value}</p>
          <p className="mt-1 text-xs text-stone-400">{detail}</p>
        </div>
        <span className="grid size-10 place-items-center rounded-xl bg-teal-50 text-teal-700"><Icon name={icon} /></span>
      </div>
    </article>
  )
}

export default function App({ username, role, onLogout }) {
  const profileRequest = useRef(0)
  const [data, setData] = useState({ profiles: [], activeProfileId: null, categories: [], markers: [], records: [], lifeEvents: [] })
  const [loading, setLoading] = useState(true)
  const [switchingProfile, setSwitchingProfile] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [chartCategory, setChartCategory] = useState('all')
  const [markerSearch, setMarkerSearch] = useState('')
  const [resultSearch, setResultSearch] = useState('')
  const [resultCategory, setResultCategory] = useState('all')
  const [modal, setModal] = useState({ open: false, editing: null, initial: null })
  const [lifeEventModal, setLifeEventModal] = useState({ open: false, editing: null, initialDate: '' })
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [userManagementOpen, setUserManagementOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [chartDateRange, setChartDateRange] = useState(null)
  const [toast, setToast] = useState('')

  const handleChartRangeChange = useCallback((range) => {
    setChartDateRange((current) => current?.start === range.start && current?.end === range.end && current?.preset === range.preset ? current : range)
  }, [])

  async function loadProfile(profileId, initial = false) {
    const requestId = ++profileRequest.current
    if (!initial) setSwitchingProfile(true)
    setAiOpen(false)
    setModal({ open: false, editing: null, initial: null })
    setLifeEventModal({ open: false, editing: null, initialDate: '' })
    try {
      const payload = await api.bootstrap(profileId)
      if (requestId !== profileRequest.current) return
      setData(payload)
      setChartDateRange(null)
      setSelectedIds(chooseInitialMarkers(payload.markers, payload.records))
      setChartCategory('all')
      setMarkerSearch('')
      setResultCategory('all')
      setResultSearch('')
      setLoadError('')
    } catch (error) {
      if (requestId !== profileRequest.current) return
      setLoadError(error.message)
    } finally {
      if (requestId === profileRequest.current) {
        setLoading(false)
        setSwitchingProfile(false)
      }
    }
  }

  useEffect(() => { loadProfile(null, true) }, [])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 3000)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const activeProfile = data.profiles.find((profile) => profile.id === data.activeProfileId)
  const latestDate = data.records.reduce((latest, record) => record.measuredOn > latest ? record.measuredOn : latest, '')
  const earliestDate = data.records.reduce((earliest, record) => !earliest || record.measuredOn < earliest ? record.measuredOn : earliest, '')
  const labs = new Set(data.records.map((record) => record.lab).filter(Boolean))

  const availableMarkers = useMemo(() => data.markers.filter((marker) => {
    const matchesCategory = chartCategory === 'all' || marker.categoryId === Number(chartCategory)
    const query = markerSearch.trim().toLowerCase()
    return matchesCategory && (!query || marker.name.toLowerCase().includes(query) || marker.unit.toLowerCase().includes(query))
  }), [data.markers, chartCategory, markerSearch])

  const resultDates = useMemo(() => [...new Set(data.records.map((record) => record.measuredOn))].sort(), [data.records])
  const labsByDate = useMemo(() => new Map(resultDates.map((date) => {
    const labs = [...new Set(data.records.filter((record) => record.measuredOn === date && record.lab).map((record) => record.lab))]
    return [date, labs.length > 1 ? 'Multiple labs' : labs[0] || '']
  })), [data.records, resultDates])
  const recordsByCell = useMemo(() => new Map(data.records.map((record) => [`${record.markerId}|${record.measuredOn}`, record])), [data.records])
  const gridMarkers = useMemo(() => data.markers.filter((marker) => {
    const matchesCategory = resultCategory === 'all' || marker.categoryId === Number(resultCategory)
    const query = resultSearch.trim().toLowerCase()
    return matchesCategory && (!query || marker.name.toLowerCase().includes(query) || marker.unit.toLowerCase().includes(query))
  }), [data.markers, resultCategory, resultSearch])

  function toggleMarker(id) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 6 ? [...current, id] : current)
  }

  async function changeProfile(profileId) {
    if (Number(profileId) === data.activeProfileId) return
    await loadProfile(Number(profileId))
  }

  async function createProfile(name) {
    const profile = await api.addProfile({ name, cloneFromProfileId: data.activeProfileId })
    await loadProfile(profile.id)
    setToast(`${profile.name} profile created`)
  }

  async function saveRecord(record) {
    if (modal.editing) {
      const updated = await api.updateRecord(modal.editing.id, record)
      setData((current) => ({ ...current, records: current.records.map((item) => item.id === updated.id ? updated : item) }))
      setToast('Result updated')
    } else {
      const created = await api.addRecord(record)
      setData((current) => ({
        ...current, records: [...current.records, created],
        markers: current.markers.some((marker) => marker.id === created.markerId) ? current.markers : [...current.markers, { id: created.markerId, name: created.marker, unit: created.unit, categoryId: created.categoryId, category: created.category }],
      }))
      setToast('Result added')
    }
  }

  async function deleteRecord(record) {
    if (!window.confirm(`Delete ${record.marker} from ${formatDate(record.measuredOn)}?`)) return false
    try {
      await api.deleteRecord(record.id, data.activeProfileId)
      setData((current) => ({ ...current, records: current.records.filter((item) => item.id !== record.id) }))
      setToast('Result deleted')
      return true
    } catch (error) {
      setToast(error.message)
      return false
    }
  }

  async function saveLifeEvent(lifeEvent) {
    if (lifeEventModal.editing) {
      const updated = await api.updateLifeEvent(lifeEventModal.editing.id, lifeEvent)
      setData((current) => ({ ...current, lifeEvents: current.lifeEvents.map((item) => item.id === updated.id ? updated : item) }))
      setToast('Life event updated')
    } else {
      const created = await api.addLifeEvent(lifeEvent)
      setData((current) => ({ ...current, lifeEvents: [...current.lifeEvents, created].sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.id - b.id) }))
      setToast('Life event added')
    }
  }

  async function deleteLifeEvent(lifeEvent) {
    if (!window.confirm(`Delete life event “${lifeEvent.title}”?`)) return false
    try {
      await api.deleteLifeEvent(lifeEvent.id, data.activeProfileId)
      setData((current) => ({ ...current, lifeEvents: current.lifeEvents.filter((item) => item.id !== lifeEvent.id) }))
      setLifeEventModal({ open: false, editing: null, initialDate: '' })
      setToast('Life event deleted')
      return true
    } catch (error) {
      setToast(error.message)
      return false
    }
  }

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-stone-100"><p className="animate-pulse font-semibold text-stone-500">Loading your bloodwork…</p></div>
  }

  if (loadError) {
    return (
      <div className="grid min-h-screen place-items-center bg-stone-100 p-6">
        <div className="max-w-lg rounded-2xl border border-red-200 bg-white p-7 text-center shadow-sm">
          <h1 className="text-xl font-bold text-stone-900">Could not open the local database</h1>
          <p role="alert" className="mt-2 text-sm text-red-700">{loadError}</p><button onClick={() => loadProfile(null, true)} className="mt-4 rounded-xl bg-teal-800 px-4 py-2 text-white">Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f7f8f5]">
      <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-[#f7f8f5]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <a href="#top" aria-label="Bloodwork home" className="flex shrink-0 items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-teal-800 text-white shadow-sm"><Icon name="chart" /></span>
            <span className="hidden sm:block"><strong className="block text-sm font-bold tracking-tight text-stone-900">Bloodwork</strong><span className="block text-[11px] font-medium text-stone-400">Private tracking · local data</span></span>
          </a>
          <nav className="hidden items-center gap-1 rounded-xl border border-stone-200 bg-white p-1 text-sm font-medium text-stone-500 shadow-sm lg:flex">
            <a href="#trends" className="rounded-lg px-3.5 py-2 transition hover:bg-stone-100 hover:text-stone-900">Trends</a>
            <a href="#results" className="rounded-lg px-3.5 py-2 transition hover:bg-stone-100 hover:text-stone-900">Results</a>
            <button onClick={() => setAiOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 transition hover:bg-teal-50 hover:text-teal-800"><Icon name="sparkles" className="size-4" />AI insights</button>
          </nav>
          <div className="flex flex-wrap min-w-0 items-center gap-2">
            <div className="flex min-w-0 items-center rounded-xl border border-stone-200 bg-white shadow-sm">
              <select aria-label="Active profile" disabled={switchingProfile} value={data.activeProfileId || ''} onChange={(event) => changeProfile(event.target.value)} className="min-w-0 max-w-36 rounded-l-xl bg-transparent px-3 py-2.5 text-sm font-semibold text-stone-700 outline-none sm:max-w-48">
                {data.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
              <button onClick={() => setProfileModalOpen(true)} className="grid size-10 shrink-0 place-items-center border-l border-stone-200 text-stone-500 transition hover:bg-teal-50 hover:text-teal-800" aria-label="Add profile"><Icon name="plus" className="size-4" /></button>
            </div>
            <button onClick={() => setAiOpen(true)} aria-label="Ask AI" disabled={!activeProfile || switchingProfile} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2.5 text-sm font-semibold text-teal-800 transition hover:border-teal-300 hover:bg-teal-100 sm:px-3.5"><Icon name="sparkles" className="size-4" /><span className="hidden xl:inline">Ask AI</span></button>
            <button disabled={!activeProfile || switchingProfile} aria-label="Add result" onClick={() => setModal({ open: true, editing: null, initial: null })} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-teal-800 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-900 sm:px-4"><Icon name="plus" className="size-4" /><span className="hidden sm:inline">Add result</span></button>
            {role === 'admin' && <button onClick={() => setUserManagementOpen(true)} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-semibold text-stone-600 shadow-sm transition hover:border-teal-200 hover:bg-teal-50 hover:text-teal-800" aria-label="Manage users" title="Manage users"><Icon name="users" className="size-4" /><span className="hidden 2xl:inline">Users</span></button>}
            <button onClick={onLogout} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-semibold text-stone-600 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-700" aria-label="Log out" title={`Signed in as ${username}`}><Icon name="logout" className="size-4" /><span className="hidden 2xl:inline">Log out</span></button>
          </div>
        </div>
      </header>

      <main id="top" className={`mx-auto max-w-[1500px] px-4 pb-16 pt-8 transition-opacity sm:px-6 lg:px-8 ${switchingProfile ? 'pointer-events-none opacity-45' : ''}`}>
        <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800"><span className="size-1.5 rounded-full bg-teal-600" />{activeProfile?.name || 'Profile'} · isolated results</span>
            <h1 className="mt-4 max-w-3xl text-3xl font-bold tracking-[-0.035em] text-stone-950 sm:text-4xl">Your markers, clearly tracked over time.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500 sm:text-base">Explore lab history with original units and report-specific ranges. Track observations over time without treating the chart as a diagnosis.</p>
          </div>
          {latestDate ? (
            <div className="rounded-2xl border border-stone-200 bg-white px-5 py-3 text-sm shadow-sm"><span className="text-stone-400">Latest collection</span><strong className="ml-2 text-stone-800">{formatDate(latestDate)}</strong></div>
          ) : (
            <button onClick={() => setModal({ open: true, editing: null, initial: null })} className="rounded-2xl border border-dashed border-teal-300 bg-teal-50 px-5 py-3 text-sm font-semibold text-teal-800">Add the first result</button>
          )}
        </section>

        {!activeProfile && <div className="mt-5 rounded-xl bg-teal-50 p-5"><p>Create your first profile to start tracking.</p><button onClick={() => setProfileModalOpen(true)} className="mt-2 font-semibold text-teal-800">Create profile</button></div>}
        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Markers" value={data.markers.length.toLocaleString()} detail={`${data.categories.length} clinical categories`} icon="chart" />
          <StatCard label="Results" value={data.records.length.toLocaleString()} detail="Numeric and text values" icon="database" />
          <StatCard label="Laboratories" value={labs.size.toLocaleString()} detail="Only in this profile" icon="table" />
          <StatCard label="Timeline" value={earliestDate && latestDate ? `${new Date(`${latestDate}T00:00:00Z`).getUTCFullYear() - new Date(`${earliestDate}T00:00:00Z`).getUTCFullYear() || '<1'} yr` : '—'} detail={earliestDate ? `${compactDate.format(new Date(`${earliestDate}T00:00:00Z`))} – ${compactDate.format(new Date(`${latestDate}T00:00:00Z`))}` : 'No dated results yet'} icon="chart" />
        </section>

        <section id="trends" className="mt-8 scroll-mt-24 rounded-3xl border border-stone-200 bg-white shadow-[0_1px_3px_rgba(28,25,23,0.05)]">
          <div className="border-b border-stone-200 p-5 sm:p-7">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
              <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Marker trends</p><h2 className="mt-1 text-2xl font-bold tracking-tight text-stone-900">Interactive timeline</h2><p className="mt-1 text-sm text-stone-500">Click a point to copy that marker, or click elsewhere in the plot to copy all visible markers at the nearest date.</p></div>
              <div className="flex flex-wrap gap-2"><button onClick={() => setLifeEventModal({ open: true, editing: null, initialDate: latestDate || dateValue(new Date()) })} className="rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-100"><span className="mr-1">+</span> Life event</button><button onClick={() => setSelectedIds(chooseInitialMarkers(data.markers, data.records))} className="rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-xs font-semibold text-stone-600 transition hover:bg-stone-100">Key markers</button><button onClick={() => setSelectedIds([])} className="rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-xs font-semibold text-stone-600 transition hover:bg-stone-100">Clear</button></div>
            </div>
          </div>

          <div className="grid lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="border-b border-stone-200 p-5 lg:border-b-0 lg:border-r sm:p-6">
              <label className="relative block"><span className="sr-only">Search markers</span><Icon name="search" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" /><input value={markerSearch} onChange={(event) => setMarkerSearch(event.target.value)} placeholder="Search markers" className="w-full rounded-xl border border-stone-200 bg-stone-50 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-600/10" /></label>
              <select aria-label="Chart category" value={chartCategory} onChange={(event) => setChartCategory(event.target.value)} className="mt-3 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-700 outline-none focus:border-teal-600"><option value="all">All categories</option>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
              <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1 lg:max-h-[370px]">
                {availableMarkers.map((marker) => {
                  const active = selectedIds.includes(marker.id)
                  return <button key={marker.id} aria-pressed={active} onClick={() => toggleMarker(marker.id)} disabled={!active && selectedIds.length >= 6} className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${active ? 'bg-teal-50 text-teal-900' : 'text-stone-600 hover:bg-stone-100 disabled:opacity-40'}`}><span className="min-w-0"><span className="block truncate font-medium">{marker.name}</span><span className="block truncate text-[11px] text-stone-400">{marker.category}</span></span><span className={`size-4 shrink-0 rounded border ${active ? 'border-teal-700 bg-teal-700 shadow-[inset_0_0_0_3px_white]' : 'border-stone-300 bg-white'}`} /></button>
                })}
              </div>
            </aside>
            <div className="min-w-0 p-5 sm:p-7">
              <TrendChart key={data.activeProfileId} markers={data.markers} records={data.records} selectedIds={selectedIds} lifeEvents={data.lifeEvents} onRangeChange={handleChartRangeChange} onEditLifeEvent={(editing) => setLifeEventModal({ open: true, editing, initialDate: '' })} />
            </div>
          </div>
        </section>

        <section id="results" className="mt-8 scroll-mt-24 overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-[0_1px_3px_rgba(28,25,23,0.05)]">
          <div className="flex flex-col justify-between gap-4 border-b border-stone-200 p-5 sm:p-7 lg:flex-row lg:items-end">
            <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Results timeline</p><h2 className="mt-1 text-2xl font-bold tracking-tight text-stone-900">Spreadsheet view</h2><p className="mt-1 text-sm text-stone-500">Rows are markers and columns are collection dates. Select any cell to add or edit its value.</p></div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="relative block sm:w-56"><span className="sr-only">Search result markers</span><Icon name="search" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" /><input value={resultSearch} onChange={(event) => setResultSearch(event.target.value)} placeholder="Search result markers" className="w-full rounded-xl border border-stone-200 bg-stone-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-600/10" /></label>
              <select aria-label="Results category" value={resultCategory} onChange={(event) => setResultCategory(event.target.value)} className="rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-700 outline-none focus:border-teal-600"><option value="all">All categories</option>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
              <button onClick={() => setModal({ open: true, editing: null, initial: null })} className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-900"><Icon name="plus" className="size-4" /> Add result</button>
            </div>
          </div>

          <div className="relative max-h-[720px] overflow-auto" tabIndex={0} role="region" aria-label="Results spreadsheet">
            <table className="results-table min-w-max border-separate border-spacing-0 text-sm">
              <caption className="sr-only">All profile results. Blank cells are missing measurements, not zero.</caption>
              <thead><tr>
                <th className="sticky left-0 top-0 z-30 min-w-40 border-b border-r border-stone-200 bg-stone-100 px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-stone-500 sm:min-w-56">Marker</th>
                <th className="sticky left-56 top-0 z-30 hidden min-w-24 border-b border-r border-stone-200 bg-stone-100 px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-stone-500 sm:table-cell">Unit</th>
                {resultDates.map((date) => <th key={date} className="sticky top-0 z-20 min-w-36 border-b border-r border-stone-200 bg-stone-100 px-4 py-3 text-center"><span className="block whitespace-nowrap text-xs font-bold text-stone-700">{compactDate.format(new Date(`${date}T00:00:00Z`))}</span><span className="mt-0.5 block max-w-28 truncate text-[10px] font-medium text-stone-400" title={labsByDate.get(date) || ''}>{labsByDate.get(date) || 'No lab'}</span></th>)}
              </tr></thead>
              <tbody>
                {gridMarkers.map((marker) => <tr key={marker.id} className="group">
                  <th className="sticky left-0 z-10 border-b border-r border-stone-200 bg-white px-5 py-3 text-left group-hover:bg-teal-50/60"><span className="block max-w-28 truncate font-semibold text-stone-900 sm:max-w-44" title={marker.name}>{marker.name}</span><span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-stone-400">{marker.category}</span></th>
                  <td className="sticky left-56 z-10 hidden border-b border-r border-stone-200 bg-white px-4 py-3 text-xs font-medium text-stone-500 group-hover:bg-teal-50/60 sm:table-cell">{marker.unit || '—'}</td>
                  {resultDates.map((date) => {
                    const record = recordsByCell.get(`${marker.id}|${date}`)
                    return <td key={date} className="border-b border-r border-stone-200 bg-white p-0 text-center group-hover:bg-stone-50"><button onClick={() => setModal(record ? { open: true, editing: record, initial: null } : { open: true, editing: null, initial: { markerId: marker.id, measuredOn: date, lab: '' } })} className={`min-h-14 w-full min-w-36 px-3 py-2 text-sm transition focus:relative focus:z-10 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-600 ${record ? 'font-semibold text-stone-800 hover:bg-teal-50 hover:text-teal-900' : 'text-stone-200 hover:bg-teal-50 hover:text-teal-700'}`} title={record ? [record.lab, record.method, record.referenceRange, record.notes].filter(Boolean).join(' · ') : `Add ${marker.name} on ${formatDate(date)}`} aria-label={record ? `Edit ${marker.name} on ${formatDate(date)}: ${resultLabel(record)} ${record.unit}. Lab: ${record.lab || 'not supplied'}. Reference: ${record.referenceRange || 'not supplied'}` : `Add ${marker.name} on ${formatDate(date)}`}>{record ? <><span>{resultLabel(record)}</span><span className={`block text-xs text-stone-600 ${record.unit === marker.unit ? 'sm:hidden' : ''}`}>{record.unit || 'No unit'}</span></> : <span className="text-stone-500">—<span className="sr-only"> Missing result; add</span></span>}</button></td>
                  })}
                </tr>)}
                {!gridMarkers.length && <tr><td colSpan={Math.max(2 + resultDates.length, 3)} className="px-6 py-16 text-center text-stone-400">No markers match this filter.</td></tr>}
              </tbody>
            </table>
            {!resultDates.length && <div className="border-t border-stone-200 px-6 py-14 text-center"><p className="font-semibold text-stone-700">No collection dates in this profile yet</p><button onClick={() => setModal({ open: true, editing: null, initial: null })} className="mt-2 text-sm font-semibold text-teal-700 hover:text-teal-900">Add the first result →</button></div>}
          </div>
          <div className="flex flex-col justify-between gap-2 border-t border-stone-200 bg-stone-50 px-5 py-3 text-xs text-stone-500 sm:flex-row sm:px-7"><span>{gridMarkers.length} markers · {resultDates.length} collection dates</span><span>Scroll sideways to compare dates; each value retains its reported unit.</span></div>
        </section>

        <footer className="mt-8 flex flex-col justify-between gap-2 border-t border-stone-200 pt-6 text-xs text-stone-400 sm:flex-row"><p>Self-hosted tracking. Members see their own profiles; administrators can access all profiles.</p><p>Tracking is not diagnosis. Optional external AI may be wrong.</p></footer>
      </main>

      <RecordModal open={modal.open} editing={modal.editing} initial={modal.initial} profileId={data.activeProfileId} categories={data.categories} markers={data.markers} onClose={() => setModal({ open: false, editing: null, initial: null })} onSave={saveRecord} onDelete={async (record) => { const deleted = await deleteRecord(record); if (deleted) setModal({ open: false, editing: null, initial: null }) }} />
      <LifeEventModal open={lifeEventModal.open} editing={lifeEventModal.editing} initialDate={lifeEventModal.initialDate} profileId={data.activeProfileId} onClose={() => setLifeEventModal({ open: false, editing: null, initialDate: '' })} onSave={saveLifeEvent} onDelete={deleteLifeEvent} />
      <ProfileModal open={profileModalOpen} onClose={() => setProfileModalOpen(false)} onCreate={createProfile} />
      {role === 'admin' && <UserManagementModal open={userManagementOpen} onClose={() => setUserManagementOpen(false)} onNotice={setToast} />}
      <AIChatPanel key={data.activeProfileId} open={aiOpen} onClose={() => setAiOpen(false)} profile={activeProfile} markers={data.markers} records={data.records} lifeEvents={data.lifeEvents} initialMarkerIds={selectedIds} dateRange={chartDateRange} isAdmin={role === 'admin'} />
      {toast && <div role="status" className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white shadow-xl">{toast}</div>}
    </div>
  )
}
