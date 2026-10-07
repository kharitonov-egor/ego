import React, { useEffect, useRef, useState } from 'react'
import { ListPlus, RefreshCw, X } from 'lucide-react'
import type { QuickAddListShortcut, TrelloBoardSummary, TrelloListSummary } from '../../platform/types'
import HotkeyInput from '../HotkeyInput'
import { FieldLabel, Section, SectionNote } from '../Section'
import { Badge } from '../ui/badge'
import { IconButton } from '../ui/button'
import { inputClass } from '../ui/input'
import { isWeb } from '../../lib/platform'

const TRELLO_TOKEN_DOCS = 'https://trello.com/power-ups/admin'

/**
 * Alt+N sends a card straight to Trello. The desktop uses its own key and token from anywhere in
 * Windows; a browser tab uses the Worker's, so only the board and list are set here.
 */
export function QuickAddSettings(): React.ReactElement {
  const web = isWeb()
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
  const apiKeyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tokenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Only the newest request may fill the picker, so a slow answer for the old board is dropped. */
  const boardsRequest = useRef(0)
  const listsRequest = useRef(0)

  const credsReady = web || Boolean(trelloApiKey && trelloToken)
  const ready = credsReady && Boolean(trelloListId) && (web || Boolean(quickAddHotkey))

  useEffect(() => {
    void window.api.getQuickAddHotkey().then(setQuickAddHotkey)
    void window.api.getTrelloApiKey().then(setTrelloApiKey)
    void window.api.getTrelloToken().then(setTrelloToken)
    void window.api.getTrelloBoardId().then(setTrelloBoardId)
    void window.api.getTrelloListId().then(setTrelloListId)
    void window.api.getQuickAddListShortcuts().then(setListShortcuts)
  }, [])

  const loadBoards = async (): Promise<void> => {
    const request = (boardsRequest.current += 1)
    setBoardsLoading(true)
    const result = await window.api.listTrelloBoards()
    if (request !== boardsRequest.current) return
    setBoardsLoading(false)
    if (result.ok && result.data) {
      setBoards(result.data)
      setTrelloError(null)
    } else {
      setBoards([])
      setTrelloError(result.detail ?? 'Failed to fetch boards')
    }
  }

  const loadLists = async (boardId: string): Promise<void> => {
    const request = (listsRequest.current += 1)
    if (!boardId) {
      setLists([])
      return
    }
    setListsLoading(true)
    const result = await window.api.listTrelloLists(boardId)
    if (request !== listsRequest.current) return
    setListsLoading(false)
    if (result.ok && result.data) {
      setLists(result.data)
      setTrelloError(null)
    } else {
      setLists([])
      setTrelloError(result.detail ?? 'Failed to fetch lists')
    }
  }

  useEffect(() => {
    if (!credsReady) {
      setBoards([])
      return
    }
    void loadBoards()
  }, [credsReady, trelloApiKey, trelloToken])

  useEffect(() => {
    if (!credsReady) {
      setLists([])
      return
    }
    void loadLists(trelloBoardId)
  }, [credsReady, trelloBoardId])

  const changeHotkey = async (hotkey: string): Promise<void> => {
    setQuickAddHotkey(hotkey)
    await window.api.setQuickAddHotkey(hotkey)
  }

  const debounced = (timer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>, save: () => void): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(save, 500)
  }

  const changeBoard = async (boardId: string): Promise<void> => {
    setTrelloBoardId(boardId)
    setTrelloListId('')
    setListShortcuts([])
    await window.api.setTrelloBoardId(boardId)
    await window.api.setTrelloListId('')
    await window.api.setQuickAddListShortcuts([])
  }

  const changeList = async (listId: string): Promise<void> => {
    setTrelloListId(listId)
    await window.api.setTrelloListId(listId)
  }

  const persistShortcuts = (next: QuickAddListShortcut[]): void => {
    setListShortcuts(next)
    void window.api.setQuickAddListShortcuts(next)
  }

  const addShortcut = (): void => {
    const first = lists[0]
    if (first) persistShortcuts([...listShortcuts, { listId: first.id, listName: first.name }])
  }

  const changeShortcut = (index: number, listId: string): void => {
    const list = lists.find((item) => item.id === listId)
    if (!list) return
    const next = [...listShortcuts]
    next[index] = { listId: list.id, listName: list.name }
    persistShortcuts(next)
  }

  return <Section Icon={ListPlus} title="Quick add to Trello" right={<Badge variant={ready ? 'positive' : 'secondary'}>{ready ? 'Ready' : 'Needs setup'}</Badge>}>
    {web
      ? <SectionNote>Press Alt+N in an Ego tab to capture a title, a description, and pasted screenshots, then send it to this list. The server holds the Trello key.</SectionNote>
      : <>
        <SectionNote>Press the hotkey anywhere in Windows to capture a title, a description, and pasted screenshots, then send it straight to a Trello list.</SectionNote>
        <FieldLabel>Global hotkey</FieldLabel>
        <HotkeyInput value={quickAddHotkey} onChange={(hotkey) => void changeHotkey(hotkey)} />
      </>}

    {!web && <>
      <div className="mt-5 flex items-center justify-between border-t border-surface-800 pt-4">
        <span className="text-[15px] font-medium text-surface-200">Trello account</span>
        <button type="button" onClick={() => void window.api.openExternalUrl(TRELLO_TOKEN_DOCS)} className="text-[14px] font-semibold underline">Get key and token</button>
      </div>
      <FieldLabel htmlFor="trello-key">API key</FieldLabel>
      <input
        id="trello-key"
        type="password"
        value={trelloApiKey}
        onChange={(event) => {
          const value = event.target.value
          setTrelloApiKey(value)
          debounced(apiKeyTimerRef, () => void window.api.setTrelloApiKey(value))
        }}
        placeholder="32-character key"
        className={inputClass}
      />
      <FieldLabel htmlFor="trello-token">Token</FieldLabel>
      <input
        id="trello-token"
        type="password"
        value={trelloToken}
        onChange={(event) => {
          const value = event.target.value
          setTrelloToken(value)
          debounced(tokenTimerRef, () => void window.api.setTrelloToken(value))
        }}
        placeholder="Starts with ATTA"
        className={inputClass}
      />
      {trelloToken && !trelloToken.startsWith('ATTA') && <p className="mt-2 text-[14px] leading-5 text-attention">
        Trello tokens start with ATTA. A 64-character hex string is the OAuth secret, which will not authenticate.
      </p>}
    </>}

    <div className="mt-5 border-t border-surface-800 pt-1">
      <FieldLabel htmlFor="trello-board">Board</FieldLabel>
      <div className="flex gap-2">
        <select id="trello-board" value={trelloBoardId} onChange={(event) => void changeBoard(event.target.value)} disabled={!credsReady || boardsLoading} className={`${inputClass} disabled:opacity-50`}>
          <option value="">{credsReady ? 'Select a board…' : 'Add key and token first'}</option>
          {boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
        </select>
        <IconButton label="Refresh boards" onClick={() => void loadBoards()} disabled={!credsReady || boardsLoading} className="h-11 w-11 rounded-xl border border-input">
          <RefreshCw size={16} className={boardsLoading ? 'animate-spin' : ''} />
        </IconButton>
      </div>
      <FieldLabel htmlFor="trello-list">Default list</FieldLabel>
      <div className="flex gap-2">
        <select id="trello-list" value={trelloListId} onChange={(event) => void changeList(event.target.value)} disabled={!trelloBoardId || listsLoading} className={`${inputClass} disabled:opacity-50`}>
          <option value="">{trelloBoardId ? 'Select a list…' : 'Pick a board first'}</option>
          {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
        </select>
        <IconButton label="Refresh lists" onClick={() => void loadLists(trelloBoardId)} disabled={!trelloBoardId || listsLoading} className="h-11 w-11 rounded-xl border border-input">
          <RefreshCw size={16} className={listsLoading ? 'animate-spin' : ''} />
        </IconButton>
      </div>
      {trelloError && <p role="alert" className="mt-3 text-[14px] text-destructive">{trelloError}</p>}
    </div>

    {!web && lists.length > 0 && <div className="mt-5 border-t border-surface-800 pt-4">
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-medium text-surface-200">List shortcuts</span>
        {listShortcuts.length < 9 && <button type="button" onClick={addShortcut} className="text-[14px] font-semibold underline">Add</button>}
      </div>
      <SectionNote className="mt-1">Press Ctrl+1, Ctrl+2, and so on inside the capture window to send that card to a different list than the default.</SectionNote>
      {listShortcuts.length === 0
        ? <p className="mt-3 text-[14px] text-surface-500">No shortcuts yet. Add one to assign a list to Ctrl+1.</p>
        : <div className="mt-3 flex flex-col gap-2">
          {listShortcuts.map((shortcut, index) => <div key={index} className="flex items-center gap-2">
            <kbd className="w-16 shrink-0 rounded-lg border border-surface-700 bg-surface-900 px-2 py-2 text-center font-mono text-[13px] text-surface-300">Ctrl+{index + 1}</kbd>
            <select aria-label={`List for Ctrl+${index + 1}`} value={shortcut.listId} onChange={(event) => changeShortcut(index, event.target.value)} className={inputClass}>
              {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
            </select>
            <IconButton label={`Remove Ctrl+${index + 1}`} onClick={() => persistShortcuts(listShortcuts.filter((_, at) => at !== index))}>
              <X size={16} />
            </IconButton>
          </div>)}
        </div>}
    </div>}
  </Section>
}
