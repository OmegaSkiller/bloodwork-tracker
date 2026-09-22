import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { api } from './api.js'
import LoginPortal from './components/LoginPortal.jsx'
import './index.css'

function Root() {
  const [session, setSession] = useState({ loading: true, authenticated: false, username: null, role: null })

  useEffect(() => {
    let active = true
    api.authSession()
      .then((result) => { if (active) setSession({ loading: false, ...result }) })
      .catch(() => { if (active) setSession({ loading: false, authenticated: false, username: null, role: null }) })
    const handleUnauthorized = () => setSession({ loading: false, authenticated: false, username: null, role: null })
    window.addEventListener('bloodwork:unauthorized', handleUnauthorized)
    return () => {
      active = false
      window.removeEventListener('bloodwork:unauthorized', handleUnauthorized)
    }
  }, [])

  async function login(credentials) {
    const result = await api.login(credentials)
    setSession({ loading: false, ...result })
  }

  async function logout() {
    try { await api.logout() } finally { setSession({ loading: false, authenticated: false, username: null, role: null }) }
  }

  if (session.loading) return <div className="grid min-h-screen place-items-center bg-stone-100"><p className="animate-pulse font-semibold text-stone-500">Securing your session…</p></div>
  if (!session.authenticated) return <LoginPortal onLogin={login} />
  return <App username={session.username} role={session.role} onLogout={logout} />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
