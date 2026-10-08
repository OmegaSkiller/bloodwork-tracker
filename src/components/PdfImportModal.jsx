import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { Icon } from './Icons.jsx'
import DatePickerField from './DatePickerField.jsx'
import Modal from './ui/Modal.jsx'

const fieldClass = 'mt-1 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20'
const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

export default function PdfImportModal({ open, profile, onClose, onImported }) {
  const [file, setFile] = useState(null)
  const [consent, setConsent] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [jobId, setJobId] = useState('')
  const [patientName, setPatientName] = useState('')
  const [rows, setRows] = useState(null)
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const activeRun = useRef(0)

  useEffect(() => {
    if (!open) return
    setFile(null); setConsent(false); setConfirmed(false); setJobId('')
    setPatientName(''); setRows(null); setPlan(null); setBusy(''); setError('')
    return () => { activeRun.current += 1 }
  }, [open])

  function requestClose() {
    if (busy !== 'apply') onClose()
  }

  async function start(event) {
    event.preventDefault()
    setError('')
    if (!file || file.size < 8 || file.size > 10 * 1024 * 1024 || !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Choose a PDF under 10 MB.')
      return
    }
    if (!consent) { setError('Confirm the transfer to OpenAI first.'); return }
    const run = ++activeRun.current
    setBusy('extracting')
    try {
      const started = await api.startPdfImport(profile.id, file)
      if (run !== activeRun.current) return
      setJobId(started.jobId)
      let result
      for (let attempt = 0; attempt < 150; attempt += 1) {
        await wait(2000)
        if (run !== activeRun.current) return
        result = await api.getPdfImport(started.jobId)
        if (run !== activeRun.current) return
        if (result.status !== 'pending') break
      }
      if (result?.status !== 'ready') throw new Error('Extraction is still processing. Start again with a smaller report.')
      setPatientName(result.patientName)
      setRows(result.rows.map((row) => ({ ...row, selected: true })))
      if (!result.rows.length) setError('No clear results were found. Nothing was imported. Try another report or enter results manually.')
    } catch (caught) { if (run === activeRun.current) setError(caught.message) }
    finally { if (run === activeRun.current) setBusy('') }
  }

  function updateRow(sourceIndex, change) {
    setRows((current) => current.map((row) => row.sourceIndex === sourceIndex ? { ...row, ...change } : row))
    setPlan(null)
    setError('')
  }

  async function review(mode) {
    const run = ++activeRun.current
    setBusy(mode)
    setError('')
    try {
      const selected = rows.filter((row) => row.selected).map(({ selected: _selected, page: _page, ...row }) => row)
      const result = await api.reviewPdfImport(jobId, { mode, rows: selected, profileName: profile.name, confirmedProfile: confirmed })
      if (run !== activeRun.current) return
      if (mode === 'preview') setPlan(result)
      else await onImported(result)
    } catch (caught) { if (run === activeRun.current) { setError(caught.message); setPlan(null) } }
    finally { if (run === activeRun.current) setBusy('') }
  }

  if (!open) return null
  return (
    <Modal onClose={requestClose} className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" aria-labelledby="pdf-import-title">
      <div className="max-h-[95vh] w-full max-w-5xl overflow-y-auto rounded-t-3xl bg-stone-50 shadow-2xl sm:rounded-3xl">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-stone-200 bg-stone-50/95 px-5 py-4 backdrop-blur sm:px-7">
          <h2 id="pdf-import-title" className="text-xl font-bold text-stone-900">Import results from PDF</h2>
          <button type="button" onClick={requestClose} disabled={busy === 'apply'} aria-label="Close PDF import" className="rounded-full p-2 text-stone-600 hover:bg-stone-200 disabled:opacity-50"><Icon name="close" /></button>
        </header>
        <div className="space-y-5 p-5 sm:p-7">
          <p className="text-sm leading-6 text-stone-700">Target profile: <strong>{profile.name}</strong>. OpenAI reads the full PDF, including names and medical details. Extraction may be wrong. Check every value, unit, laboratory, and collection date against the original. The app does not save the PDF.</p>
          {!rows && <form onSubmit={start} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-4">
            <label className="block text-sm font-semibold text-stone-800">Laboratory PDF (up to 10 MB)<input type="file" accept="application/pdf,.pdf" required className={fieldClass} onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
            <label className="flex items-start gap-3 text-sm leading-6 text-stone-700"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 size-4 shrink-0 accent-teal-800" />I agree to send this PDF to OpenAI for extraction with the configured API key. Provider charges and data policies apply.</label>
            <button disabled={Boolean(busy) || !file || !consent} className="rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === 'extracting' ? 'Reading PDF…' : 'Extract for review'}</button>
          </form>}
          {rows && <>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <p><strong>Report patient:</strong> {patientName || 'Could not read a name'} · <strong>Extracted rows:</strong> {rows.length}</p>
              <p className="mt-1">Confirm the report belongs to this profile. Remove uncertain rows and correct missing or misread fields.</p>
            </div>
            <div className="space-y-4">{rows.map((row, index) => <fieldset key={row.sourceIndex} className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4">
              <legend className="px-1 text-sm font-bold text-stone-900">Result {index + 1}{row.page ? ` · page ${row.page}` : ''}</legend>
              <label className="flex items-center gap-2 text-sm font-medium text-stone-700"><input type="checkbox" checked={row.selected} onChange={(event) => updateRow(row.sourceIndex, { selected: event.target.checked })} className="size-4 accent-teal-800" />Include this result</label>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['category', 'Category'], ['marker', 'Marker'], ['value', 'Reported value'], ['unit', 'Unit'],
                  ['lab', 'Laboratory'], ['reference', 'Reference range'], ['method', 'Method'],
                ].map(([key, label]) => <label key={key} className="min-w-0 text-xs font-semibold text-stone-700">{label}
                  <input disabled={!row.selected || Boolean(busy)} type="text" value={row[key]} onChange={(event) => updateRow(row.sourceIndex, { [key]: event.target.value })} className={fieldClass} />
                </label>)}
                <div className="min-w-0 text-xs font-semibold text-stone-700">Collection date<DatePickerField label={`Collection date for result ${index + 1}`} value={row.date} placeholder="Choose collection date" disabled={!row.selected || Boolean(busy)} onChange={(date) => updateRow(row.sourceIndex, { date })} /></div>
              </div>
            </fieldset>)}</div>
            <label className="flex items-start gap-3 text-sm leading-6 text-stone-700"><input type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked); setPlan(null) }} className="mt-1 size-4 shrink-0 accent-teal-800" />I checked the original PDF and confirm these selected results belong to <strong>{profile.name}</strong>.</label>
            {plan && <p role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm font-semibold text-teal-950">Preview: {plan.added} new results, {plan.identical} already identical. Import adds only new results in one transaction after a private database backup.</p>}
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={Boolean(busy) || !confirmed || !rows.some((row) => row.selected)} onClick={() => review('preview')} className="rounded-xl border border-teal-700 px-4 py-2.5 text-sm font-semibold text-teal-800 disabled:opacity-50">{busy === 'preview' ? 'Checking…' : 'Preview import'}</button>
              <button type="button" disabled={Boolean(busy) || !plan || !confirmed} onClick={() => review('apply')} className="rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === 'apply' ? 'Importing…' : 'Import reviewed results'}</button>
            </div>
          </>}
          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        </div>
      </div>
    </Modal>
  )
}
