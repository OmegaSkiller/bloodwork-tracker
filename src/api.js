async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (response.status === 204) return null
  const body = await response.text()
  let payload = {}
  try {
    payload = body ? JSON.parse(body) : {}
  } catch {
    if (response.status === 524) throw new Error('Cloudflare timed out while waiting for the server. Retry the request.')
    if (response.status === 401 || response.status === 403) throw new Error('Authentication expired or access was denied. Reload the page and sign in again.')
    throw new Error(`Server returned an invalid response (HTTP ${response.status}).`)
  }
  if (response.status === 401 && !url.startsWith('/api/auth/login')) window.dispatchEvent(new Event('bloodwork:unauthorized'))
  if (!response.ok) throw new Error(payload.error || 'Something went wrong.')
  return payload
}

const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))

async function aiChat(data) {
  const started = await request('/api/ai/chat', { method: 'POST', body: JSON.stringify(data) })
  if (!started?.jobId) return started
  for (let attempt = 0; attempt < 300; attempt += 1) {
    await wait(2000)
    const result = await request(`/api/ai/chat/${encodeURIComponent(started.jobId)}`)
    if (result?.status !== 'pending') return result
  }
  throw new Error('AI response is still processing after 10 minutes. Retry the request.')
}

export const api = {
  authSession: () => request('/api/auth/session'),
  login: (data) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  listUsers: () => request('/api/users'),
  addUser: (data) => request('/api/users', { method: 'POST', body: JSON.stringify(data) }),
  changeUserPassword: (id, password) => request(`/api/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
  deleteUser: (id) => request(`/api/users/${id}`, { method: 'DELETE' }),
  bootstrap: (profileId) => request(`/api/bootstrap${profileId ? `?profileId=${profileId}` : ''}`),
  addProfile: (data) => request('/api/profiles', { method: 'POST', body: JSON.stringify(data) }),
  addCategory: (data) => request('/api/categories', { method: 'POST', body: JSON.stringify(data) }),
  addMarker: (data) => request('/api/markers', { method: 'POST', body: JSON.stringify(data) }),
  addRecord: (data) => request('/api/records', { method: 'POST', body: JSON.stringify(data) }),
  updateRecord: (id, data) => request(`/api/records/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRecord: (id, profileId) => request(`/api/records/${id}?profileId=${profileId}`, { method: 'DELETE' }),
  addLifeEvent: (data) => request('/api/life-events', { method: 'POST', body: JSON.stringify(data) }),
  updateLifeEvent: (id, data) => request(`/api/life-events/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLifeEvent: (id, profileId) => request(`/api/life-events/${id}?profileId=${profileId}`, { method: 'DELETE' }),
  listAiChats: (profileId) => request(`/api/ai/chats?profileId=${profileId}`),
  getAiChat: (id, profileId) => request(`/api/ai/chats/${id}?profileId=${profileId}`),
  addAiChat: (data) => request('/api/ai/chats', { method: 'POST', body: JSON.stringify(data) }),
  updateAiChat: (id, data) => request(`/api/ai/chats/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAiChat: (id, profileId) => request(`/api/ai/chats/${id}?profileId=${profileId}`, { method: 'DELETE' }),
  getOpenAiKeyStatus: () => request('/api/ai/openai-key'),
  saveOpenAiKey: (apiKey) => request('/api/ai/openai-key', { method: 'PUT', body: JSON.stringify({ apiKey }) }),
  deleteOpenAiKey: () => request('/api/ai/openai-key', { method: 'DELETE' }),
  aiChat,
}
