import Modal from './ui/Modal.jsx'
import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Icon } from './Icons.jsx'

const createdDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function formatCreatedAt(value) {
  const parsed = new Date(`${String(value || '').replace(' ', 'T').replace(/Z$/, '')}Z`)
  return Number.isNaN(parsed.valueOf()) ? '' : createdDate.format(parsed)
}

export default function UserManagementModal({ open, onClose, onNotice }) {
  const [users, setUsers] = useState([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordUserId, setPasswordUserId] = useState(null)
  const [replacementPassword, setReplacementPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [actionUserId, setActionUserId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError('')
    setUsername('')
    setPassword('')
    setPasswordUserId(null)
    setReplacementPassword('')
    api.listUsers()
      .then((result) => { if (active) setUsers(result) })
      .catch((caught) => { if (active) setError(caught.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open])

  if (!open) return null

  async function submit(event) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      const user = await api.addUser({ username, password })
      setUsers((current) => [...current, user].sort((a, b) => a.role === b.role ? a.username.localeCompare(b.username) : a.role === 'admin' ? -1 : 1))
      setUsername('')
      setPassword('')
      onNotice?.(`${user.username} can now sign in`)
    } catch (caught) {
      setError(caught.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function changePassword(event, user) {
    event.preventDefault()
    if (actionUserId || replacementPassword.length < 12) return
    setActionUserId(user.id)
    setError('')
    try {
      await api.changeUserPassword(user.id, replacementPassword)
      setPasswordUserId(null)
      setReplacementPassword('')
      onNotice?.(`${user.username}'s password was changed`)
    } catch (caught) {
      setError(caught.message)
    } finally {
      setActionUserId(null)
    }
  }

  async function removeUser(user) {
    if (actionUserId || !window.confirm(`Remove ${user.username}? They will be signed out immediately and will no longer be able to log in.`)) return
    setActionUserId(user.id)
    setError('')
    try {
      await api.deleteUser(user.id)
      setUsers((current) => current.filter((item) => item.id !== user.id))
      if (passwordUserId === user.id) {
        setPasswordUserId(null)
        setReplacementPassword('')
      }
      onNotice?.(`${user.username} was removed`)
    } catch (caught) {
      setError(caught.message)
    } finally {
      setActionUserId(null)
    }
  }

  return (
    <Modal onClose={onClose} className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-stone-950/35 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="user-management-title">
      <button className="absolute inset-0" onClick={onClose} aria-label="Close user management" />
      <section className="relative my-6 w-full max-w-2xl overflow-hidden rounded-3xl border border-stone-200 bg-[#f7f8f5] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-stone-200 bg-white px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">Administrator</p>
            <h2 id="user-management-title" className="mt-1 text-xl font-bold tracking-tight text-stone-900">User access</h2>
            <p className="mt-1 text-sm text-stone-500">Create credentials for people you trust. Public registration stays disabled.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid size-10 shrink-0 place-items-center rounded-xl text-stone-500 transition hover:bg-stone-100 hover:text-stone-900"><Icon name="close" /></button>
        </header>

        {error && <div role="alert" className="mx-5 mt-5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs leading-5 text-red-700 sm:mx-6">{error}</div>}

        <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
            <h3 className="text-sm font-bold text-stone-900">Registered users</h3>
            <p className="mt-1 text-xs leading-5 text-stone-500">Members can access only their own profiles. Administrators can access all profiles, create accounts, and reset or remove regular accounts.</p>
            <div className="mt-4 space-y-2">
              {loading && <p className="rounded-xl bg-stone-50 px-4 py-5 text-center text-sm text-stone-400">Loading users…</p>}
              {!loading && users.map((user) => (
                <div key={user.id} className="rounded-xl border border-stone-200 px-3.5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0"><p className="truncate text-sm font-semibold text-stone-900">{user.username}</p><p className="mt-0.5 text-[10px] text-stone-400">Created {formatCreatedAt(user.createdAt)}</p></div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${user.role === 'admin' ? 'bg-teal-50 text-teal-700' : 'bg-stone-100 text-stone-500'}`}>{user.role}</span>
                      {user.role !== 'admin' && <button type="button" disabled={Boolean(actionUserId)} onClick={() => { setPasswordUserId((current) => current === user.id ? null : user.id); setReplacementPassword(''); setError('') }} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-teal-700 transition hover:bg-teal-50 disabled:opacity-40">Password</button>}
                      {user.role !== 'admin' && <button type="button" disabled={Boolean(actionUserId)} onClick={() => removeUser(user)} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-40">Remove</button>}
                    </div>
                  </div>
                  {passwordUserId === user.id && <form onSubmit={(event) => changePassword(event, user)} className="mt-3 flex flex-col gap-2 border-t border-stone-100 pt-3 sm:flex-row">
                    <label className="min-w-0 flex-1"><span className="sr-only">New password for {user.username}</span><input type="password" autoFocus autoComplete="new-password" value={replacementPassword} onChange={(event) => setReplacementPassword(event.target.value)} minLength={12} maxLength={256} placeholder="New password · 12+ characters" className="block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-900 outline-none focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-600/10" /></label>
                    <button disabled={actionUserId === user.id || replacementPassword.length < 12} className="rounded-lg bg-teal-800 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-900 disabled:opacity-40">{actionUserId === user.id ? 'Saving…' : 'Save'}</button>
                  </form>}
                </div>
              ))}
              {!loading && !users.length && !error && <p className="rounded-xl bg-stone-50 px-4 py-5 text-center text-sm text-stone-400">No users found.</p>}
            </div>
          </section>

          <form onSubmit={submit} className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
            <h3 className="text-sm font-bold text-stone-900">Create user</h3>
            <p className="mt-1 text-xs leading-5 text-stone-500">The new account receives regular user access.</p>
            <label className="mt-4 block"><span className="text-xs font-semibold text-stone-700">Username</span><input autoFocus autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={40} placeholder="username" className="mt-1.5 block w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-3 text-sm text-stone-900 outline-none focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-600/10" /></label>
            <label className="mt-4 block"><span className="text-xs font-semibold text-stone-700">Password</span><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={256} placeholder="At least 12 characters" className="mt-1.5 block w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-3 text-sm text-stone-900 outline-none focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-600/10" /></label>
            <button disabled={submitting || username.trim().length < 3 || password.length < 12} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-800 px-4 py-3 text-sm font-bold text-white transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-40"><Icon name="plus" className="size-4" />{submitting ? 'Creating…' : 'Create user'}</button>
          </form>
        </div>
      </section>
    </Modal>
  )
}
