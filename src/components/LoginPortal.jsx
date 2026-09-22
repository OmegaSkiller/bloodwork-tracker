import { useState } from 'react'
import { Icon } from './Icons.jsx'

export default function LoginPortal({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      await onLogin({ username, password })
    } catch (loginError) {
      setError(loginError.message)
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#f3f6f3] px-5 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 size-96 rounded-full bg-teal-200/35 blur-3xl" />
        <div className="absolute -bottom-36 -right-24 size-[28rem] rounded-full bg-emerald-100/70 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.8),transparent_65%)]" />
      </div>

      <section className="relative w-full max-w-md overflow-hidden rounded-[2rem] border border-white/80 bg-white/95 shadow-[0_24px_80px_rgba(28,54,49,0.14)] backdrop-blur-xl">
        <div className="border-b border-stone-100 px-7 pb-6 pt-8 sm:px-9 sm:pt-10">
          <div className="flex items-center gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-teal-800 text-white shadow-lg shadow-teal-900/15"><Icon name="chart" className="size-7" /></span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Private health portal</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-stone-950">Bloodwork</h1>
            </div>
          </div>
          <p className="mt-6 text-sm leading-6 text-stone-500">Sign in to access isolated profiles, laboratory history, and AI insights.</p>
        </div>

        <form onSubmit={submit} className="space-y-5 px-7 py-7 sm:px-9 sm:py-8">
          <label className="block">
            <span className="text-sm font-semibold text-stone-800">Username</span>
            <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} className="mt-2 block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none transition focus:border-teal-700 focus:bg-white focus:ring-4 focus:ring-teal-700/10" />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-stone-800">Password</span>
            <input autoFocus type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none transition focus:border-teal-700 focus:bg-white focus:ring-4 focus:ring-teal-700/10" />
          </label>

          {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700">{error}</div>}

          <button disabled={submitting || !username.trim() || !password} className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-800 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-50">
            {submitting ? <><span className="size-2 animate-pulse rounded-full bg-white" />Signing in…</> : 'Sign in'}
          </button>

          <p className="text-center text-[11px] leading-5 text-stone-400">HTTP-only session cookies. Failed sign-in attempts are rate-limited. Use HTTPS for remote access.</p>
        </form>
      </section>
    </main>
  )
}
