import Modal from './ui/Modal.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api.js'
import { AI_MARKER_LIMIT, AI_PROVIDERS, DEFAULT_AI_PROVIDER, DEFAULT_AI_SYSTEM_PROMPT, OPENAI_MODELS } from '../../shared/ai.js'
import { Icon } from './Icons.jsx'

const providerStorageKey = 'bloodwork-ai-provider'
const openAiModelStorageKey = 'bloodwork-ai-openai-model'
const chatDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const scopeDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

function formatChatDate(value) {
  const parsed = new Date(`${String(value || '').replace(' ', 'T').replace(/Z$/, '')}Z`)
  return Number.isNaN(parsed.valueOf()) ? '' : chatDate.format(parsed)
}

function readPrompt() {
  return DEFAULT_AI_SYSTEM_PROMPT
}

function readProvider() {
  try {
    const saved = window.localStorage.getItem(providerStorageKey)
    return Object.hasOwn(AI_PROVIDERS, saved) ? saved : DEFAULT_AI_PROVIDER
  } catch {
    return DEFAULT_AI_PROVIDER
  }
}

function readOpenAiModel() {
  try {
    const saved = window.localStorage.getItem(openAiModelStorageKey)
    return OPENAI_MODELS.includes(saved) ? saved : AI_PROVIDERS.openai.model
  } catch {
    return AI_PROVIDERS.openai.model
  }
}

function dateRangeLabel(dateRange) {
  if (!dateRange?.start || !dateRange?.end) return 'Chart timeframe unavailable'
  const start = scopeDate.format(new Date(`${dateRange.start}T00:00:00Z`))
  const end = scopeDate.format(new Date(`${dateRange.end}T00:00:00Z`))
  return dateRange.start === dateRange.end ? start : `${start} – ${end}`
}

function Message({ message }) {
  const assistant = message.role === 'assistant'
  return (
    <div className={`flex ${assistant ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[92%] overflow-hidden rounded-2xl px-4 py-3 text-sm leading-6 ${assistant ? 'rounded-tl-md border border-stone-200 bg-white text-stone-700 shadow-sm' : 'whitespace-pre-wrap rounded-tr-md bg-teal-800 text-white'}`}>
        {assistant ? <Markdown
          skipHtml
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => <h3 className="mb-2 mt-4 text-base font-bold text-stone-900 first:mt-0">{children}</h3>,
            h2: ({ children }) => <h3 className="mb-2 mt-4 text-sm font-bold text-stone-900 first:mt-0">{children}</h3>,
            h3: ({ children }) => <h4 className="mb-1.5 mt-3 text-sm font-semibold text-stone-900 first:mt-0">{children}</h4>,
            p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
            ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
            ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
            li: ({ children }) => <li className="pl-0.5">{children}</li>,
            strong: ({ children }) => <strong className="font-semibold text-stone-900">{children}</strong>,
            blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-teal-600 bg-teal-50/70 py-2 pl-3 pr-2 text-stone-600">{children}</blockquote>,
            a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener" className="font-medium text-teal-700 underline decoration-teal-300 underline-offset-2 hover:text-teal-900">{children}</a>,
            table: ({ children }) => <div className="my-3 overflow-x-auto rounded-xl border border-stone-200"><table className="min-w-full border-collapse text-left text-xs">{children}</table></div>,
            thead: ({ children }) => <thead className="bg-stone-100 text-stone-800">{children}</thead>,
            th: ({ children }) => <th className="border-b border-stone-200 px-3 py-2 font-semibold">{children}</th>,
            td: ({ children }) => <td className="border-b border-stone-100 px-3 py-2 align-top last:border-b-0">{children}</td>,
            pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-xl bg-stone-900 p-3 text-xs leading-5 text-stone-100 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit">{children}</pre>,
            code: ({ children, className }) => <code className={`${className || ''} rounded bg-stone-100 px-1 py-0.5 font-mono text-[0.9em] text-stone-800`}>{children}</code>,
            hr: () => <hr className="my-4 border-stone-200" />,
          }}
        >{message.content}</Markdown> : message.content}
      </div>
    </div>
  )
}

