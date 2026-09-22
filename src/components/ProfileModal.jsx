import Modal from './ui/Modal.jsx'
import { useEffect, useState } from 'react'
import { Icon } from './Icons.jsx'

export default function ProfileModal({ open, onClose, onCreate }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setName('')
    setError('')
  }, [open])

  if (!open) return null

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onCreate(name)
      onClose()
    } catch (caught) {
      setError(caught.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} className="fixed inset-0 z-50 grid place-items-center bg-stone-950/40 p-5 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="profile-title" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-3xl bg-stone-50 p-6 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Private workspace</p>
            <h2 id="profile-title" className="mt-1 text-2xl font-bold tracking-tight text-stone-900">Add a profile</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-stone-500 transition hover:bg-stone-200" aria-label="Close"><Icon name="close" /></button>
        </div>

        <p className="mt-3 text-sm leading-6 text-stone-500">The marker catalog will be copied for convenience, while every result remains isolated from other profiles.</p>

        <form onSubmit={submit} className="mt-6">
          <label className="text-sm font-semibold text-stone-700">
            Profile name
            <input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Maria" className="mt-1.5 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" />
          </label>
          {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
          <div className="mt-6 flex justify-end gap-3 border-t border-stone-200 pt-5">
            <button type="button" onClick={onClose} className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-100">Cancel</button>
            <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-60"><Icon name="plus" className="size-4" />{saving ? 'Creating…' : 'Create profile'}</button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
