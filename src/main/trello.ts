import { net } from 'electron'
import { getTrelloApiKey, getTrelloToken } from './settings'
import type { TrelloBoardSummary, TrelloListSummary, TrelloResult } from '../shared/types'

const BASE = 'https://api.trello.com/1'

function hasCredentials(): boolean {
  return Boolean(getTrelloApiKey() && getTrelloToken())
}

function authQuery(): string {
  const key = getTrelloApiKey()
  const token = getTrelloToken()
  return `key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`
}

async function getJson<T>(url: string): Promise<TrelloResult<T>> {
  try {
    const response = await net.fetch(url, { method: 'GET' })
    const text = await response.text()
    if (!response.ok) {
      console.error(`[trello] GET ${url} -> ${response.status}: ${text}`)
      return { ok: false, detail: `HTTP ${response.status}: ${text.slice(0, 120)}` }
    }
    return { ok: true, data: JSON.parse(text) as T }
  } catch (err) {
    console.error('[trello] GET error', err)
    return { ok: false, detail: err instanceof Error ? err.message : 'Network error' }
  }
}

export async function listBoards(): Promise<TrelloResult<TrelloBoardSummary[]>> {
  if (!hasCredentials()) return { ok: false, detail: 'Trello API key or token not set' }
  return getJson<TrelloBoardSummary[]>(`${BASE}/members/me/boards?fields=name&${authQuery()}`)
}

export async function listLists(boardId: string): Promise<TrelloResult<TrelloListSummary[]>> {
  if (!boardId) return { ok: false, detail: 'Board id is empty' }
  if (!hasCredentials()) return { ok: false, detail: 'Trello API key or token not set' }
  return getJson<TrelloListSummary[]>(
    `${BASE}/boards/${encodeURIComponent(boardId)}/lists?fields=name&${authQuery()}`
  )
}

export interface CreateCardInput {
  name: string
  desc: string
  idList: string
}

export interface CreatedCard {
  id: string
  shortUrl: string
}

export async function createCard(input: CreateCardInput): Promise<TrelloResult<CreatedCard>> {
  if (!hasCredentials()) return { ok: false, detail: 'Trello API key or token not set' }
  try {
    const response = await net.fetch(`${BASE}/cards?${authQuery()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.name,
        desc: input.desc,
        idList: input.idList
      })
    })
    const text = await response.text()
    if (!response.ok) {
      console.error(`[trello] createCard -> ${response.status}: ${text}`)
      return { ok: false, detail: `HTTP ${response.status}: ${text.slice(0, 120)}` }
    }
    const parsed = JSON.parse(text) as CreatedCard
    return { ok: true, data: { id: parsed.id, shortUrl: parsed.shortUrl } }
  } catch (err) {
    console.error('[trello] createCard error', err)
    return { ok: false, detail: err instanceof Error ? err.message : 'Network error' }
  }
}

export async function addAttachmentToCard(
  cardId: string,
  imageBytes: Uint8Array,
  filename: string,
  mimeType: string
): Promise<TrelloResult<void>> {
  if (!hasCredentials()) return { ok: false, detail: 'Trello API key or token not set' }
  try {
    const form = new FormData()
    const ab = imageBytes.buffer.slice(
      imageBytes.byteOffset,
      imageBytes.byteOffset + imageBytes.byteLength
    ) as ArrayBuffer
    form.append('file', new Blob([ab], { type: mimeType }), filename)

    const response = await net.fetch(
      `${BASE}/cards/${encodeURIComponent(cardId)}/attachments?${authQuery()}`,
      { method: 'POST', body: form }
    )
    const text = await response.text()
    if (!response.ok) {
      console.error(`[trello] addAttachment -> ${response.status}: ${text}`)
      return { ok: false, detail: `HTTP ${response.status}: ${text.slice(0, 120)}` }
    }
    return { ok: true }
  } catch (err) {
    console.error('[trello] addAttachment error', err)
    return { ok: false, detail: err instanceof Error ? err.message : 'Network error' }
  }
}