export default function AIChatPanel({ open, onClose, profile, markers, records, lifeEvents = [], initialMarkerIds, dateRange, isAdmin = false }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [retryText, setRetryText] = useState('')
  const [markerPickerOpen, setMarkerPickerOpen] = useState(false)
  const [markerSearch, setMarkerSearch] = useState('')
  const [extraMarkerIds, setExtraMarkerIds] = useState([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState(readPrompt)
  const [promptDraft, setPromptDraft] = useState(readPrompt)
  const [provider, setProvider] = useState(readProvider)
  const [openAiModel, setOpenAiModel] = useState(readOpenAiModel)
  const [openAiKeyDraft, setOpenAiKeyDraft] = useState('')
  const [openAiKeyStatus, setOpenAiKeyStatus] = useState({ loading: false, configured: false, source: null })
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [chats, setChats] = useState([])
  const [activeChatId, setActiveChatId] = useState(null)
  const [activeChatTitle, setActiveChatTitle] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [chatLoading, setChatLoading] = useState(false)
  const [chatSaving, setChatSaving] = useState(false)
  const endRef = useRef(null)
  const providerConfig = AI_PROVIDERS[provider]
  const activeModel = provider === 'openai' ? openAiModel : providerConfig.model
  const chartMarkerIds = useMemo(() => [...new Set(initialMarkerIds)].filter((id) => markers.some((marker) => marker.id === id)).slice(0, AI_MARKER_LIMIT), [initialMarkerIds, markers])
  const selectedMarkerIds = useMemo(() => {
    const chartIds = new Set(chartMarkerIds)
    return [...chartMarkerIds, ...extraMarkerIds.filter((id) => !chartIds.has(id))].slice(0, AI_MARKER_LIMIT)
  }, [chartMarkerIds, extraMarkerIds])

  useEffect(() => {
    setMessages([])
    setInput('')
    setError('')
    setRetryText('')
    setActiveChatId(null)
    setActiveChatTitle('')
    setHistoryOpen(false)
    setChats([])
    setExtraMarkerIds([])
    if (profile?.id) api.listAiChats(profile.id).then(setChats).catch((caught) => setError(caught.message))
  }, [profile?.id])

  // Old messages can contain observations from a previous scope. Start a new
  // conversation when the chart scope changes; saved history remains readable.
  useEffect(() => {
    setMessages([])
    setActiveChatId(null)
    setActiveChatTitle('')
    setRetryText('')
    setConsent(false)
  }, [dateRange?.start, dateRange?.end, initialMarkerIds.join(',')])

  useEffect(() => {
    const chartIds = new Set(chartMarkerIds)
    const availableIds = new Set(markers.map((marker) => marker.id))
    setExtraMarkerIds((current) => current
      .filter((id) => availableIds.has(id) && !chartIds.has(id))
      .slice(0, Math.max(AI_MARKER_LIMIT - chartMarkerIds.length, 0)))
  }, [chartMarkerIds, markers])

  useEffect(() => {
    if (open) window.setTimeout(() => endRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }), 20)
  }, [open, messages, sending])

  useEffect(() => {
    if (!settingsOpen || !isAdmin) return
    setSettingsError('')
    setOpenAiKeyStatus((current) => ({ ...current, loading: true }))
    api.getOpenAiKeyStatus()
      .then((status) => setOpenAiKeyStatus({ loading: false, ...status }))
      .catch((caught) => {
        setOpenAiKeyStatus((current) => ({ ...current, loading: false }))
        setSettingsError(caught.message)
      })
  }, [isAdmin, settingsOpen])

  const recordCountByMarker = useMemo(() => {
    const counts = new Map()
    records.forEach((record) => counts.set(record.markerId, (counts.get(record.markerId) || 0) + 1))
    return counts
  }, [records])

  const filteredMarkers = useMemo(() => {
    const query = markerSearch.trim().toLowerCase()
    return markers.filter((marker) => !query || marker.name.toLowerCase().includes(query) || marker.category.toLowerCase().includes(query) || marker.unit.toLowerCase().includes(query))
  }, [markers, markerSearch])

  const selectedMarkers = useMemo(() => selectedMarkerIds.map((id) => markers.find((marker) => marker.id === id)).filter(Boolean), [markers, selectedMarkerIds])
  const lifeEventCount = useMemo(() => {
    if (!dateRange?.start || !dateRange?.end) return 0
    return lifeEvents.filter((lifeEvent) => lifeEvent.startsOn <= dateRange.end && (lifeEvent.endsOn || lifeEvent.startsOn) >= dateRange.start).length
  }, [dateRange?.end, dateRange?.start, lifeEvents])

  function toggleMarker(id) {
    if (chartMarkerIds.includes(id)) return
    setExtraMarkerIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : selectedMarkerIds.length < AI_MARKER_LIMIT ? [...current, id] : current)
  }

  async function refreshChats() {
    if (!profile?.id) return
    const savedChats = await api.listAiChats(profile.id)
    setChats(savedChats)
  }

  function newChat() {
    setMessages([])
    setInput('')
    setError('')
    setRetryText('')
    setActiveChatId(null)
    setActiveChatTitle('')
    setHistoryOpen(false)
  }

  function savedChatPayload(chatMessages, title) {
    return {
      profileId: profile.id,
      title,
      markerIds: selectedMarkerIds,
      messages: chatMessages.map(({ role, content }) => ({ role, content })),
      systemPrompt,
      provider,
      model: activeModel,
      dateRange,
    }
  }

  async function saveChatSnapshot(chatMessages, id, title) {
    setChatSaving(true)
    try {
      return id
        ? await api.updateAiChat(id, savedChatPayload(chatMessages, title))
        : await api.addAiChat(savedChatPayload(chatMessages, title))
    } finally {
      setChatSaving(false)
    }
  }

  async function loadChat(id) {
    setChatLoading(true)
    setError('')
    try {
      const chat = await api.getAiChat(id, profile.id)
      setActiveChatId(chat.id)
      setActiveChatTitle(chat.title)
      setMessages(chat.messages.map(({ role, content }) => ({ role, content })))
      setProvider(Object.hasOwn(AI_PROVIDERS, chat.provider) ? chat.provider : DEFAULT_AI_PROVIDER)
      if (OPENAI_MODELS.includes(chat.model)) setOpenAiModel(chat.model)
      const chartIds = new Set(chartMarkerIds)
      setExtraMarkerIds(chat.markerIds.filter((idValue) => markers.some((marker) => marker.id === idValue) && !chartIds.has(idValue)).slice(0, Math.max(AI_MARKER_LIMIT - chartMarkerIds.length, 0)))
      setSystemPrompt(chat.systemPrompt || DEFAULT_AI_SYSTEM_PROMPT)
      setPromptDraft(chat.systemPrompt || DEFAULT_AI_SYSTEM_PROMPT)
      setHistoryOpen(false)
    } catch (caught) {
      setError(caught.message)
    } finally {
      setChatLoading(false)
    }
  }

  async function deleteChat(chat) {
    if (!window.confirm(`Delete saved chat “${chat.title}”?`)) return
    try {
      await api.deleteAiChat(chat.id, profile.id)
      if (activeChatId === chat.id) newChat()
      await refreshChats()
    } catch (caught) {
      setError(caught.message)
    }
  }

  async function saveSettings() {
    const nextPrompt = promptDraft.trim() || DEFAULT_AI_SYSTEM_PROMPT
    setSettingsSaving(true)
    setSettingsError('')
    try {
      if (isAdmin && openAiKeyDraft.trim()) {
        const status = await api.saveOpenAiKey(openAiKeyDraft.trim())
        setOpenAiKeyStatus({ loading: false, ...status })
        setOpenAiKeyDraft('')
      }
      setSystemPrompt(nextPrompt)
      setPromptDraft(nextPrompt)
      setSettingsOpen(false)
    } catch (caught) {
      setSettingsError(caught.message)
    } finally {
      setSettingsSaving(false)
    }
  }

  async function clearOpenAiKey() {
    if (!window.confirm('Remove the OpenAI API key saved by this app?')) return
    setSettingsSaving(true)
    setSettingsError('')
    try {
      const status = await api.deleteOpenAiKey()
      setOpenAiKeyStatus({ loading: false, ...status })
      setOpenAiKeyDraft('')
    } catch (caught) {
      setSettingsError(caught.message)
    } finally {
      setSettingsSaving(false)
    }
  }

  function resetPrompt() {
    setPromptDraft(DEFAULT_AI_SYSTEM_PROMPT)
  }

  function changeProvider(nextProvider) {
    setConsent(false)
    setProvider(nextProvider)
    setMessages([])
    setInput('')
    setError('')
    setRetryText('')
    setActiveChatId(null)
    setActiveChatTitle('')
    try { window.localStorage.setItem(providerStorageKey, nextProvider) } catch { /* Browser storage may be unavailable. */ }
  }

  function changeOpenAiModel(nextModel) {
    if (!OPENAI_MODELS.includes(nextModel)) return
    setOpenAiModel(nextModel)
    setMessages([])
    setInput('')
    setError('')
    setRetryText('')
    setActiveChatId(null)
    setActiveChatTitle('')
    try { window.localStorage.setItem(openAiModelStorageKey, nextModel) } catch { /* Browser storage may be unavailable. */ }
  }

  async function sendMessage(text = input, retry = false) {
    const content = text.trim()
    if (!content || sending) return
    if (!consent) { setError('Confirm the external data transfer before sending.'); return }
    if (!selectedMarkerIds.length) {
      setError('Select at least one marker to include in the analysis.')
      setMarkerPickerOpen(true)
      return
    }
    if (!dateRange?.start || !dateRange?.end) {
      setError('The chart timeframe is not ready yet. Close the panel, choose a timeframe, and try again.')
      return
    }
    const nextMessages = retry ? messages : [...messages, { role: 'user', content }]
    const title = activeChatTitle || content.replace(/\s+/g, ' ').slice(0, 80)
    setMessages(nextMessages)
    setInput('')
    setError('')
    setSending(true)
    let chatId = activeChatId
    try {
      const saved = await saveChatSnapshot(nextMessages, chatId, title)
      chatId = saved.id
      setActiveChatId(saved.id)
      setActiveChatTitle(saved.title)
      const response = await api.aiChat({
        consent,
        profileId: profile.id,
        markerIds: selectedMarkerIds,
        messages: nextMessages.map(({ role, content: messageContent }) => ({ role, content: messageContent })),
        systemPrompt,
        provider,
        model: activeModel,
        dateRange,
      })
      const completedMessages = [...nextMessages, { role: 'assistant', content: response.message }]
      setMessages(completedMessages)
      setRetryText('')
      try {
        await saveChatSnapshot(completedMessages, chatId, title)
        await refreshChats()
      } catch (saveError) {
        setError(`The answer is shown, but could not be saved: ${saveError.message}`)
      }
    } catch (requestError) {
      setError(requestError.message)
      setRetryText(content)
      refreshChats().catch(() => {})
    } finally {
      setSending(false)
    }
  }

  if (!open) return null

  return (
    <Modal onClose={onClose} aria-label="Optional AI analysis" className="fixed inset-0 z-[70] bg-transparent">
      <button onClick={onClose} aria-label="Close AI chat" className={`absolute inset-0 bg-stone-950/25 backdrop-blur-[2px] transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} />
      <aside aria-label="Health data AI chat" className={`absolute inset-y-0 right-0 flex w-full max-w-[460px] flex-col border-l border-stone-200 bg-[#f7f8f5] shadow-2xl transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <header className="border-b border-stone-200 bg-white px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-teal-800 text-white"><Icon name="sparkles" /></span>
              <div className="min-w-0"><h2 className="truncate text-base font-bold text-stone-900">{activeChatTitle || 'Health data AI'}</h2><p className="truncate text-xs text-stone-400">{profile?.name} · {activeModel} · {chatSaving ? 'Saving…' : activeChatId ? 'Saved' : 'New chat'}</p></div>
            </div>
            <div className="flex gap-1">
              <button onClick={() => { setSettingsOpen(false); setHistoryOpen(true); refreshChats().catch((caught) => setError(caught.message)) }} className="grid size-9 place-items-center rounded-xl text-stone-500 transition hover:bg-stone-100 hover:text-stone-900" aria-label="Saved chats" title="Saved chats"><Icon name="history" className="size-5" /></button>
              <button onClick={newChat} className="grid size-9 place-items-center rounded-xl text-stone-500 transition hover:bg-stone-100 hover:text-stone-900" aria-label="Start new chat" title="Start new chat"><Icon name="plus" className="size-5" /></button>
              <button onClick={() => { setPromptDraft(systemPrompt); setOpenAiKeyDraft(''); setSettingsError(''); setSettingsOpen(true) }} className="grid size-9 place-items-center rounded-xl text-stone-500 transition hover:bg-stone-100 hover:text-stone-900" aria-label="AI settings"><Icon name="gear" className="size-5" /></button>
              <button onClick={onClose} className="grid size-9 place-items-center rounded-xl text-stone-500 transition hover:bg-stone-100 hover:text-stone-900" aria-label="Close AI chat"><Icon name="close" className="size-5" /></button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 rounded-xl bg-stone-100 p-1" aria-label="AI provider">
            {Object.values(AI_PROVIDERS).map((option) => <button key={option.id} type="button" aria-pressed={provider === option.id} onClick={() => changeProvider(option.id)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${provider === option.id ? 'bg-white text-teal-800 shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}>{option.label}</button>)}
          </div>
          {provider === 'openai' && <label className="mt-3 block"><span className="sr-only">OpenAI model</span><select aria-label="OpenAI model" value={openAiModel} onChange={(event) => changeOpenAiModel(event.target.value)} disabled={sending} className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-stone-700 outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10 disabled:opacity-50">{OPENAI_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}</select><span className="mt-1.5 block px-1 text-[10px] text-stone-400">Changing models starts a new chat. Configure the API key from the gear menu.</span></label>}
        </header>

        <div className="relative border-b border-stone-200 bg-white px-4 py-3 sm:px-5">
          <button onClick={() => setMarkerPickerOpen((current) => !current)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-left transition hover:border-teal-300 hover:bg-teal-50/50">
            <span className="min-w-0"><span className="block text-xs font-semibold text-stone-800">Analysis scope · {selectedMarkerIds.length}/{AI_MARKER_LIMIT} markers</span><span className="mt-0.5 block truncate text-[11px] text-stone-400">{selectedMarkers.length ? selectedMarkers.map((marker) => marker.name).join(', ') : 'Choose markers to analyze'}</span><span className="mt-1 block truncate text-[10px] font-medium text-teal-700">{chartMarkerIds.length} chart · {selectedMarkerIds.length - chartMarkerIds.length} extra · {dateRangeLabel(dateRange)} · {lifeEventCount} life {lifeEventCount === 1 ? 'event' : 'events'}</span></span>
            <Icon name="chevron" className={`size-4 shrink-0 text-stone-400 transition ${markerPickerOpen ? '-rotate-90' : 'rotate-90'}`} />
          </button>
          {markerPickerOpen && <div className="absolute left-4 right-4 top-[calc(100%-4px)] z-20 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl sm:left-5 sm:right-5">
            <div className="border-b border-stone-200 p-3">
              <label className="relative block"><Icon name="search" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" /><input aria-label="Search AI markers" autoFocus value={markerSearch} onChange={(event) => setMarkerSearch(event.target.value)} placeholder="Search marker or category" className="w-full rounded-xl border border-stone-200 bg-stone-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-teal-600 focus:bg-white" /></label>
              <div className="mt-2 flex items-center justify-between text-[11px]"><button onClick={() => { setExtraMarkerIds([]); setMarkerPickerOpen(false) }} className="font-semibold text-teal-700 hover:text-teal-900">Chart selection only</button><button onClick={() => setExtraMarkerIds([])} className="font-semibold text-stone-400 hover:text-stone-700">Clear extras</button></div>
            </div>
            <div className="max-h-72 overflow-y-auto p-2">
              {filteredMarkers.map((marker) => {
                const selected = selectedMarkerIds.includes(marker.id)
                const selectedOnChart = chartMarkerIds.includes(marker.id)
                const disabled = selectedOnChart || (!selected && selectedMarkerIds.length >= AI_MARKER_LIMIT)
                return <button key={marker.id} disabled={disabled} onClick={() => toggleMarker(marker.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${selected ? 'bg-teal-50' : 'hover:bg-stone-50 disabled:opacity-40'}`}><span className={`grid size-4 shrink-0 place-items-center rounded border ${selected ? 'border-teal-700 bg-teal-700 text-white' : 'border-stone-300 bg-white'}`}>{selected && <Icon name="check" className="size-3" />}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-sm font-medium text-stone-800">{marker.name}</span>{selectedOnChart && <span className="shrink-0 rounded-full bg-teal-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-teal-700">Chart</span>}</span><span className="block truncate text-[10px] text-stone-400">{marker.category} · {recordCountByMarker.get(marker.id) || 0} results · {marker.unit || 'unitless'}</span></span></button>
              })}
            </div>
          </div>}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5">
          {!messages.length && <div className="rounded-2xl border border-teal-100 bg-teal-50/70 p-4"><p className="text-sm font-semibold text-teal-950">Ask about the visible chart period</p><p className="mt-1 text-xs leading-5 text-teal-800/80">{providerConfig.label} receives the selected markers, results dated {dateRangeLabel(dateRange)}, and the {lifeEventCount} overlapping life {lifeEventCount === 1 ? 'event' : 'events'} from {profile?.name}, including notes and substances, plus your prompt and chat messages. Names are omitted from structured context, but free text may identify people. Try one of these:</p><div className="mt-3 flex flex-wrap gap-2">{['Summarize the main trends.', 'Compare the latest and earliest results.', 'What patterns should I discuss with my doctor?'].map((prompt) => <button key={prompt} onClick={() => sendMessage(prompt)} className="rounded-full border border-teal-200 bg-white px-3 py-1.5 text-left text-[11px] font-semibold text-teal-800 transition hover:border-teal-400">{prompt}</button>)}</div></div>}
          {messages.map((message, index) => <Message key={`${message.role}-${index}`} message={message} />)}
          {sending && <div className="flex justify-start"><div className="rounded-2xl rounded-tl-md border border-stone-200 bg-white px-4 py-3 text-sm text-stone-500 shadow-sm"><span className="inline-flex items-center gap-2"><span className="size-2 animate-pulse rounded-full bg-teal-600" />Analyzing {selectedMarkerIds.length} markers with {activeModel}…</span></div></div>}
          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700"><p>{error}</p>{retryText && <button onClick={() => sendMessage(retryText, true)} disabled={sending} className="mt-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 font-semibold text-red-700 hover:border-red-300 disabled:opacity-40">Retry request</button>}</div>}
          <div ref={endRef} />
        </div>

        <div className="border-t border-stone-200 bg-white p-4 sm:p-5">
          <label className="mb-3 flex items-start gap-2 text-xs leading-5 text-stone-700">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1" />
            <span>I agree to send selected results, report ranges, notes, overlapping life events, my prompt, and chat messages to {providerConfig.label}. Provider terms and charges apply. No API key is included in the demo.</span>
          </label>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-2 focus-within:border-teal-600 focus-within:bg-white focus-within:ring-4 focus-within:ring-teal-600/10">
            <textarea aria-label="Question for AI" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage() } }} rows={3} placeholder="Ask a specific question about these markers…" className="block w-full resize-none bg-transparent px-2 py-1 text-sm leading-5 text-stone-800 outline-none placeholder:text-stone-400" />
            <div className="flex items-center justify-between gap-3 px-1 pt-1"><span className="text-[10px] text-stone-400">Enter to send · Shift+Enter for a new line</span><button disabled={!consent || sending || !input.trim() || !dateRange?.start || !dateRange?.end} onClick={() => sendMessage()} className="inline-flex items-center gap-2 rounded-xl bg-teal-800 px-3 py-2 text-xs font-semibold text-white transition hover:bg-teal-900 disabled:opacity-40"><Icon name="send" className="size-4" />Send</button></div>
          </div>
          <p className="mt-2 text-[10px] leading-4 text-stone-400">Chats are automatically saved to this profile. {provider === 'openai' ? 'Scoped health data is sent directly to OpenAI.' : 'Scoped health data is sent to OpenRouter and its third-party model provider.'} AI output is not medical advice.</p>
        </div>

        {historyOpen && <div className="absolute inset-0 z-30 flex flex-col bg-[#f7f8f5]">
          <header className="flex items-center justify-between border-b border-stone-200 bg-white px-5 py-4"><div><h3 className="font-bold text-stone-900">Saved chats</h3><p className="text-xs text-stone-400">Private to {profile?.name}</p></div><div className="flex gap-1"><button onClick={newChat} className="inline-flex items-center gap-1.5 rounded-xl bg-teal-800 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-900"><Icon name="plus" className="size-4" />New</button><button onClick={() => setHistoryOpen(false)} aria-label="Close saved chats" className="grid size-9 place-items-center rounded-xl text-stone-500 hover:bg-stone-100"><Icon name="close" /></button></div></header>
          <div className="flex-1 overflow-y-auto p-4 sm:p-5">
            {chatLoading && <p className="py-10 text-center text-sm text-stone-400">Loading chat…</p>}
            {!chatLoading && <div className="space-y-2">{chats.map((chat) => <div key={chat.id} className={`group flex items-center gap-2 rounded-2xl border bg-white p-2 shadow-sm transition ${activeChatId === chat.id ? 'border-teal-300 ring-2 ring-teal-600/10' : 'border-stone-200 hover:border-stone-300'}`}><button onClick={() => loadChat(chat.id)} className="min-w-0 flex-1 rounded-xl px-2 py-2 text-left"><span className="block truncate text-sm font-semibold text-stone-900">{chat.title}</span><span className="mt-1 block truncate text-xs text-stone-500">{chat.lastMessage || 'No messages yet'}</span><span className="mt-2 flex items-center gap-2 text-[10px] font-medium text-stone-400"><span>{formatChatDate(chat.updatedAt)}</span><span>·</span><span>{chat.messageCount} messages</span><span>·</span><span className="truncate">{chat.model}</span></span></button><button onClick={() => deleteChat(chat)} aria-label={`Delete ${chat.title}`} className="grid size-9 shrink-0 place-items-center rounded-xl text-stone-300 opacity-0 transition hover:bg-red-50 hover:text-red-700 group-hover:opacity-100 focus:opacity-100"><Icon name="trash" className="size-4" /></button></div>)}</div>}
            {!chatLoading && !chats.length && <div className="grid min-h-72 place-items-center text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-stone-100 text-stone-400"><Icon name="chat" /></span><p className="mt-3 font-semibold text-stone-700">No saved chats yet</p><p className="mt-1 text-xs leading-5 text-stone-400">Your first conversation will appear here automatically.</p></div></div>}
          </div>
        </div>}

        {settingsOpen && <div className="absolute inset-0 z-30 flex flex-col bg-[#f7f8f5]">
          <header className="flex items-center justify-between border-b border-stone-200 bg-white px-5 py-4"><div><h3 className="font-bold text-stone-900">AI settings</h3><p className="text-xs text-stone-400">{isAdmin ? 'Prompt in this session · API key on server' : 'Prompt in this session'}</p></div><button onClick={() => setSettingsOpen(false)} aria-label="Close AI settings" className="grid size-9 place-items-center rounded-xl text-stone-500 hover:bg-stone-100"><Icon name="close" /></button></header>
          <div className="flex-1 overflow-y-auto p-5">
            {isAdmin && <section className="rounded-2xl border border-stone-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3"><div><label className="text-sm font-semibold text-stone-800" htmlFor="openai-key">OpenAI API key</label><p className="mt-1 text-xs leading-5 text-stone-500">Used only by the server for direct OpenAI requests. The saved key is never sent back to this browser. This operator key is shared by all authorized users; requests may incur provider charges.</p></div><span className={`mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${openAiKeyStatus.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{openAiKeyStatus.loading ? 'Checking…' : openAiKeyStatus.configured ? 'Configured' : 'Not configured'}</span></div>
              <input id="openai-key" type="password" autoComplete="off" spellCheck="false" value={openAiKeyDraft} onChange={(event) => setOpenAiKeyDraft(event.target.value)} placeholder={openAiKeyStatus.configured ? 'Enter a new key to replace it' : 'sk-…'} className="mt-3 block w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-3 font-mono text-sm text-stone-800 outline-none focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-600/10" />
              <div className="mt-2 flex items-center justify-between gap-3"><span className="text-[10px] text-stone-400">{openAiKeyStatus.source === 'environment' ? 'Configured through OPENAI_API_KEY.' : openAiKeyStatus.source === 'settings' ? 'Stored in the protected app data volume.' : 'Required only for the OpenAI provider.'}</span>{openAiKeyStatus.source === 'settings' && <button type="button" disabled={settingsSaving} onClick={clearOpenAiKey} className="text-[11px] font-semibold text-red-600 hover:text-red-800 disabled:opacity-40">Remove key</button>}</div>
            </section>}

            <section className={isAdmin ? 'mt-5' : ''}><label className="text-sm font-semibold text-stone-800" htmlFor="system-prompt">System prompt</label><p className="mt-1 text-xs leading-5 text-stone-500">Customize how the assistant analyzes trends and structures its answers. Profile access, selected dates, and marker scope are enforced by the server. Safety instructions are appended, but cannot guarantee medically correct output.</p><textarea id="system-prompt" value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)} className="mt-4 min-h-[360px] w-full resize-y rounded-2xl border border-stone-200 bg-white p-4 text-sm leading-6 text-stone-700 outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" /><div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">This prompt and scoped health data are included in requests to {activeModel}. Do not place secrets or unrelated personal information here.</div></section>
            {settingsError && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700">{settingsError}</div>}
          </div>
          <footer className="flex items-center justify-between gap-3 border-t border-stone-200 bg-white p-5"><button onClick={resetPrompt} disabled={settingsSaving} className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-40">Restore default</button><button onClick={saveSettings} disabled={settingsSaving} className="rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-40">{settingsSaving ? 'Saving…' : 'Save settings'}</button></footer>
        </div>}
      </aside>
    </Modal>
  )
}
