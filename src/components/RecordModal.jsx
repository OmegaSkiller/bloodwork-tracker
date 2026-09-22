import Modal from './ui/Modal.jsx'
import { useEffect, useMemo, useState } from 'react'
import { Icon } from './Icons.jsx'
import DatePickerField from './DatePickerField.jsx'
import { dateValue } from './ui/date-utils.js'

const emptyRecord = { markerId: '', measuredOn: '', value: '', unit: '', lab: '', notes: '', referenceRange: '', method: '' }

export default function RecordModal({ open, editing, initial, profileId, categories, markers, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(emptyRecord)
  const [creatingMarker, setCreatingMarker] = useState(false)
  const [markerForm, setMarkerForm] = useState({ categoryId: '', name: '', unit: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setForm(editing ? {
      markerId: String(editing.markerId),
      measuredOn: editing.measuredOn,
      value: editing.rawValue ?? editing.valueNumeric ?? editing.valueText ?? '',
      unit: editing.unit || '', referenceRange: editing.referenceRange || '', method: editing.method || '',
      lab: editing.lab || '',
      notes: editing.notes || '',
    } : {
      ...emptyRecord,
      markerId: initial?.markerId ? String(initial.markerId) : '',
      measuredOn: initial?.measuredOn || dateValue(new Date()),
      lab: initial?.lab || '',
      unit: markers.find((marker) => marker.id === initial?.markerId)?.unit || '',
    })
    setCreatingMarker(false)
    setMarkerForm({ categoryId: String(categories[0]?.id || ''), name: '', unit: '' })
    setError('')
  }, [open, editing, initial, categories])

  const groupedMarkers = useMemo(() => categories.map((category) => ({
    category,
    markers: markers.filter((marker) => marker.categoryId === category.id),
  })).filter((group) => group.markers.length), [categories, markers])

  if (!open) return null

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (!form.measuredOn) throw new Error('Choose a result date.')
      await onSave({ ...form, profileId, ...(creatingMarker ? { unit: markerForm.unit, newMarker: markerForm } : {}) })
      onClose()
    } catch (caught) {
      setError(caught.message)
    } finally {
      setSaving(false)
    }
  }

  const fieldClass = 'mt-1.5 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 shadow-sm outline-none transition placeholder:text-stone-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10'

  return (
    <Modal onClose={onClose} className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="record-title" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="max-h-[95vh] w-full overflow-y-auto rounded-t-3xl bg-stone-50 shadow-2xl sm:max-w-2xl sm:rounded-3xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-stone-50/95 px-5 py-4 backdrop-blur sm:px-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Database record</p>
            <h2 id="record-title" className="mt-0.5 text-xl font-bold tracking-tight text-stone-900">{editing ? 'Edit result' : 'Add a result'}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-stone-500 transition hover:bg-stone-200 hover:text-stone-900" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-5 p-5 sm:p-7">
          <div>
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm font-semibold text-stone-700" htmlFor="marker">Marker</label>
              {!editing && (
                <button type="button" onClick={() => setCreatingMarker((value) => !value)} className="text-xs font-semibold text-teal-700 hover:text-teal-900">
                  {creatingMarker ? 'Choose existing' : '+ Create marker'}
                </button>
              )}
            </div>

            {creatingMarker ? (
              <div className="mt-2 grid gap-3 rounded-2xl border border-teal-200 bg-teal-50/70 p-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-stone-700">
                  Category
                  <select required className={fieldClass} value={markerForm.categoryId} onChange={(event) => setMarkerForm({ ...markerForm, categoryId: event.target.value })}>
                    {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium text-stone-700">
                  Marker name
                  <input required className={fieldClass} value={markerForm.name} onChange={(event) => setMarkerForm({ ...markerForm, name: event.target.value })} placeholder="e.g. Fasting insulin" />
                </label>
                <label className="text-sm font-medium text-stone-700 sm:col-span-2">
                  Unit
                  <input className={fieldClass} value={markerForm.unit} onChange={(event) => setMarkerForm({ ...markerForm, unit: event.target.value })} placeholder="e.g. mIU/L" />
                </label>
              </div>
            ) : (
              <select id="marker" required className={fieldClass} value={form.markerId} onChange={(event) => setForm({ ...form, markerId: event.target.value, unit: markers.find((marker) => marker.id === Number(event.target.value))?.unit || '' })}>
                <option value="">Select a marker</option>
                {groupedMarkers.map(({ category, markers: groupMarkers }) => (
                  <optgroup key={category.id} label={category.name}>
                    {groupMarkers.map((marker) => <option key={marker.id} value={marker.id}>{marker.name} · {marker.unit || 'no unit'}</option>)}
                  </optgroup>
                ))}
              </select>
            )}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="text-sm font-semibold text-stone-700">
              Date
              <DatePickerField label="Result date" required value={form.measuredOn} placeholder="Choose result date" onChange={(measuredOn) => setForm((current) => ({ ...current, measuredOn }))} />
            </div>
            <label className="text-sm font-semibold text-stone-700">
              Result
              <input required className={fieldClass} value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} placeholder="Number or text result" />
            </label>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="text-sm font-semibold text-stone-700">Reported unit
              <input className={fieldClass} disabled={creatingMarker} value={creatingMarker ? markerForm.unit : form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} />
            </label>
            <label className="text-sm font-semibold text-stone-700">Reference range · optional
              <input className={fieldClass} value={form.referenceRange} onChange={(event) => setForm({ ...form, referenceRange: event.target.value })} placeholder="Copy from this report; no default range" />
            </label>
          </div>
          <label className="block text-sm font-semibold text-stone-700">Method · optional
            <input className={fieldClass} value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })} placeholder="Assay or method from this report" />
          </label>
          <p className="text-xs text-stone-600">Units are preserved as entered. Different units, labs, methods, or ranges are not joined into one trend line. Missing method or lab means points only.</p>

          <label className="block text-sm font-semibold text-stone-700">
            Lab
            <input className={fieldClass} value={form.lab} onChange={(event) => setForm({ ...form, lab: event.target.value })} placeholder="Laboratory name" />
          </label>

          <label className="block text-sm font-semibold text-stone-700">
            Notes <span className="font-normal text-stone-400">optional</span>
            <textarea rows="3" className={`${fieldClass} resize-none`} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Fasting state, medication changes, or context" />
          </label>

          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}

          <div className="flex flex-col-reverse gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:items-center sm:justify-end">
            {editing && (
              <button type="button" onClick={() => onDelete(editing)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 sm:mr-auto">Delete result</button>
            )}
            <button type="button" onClick={onClose} className="rounded-xl border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-100">Cancel</button>
            <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-wait disabled:opacity-60">
              <Icon name="plus" className="size-4" />
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add result'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
