import React, { useState, useEffect, useRef } from 'react'
import { Power, Link, Trello, RefreshCw, Webhook, Zap } from 'lucide-react'
import HotkeyInput from './HotkeyInput'
import type {
  QuickAddListShortcut,
  TrelloBoardSummary,
  TrelloListSummary
} from '../../shared/types'

const inputClass =
  'w-full px-3 py-2 rounded-lg border border-surface-700 bg-surface-800/50 ' +
  'text-sm text-surface-200 placeholder-surface-500 ' +
  'hover:border-surface-600 focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30 ' +
  'outline-none transition-all'

const selectClass =
  'flex-1 px-3 py-2 rounded-lg border border-surface-700 bg-surface-800/50 ' +
  'text-sm text-surface-200 hover:border-surface-600 ' +
  'focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30 ' +
  'outline-none transition-all disabled:opacity-50'

const refreshButtonClass =
  'p-2 rounded-lg border border-surface-700 bg-surface-800/50 ' +
  'text-surface-400 hover:text-surface-200 hover:bg-surface-800 disabled:opacity-50'

export default function SettingsView(): React.ReactElement {
  const [autoStart, setAutoStart] = useState(false)
  const [quickAddHotkey, setQuickAddHotkey] = useState('')
  const [trelloApiKey, setTrelloApiKey] = useState('')
  const [trelloToken, setTrelloToken] = useState('')
  const [trelloBoardId, setTrelloBoardId] = useState('')
  const [trelloListId, setTrelloListId] = useState('')
  const [listShortcuts, setListShortcuts] = useState<QuickAddListShortcut[]>([])
  const [boards, setBoards] = useState<TrelloBoardSummary[]>([])
  const [lists, setLists] = useState<TrelloListSummary[]>([])
  const [boardsLoading, setBoardsLoading] = useState(false)
  const [listsLoading, setListsLoading] = useState(false)
  const [trelloError, setTrelloError] = useState<string | null>(null)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookEnabled, setWebhookEnabled] = useState(false)

  const apiKeyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tokenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const webhookTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const credsReady = Boolean(trelloApiKey && trelloToken)

  useEffect(() => {
    window.api.getAutoStart().then(setAutoStart)
    window.api.getQuickAddHotkey().then(setQuickAddHotkey)
    window.api.getTrelloApiKey().then(setTrelloApiKey)
    window.api.getTrelloToken().then(setTrelloToken)
    window.api.getTrelloBoardId().then(setTrelloBoardId)
    window.api.getTrelloListId().then(setTrelloListId)
    window.api.getQuickAddListShortcuts().then(setListShortcuts)
    window.api.getWebhookUrl().then(setWebhookUrl)
    window.api.getWebhookEnabled().then(setWebhookEnabled)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!credsReady) {
      setBoards([])
      return
    }
    void (async () => {
      const result = await window.api.listTrelloBoards()
      if (cancelled) return
      if (result.ok && result.data) {
        setBoards(result.data)
      } else {
        setTrelloError(result.detail ?? 'Failed to fetch boards')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [credsReady])

  useEffect(() => {
    let cancelled = false
    if (!credsReady || !trelloBoardId) {
      setLists([])
      return
    }
    void (async () => {
      const result = await window.api.listTrelloLists(trelloBoardId)
      if (cancelled) return
      if (result.ok && result.data) {
        setLists(result.data)
      } else {
        setTrelloError(result.detail ?? 'Failed to fetch lists')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [credsReady, trelloBoardId])

  const refreshBoards = async (): Promise<void> => {
    if (!credsReady) return
    setBoardsLoading(true)
    setTrelloError(null)
    const result = await window.api.listTrelloBoards()
    setBoardsLoading(false)
    if (result.ok && result.data) {
      setBoards(result.data)
    } else {
      setTrelloError(result.detail ?? 'Failed to fetch boards')
      setBoards([])
    }
  }

  const refreshLists = async (boardId: string): Promise<void> => {
    if (!credsReady || !boardId) {
      setLists([])
      return
    }
    setListsLoading(true)
    setTrelloError(null)
    const result = await window.api.listTrelloLists(boardId)
    setListsLoading(false)
    if (result.ok && result.data) {
      setLists(result.data)
    } else {
      setTrelloError(result.detail ?? 'Failed to fetch lists')
      setLists([])
    }
  }

  const toggleAutoStart = async (): Promise<void> => {
    const next = !autoStart
    await window.api.setAutoStart(next)
    setAutoStart(next)
  }

  const handleHotkeyChange = async (hotkey: string): Promise<void> => {
    setQuickAddHotkey(hotkey)
    await window.api.setQuickAddHotkey(hotkey)
  }

  const handleApiKeyChange = (value: string): void => {
    setTrelloApiKey(value)
    if (apiKeyTimerRef.current) clearTimeout(apiKeyTimerRef.current)
    apiKeyTimerRef.current = setTimeout(() => {
      window.api.setTrelloApiKey(value)
    }, 500)
  }

  const handleTokenChange = (value: string): void => {
    setTrelloToken(value)
    if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current)
    tokenTimerRef.current = setTimeout(() => {
      window.api.setTrelloToken(value)
    }, 500)
  }

  const handleBoardChange = async (boardId: string): Promise<void> => {
    setTrelloBoardId(boardId)
    setTrelloListId('')
    setListShortcuts([])
    await window.api.setTrelloBoardId(boardId)
    await window.api.setTrelloListId('')
    await window.api.setQuickAddListShortcuts([])
  }

  const handleListChange = async (listId: string): Promise<void> => {
    setTrelloListId(listId)
    await window.api.setTrelloListId(listId)
  }

  const persistShortcuts = (next: QuickAddListShortcut[]): void => {
    setListShortcuts(next)
    void window.api.setQuickAddListShortcuts(next)
  }

  const handleShortcutAdd = (): void => {
    const first = lists[0]
    if (!first) return
    persistShortcuts([...listShortcuts, { listId: first.id, listName: first.name }])
  }

  const handleShortcutListChange = (index: number, listId: string): void => {
    const list = lists.find((item) => item.id === listId)
    if (!list) return
    const next = [...listShortcuts]
    next[index] = { listId: list.id, listName: list.name }
    persistShortcuts(next)
  }

  const handleShortcutRemove = (index: number): void => {
    persistShortcuts(listShortcuts.filter((_, i) => i !== index))
  }

  const handleWebhookUrlChange = (url: string): void => {
    setWebhookUrl(url)
    if (webhookTimerRef.current) clearTimeout(webhookTimerRef.current)
    webhookTimerRef.current = setTimeout(() => {
      window.api.setWebhookUrl(url)
    }, 500)
  }

  const toggleWebhookEnabled = async (): Promise<void> => {
    const next = !webhookEnabled
    await window.api.setWebhookEnabled(next)
    setWebhookEnabled(next)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3 border-b border-surface-800">
        <h2 className="text-base font-semibold text-surface-100">Settings</h2>
        <p className="text-xs text-surface-500 mt-0.5">App configuration</p>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        <div className="bg-surface-900/50 border border-surface-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-surface-300 mb-1 flex items-center gap-2">
            <Zap size={14} />
            Quick add
          </h3>
          <p className="text-xs text-surface-500 mb-4">
            Press the hotkey anywhere to open the capture window and send a card to Trello.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-surface-400 mb-1.5">Global hotkey</label>
              <HotkeyInput value={quickAddHotkey} onChange={handleHotkeyChange} />
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => void toggleAutoStart()}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  autoStart ? 'bg-accent-600' : 'bg-surface-700'
                }`}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    autoStart ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </div>
              <div>
                <div className="text-sm text-surface-200 flex items-center gap-1.5">
                  <Power size={12} />
                  Start with Windows
                </div>
                <div className="text-xs text-surface-500">
                  Ego runs in the tray so the hotkey is always live.
                </div>
              </div>
            </label>
          </div>
        </div>

        <div className="bg-surface-900/50 border border-surface-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-surface-300 mb-1 flex items-center gap-2">
            <Trello size={14} />
            Trello target
          </h3>
          <p className="text-xs text-surface-500 mb-4">
            Pick the board and list that quick-add cards land in.
          </p>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-surface-400 mb-1.5 flex items-center gap-1.5">
                <Link size={11} />
                Trello API key
              </label>
              <input
                type="password"
                value={trelloApiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                placeholder="API key"
                className={inputClass}
              />
            </div>

            <div>
              <label className="text-xs text-surface-400 mb-1.5 flex items-center gap-1.5">
                <Link size={11} />
                Trello token
              </label>
              <input
                type="password"
                value={trelloToken}
                onChange={(e) => handleTokenChange(e.target.value)}
                placeholder="Token"
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-xs text-surface-400 mb-1.5">Board</label>
              <div className="flex gap-2">
                <select
                  value={trelloBoardId}
                  onChange={(e) => void handleBoardChange(e.target.value)}
                  disabled={!credsReady || boardsLoading}
                  className={selectClass}
                >
                  <option value="">
                    {credsReady ? 'Select a board…' : 'Add API key + token first'}
                  </option>
                  {boards.map((board) => (
                    <option key={board.id} value={board.id}>
                      {board.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void refreshBoards()}
                  disabled={!credsReady || boardsLoading}
                  className={refreshButtonClass}
                  title="Refresh boards"
                >
                  <RefreshCw size={14} className={boardsLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-surface-400 mb-1.5">List</label>
              <div className="flex gap-2">
                <select
                  value={trelloListId}
                  onChange={(e) => void handleListChange(e.target.value)}
                  disabled={!trelloBoardId || listsLoading}
                  className={selectClass}
                >
                  <option value="">
                    {trelloBoardId ? 'Select a list…' : 'Pick a board first'}
                  </option>
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void refreshLists(trelloBoardId)}
                  disabled={!trelloBoardId || listsLoading}
                  className={refreshButtonClass}
                  title="Refresh lists"
                >
                  <RefreshCw size={14} className={listsLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {trelloError && <p className="text-[11px] text-red-400">{trelloError}</p>}

            {lists.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-surface-400">
                    Ctrl+number shortcuts (quick add target)
                  </label>
                  {listShortcuts.length < 9 && (
                    <button
                      type="button"
                      onClick={handleShortcutAdd}
                      className="text-xs text-accent-400 hover:text-accent-300 transition-colors"
                    >
                      + Add
                    </button>
                  )}
                </div>
                {listShortcuts.length === 0 ? (
                  <p className="text-[11px] text-surface-500">
                    No shortcuts yet. Press + Add to assign a list to Ctrl+1.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {listShortcuts.map((shortcut, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs font-mono text-surface-400 w-12 shrink-0 text-center bg-surface-800 border border-surface-700 rounded px-2 py-1">
                          Ctrl+{i + 1}
                        </span>
                        <select
                          value={shortcut.listId}
                          onChange={(e) => handleShortcutListChange(i, e.target.value)}
                          className={selectClass.replace('py-2', 'py-1.5')}
                        >
                          {lists.map((list) => (
                            <option key={list.id} value={list.id}>
                              {list.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleShortcutRemove(i)}
                          className="text-surface-500 hover:text-red-400 transition-colors text-sm px-1"
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-surface-500 mt-2">
                  Press Ctrl+1, Ctrl+2, and so on inside the quick add window to switch the
                  target list.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-surface-900/50 border border-surface-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-surface-300 mb-1 flex items-center gap-2">
            <Webhook size={14} />
            Webhook
          </h3>
          <p className="text-xs text-surface-500 mb-4">
            After a card is created, Ego POSTs the card title, description, list id, and card URL
            as JSON to this URL. Failures are logged and never block the card.
          </p>

          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => void toggleWebhookEnabled()}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  webhookEnabled ? 'bg-accent-600' : 'bg-surface-700'
                }`}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    webhookEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </div>
              <div className="text-sm text-surface-200">Send webhook on card creation</div>
            </label>

            <div>
              <label className="text-xs text-surface-400 mb-1.5 flex items-center gap-1.5">
                <Link size={11} />
                Webhook URL
              </label>
              <input
                type="text"
                value={webhookUrl}
                onChange={(e) => handleWebhookUrlChange(e.target.value)}
                placeholder="https://example.com/webhook/..."
                className={inputClass}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
