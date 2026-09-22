import Modal from './ui/Modal.jsx'
import { useEffect, useState } from 'react'
import { Icon } from './Icons.jsx'
import DatePickerField from './DatePickerField.jsx'

const emptyEvent = { title: '', startsOn: '', endsOn: '', notes: '', substances: '' }

export default function LifeEventModal({ open, editing, initialDate, profileId, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(emptyEvent)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setForm(editing ? {
      title: editing.title,
      startsOn: editing.startsOn,
      endsOn: editing.endsOn || '',
      notes: editing.notes || '',
      substances: editing.substances || '',
    } : {
      ...emptyEvent,
      startsOn: initialDate || new Date().toISOString().slice(0, 10),
    })
    setError('')
  }, [open, editing, initialDate])

  if (!open) return null

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (!form.startsOn) throw new Error('Choose a start date.')
      await onSave({ ...form, profileId })
      onClose()
    } catch (caught) {
      setError(caught.message)
    } finally {
      setSaving(false)
    }
  }

  const fieldClass = 'mt-1.5 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 shadow-sm outline-none transition placeholder:text-stone-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10'

  return (
    <Modal onClose={onClose} className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="life-event-title" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="max-h-[95vh] overflow-y-auto w-full rounded-t-3xl bg-stone-50 shadow-2xl sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4 sm:px-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">Timeline context</p>
            <h2 id="life-event-title" className="mt-0.5 text-xl font-bold tracking-tight text-stone-900">{editing ? 'Edit life event' : 'Add life event'}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-stone-500 transition hover:bg-stone-200 hover:text-stone-900" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-5 p-5 sm:p-7">
          <label className="block text-sm font-semibold text-stone-700">
            Title
            <input autoFocus required maxLength="120" className={fieldClass} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Started strength training" />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="block text-sm font-semibold text-stone-700">
              Start date
              <DatePickerField label="Start date" required value={form.startsOn} placeholder="Choose start date" onChange={(startsOn) => setForm((current) => ({ ...current, startsOn, endsOn: current.endsOn && current.endsOn < startsOn ? '' : current.endsOn }))} />
            </div>
            <div className="block text-sm font-semibold text-stone-700">
              End date <span className="font-normal text-stone-400">· optional</span>
              <DatePickerField label="End date" align="right" allowClear min={form.startsOn} value={form.endsOn} placeholder="No end date" onChange={(endsOn) => setForm((current) => ({ ...current, endsOn }))} />
            </div>
          </div>

          <p className="-mt-2 text-xs leading-5 text-stone-500">Leave the end date empty for a single-day event. A time frame is created only when both dates are present.</p>

          <label className="block text-sm font-semibold text-stone-700">
            Substances used <span className="font-normal text-stone-400">· optional</span>
            <textarea maxLength="3000" rows="2" className={fieldClass} value={form.substances} onChange={(event) => setForm({ ...form, substances: event.target.value })} placeholder="e.g. medication, supplement, dose, frequency" />
          </label>

          <label className="block text-sm font-semibold text-stone-700">
            Notes <span className="font-normal text-stone-400">· optional</span>
            <textarea maxLength="5000" rows="3" className={fieldClass} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Context, symptoms, routines, or anything else worth remembering" />
          </label>

          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}

          <div className="flex flex-col-reverse gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:items-center sm:justify-end">
            {editing && <button type="button" onClick={() => onDelete(editing)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 sm:mr-auto">Delete event</button>}
            <button type="button" onClick={onClose} className="rounded-xl border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-100">Cancel</button>
            <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-wait disabled:opacity-60">
              <Icon name={editing ? 'check' : 'plus'} className="size-4" />
              {saving ? 'Saving…' : editing ? 'Save event' : 'Add event'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
