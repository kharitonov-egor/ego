import type {
  ConnectorStatus, LiveLocalToolAuditRequest, LiveToolExecuteRequest, LiveToolExecuteResult
} from '@ego/api-contracts'
import { DEFAULT_LIVE_PREFERENCES, isLivePreferences, validateLiveToolArguments, type LivePreferences } from '@ego/core'
import type { DesktopApiResult, LiveCreateSessionResult } from '@ego/ui/platform/types'
import { currentSession, ledgerApi } from './ledger'
import { getPreference, setPreference } from './session'

const LIVE_PREFERENCES = 'live-preferences'
export const TRELLO_BOARD = 'trello-board'
export const TRELLO_LIST = 'trello-list'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getLivePreferences(): LivePreferences {
  try {
    const stored: unknown = JSON.parse(getPreference(LIVE_PREFERENCES) ?? 'null')
    if (isLivePreferences(stored)) return stored
  } catch {
    // An unreadable value falls back to the defaults.
  }
  return { ...DEFAULT_LIVE_PREFERENCES }
}

export function setLivePreferences(preferences: LivePreferences): LivePreferences {
  if (!isLivePreferences(preferences)) return getLivePreferences()
  setPreference(LIVE_PREFERENCES, JSON.stringify(preferences))
  return preferences
}

function connection(): { url: string; token: string } | null {
  const session = currentSession()
  return session?.apiUrl && session.token ? { url: session.apiUrl.replace(/\/+$/, ''), token: session.token } : null
}

async function workerRequest<T>(path: string, method: string, body?: unknown): Promise<DesktopApiResult<T>> {
  const server = connection()
  if (!server) return { ok: false, code: 'NOT_CONFIGURED', message: 'Sign in to Ego first.' }
  let response: Response
  try {
    response = await fetch(`${server.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${server.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(25_000)
    })
  } catch {
    return { ok: false, code: 'OFFLINE', message: 'The Ego service is unreachable.' }
  }
  let payload: unknown
  try { payload = await response.json() } catch {
    return { ok: false, code: 'SERVER_ERROR', message: 'The Ego service returned an unreadable response.' }
  }
  if (response.ok && isRecord(payload) && payload.ok === true && 'data' in payload) {
    return { ok: true, data: payload.data as T }
  }
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null
  return {
    ok: false,
    code: typeof error?.code === 'string' ? error.code : 'SERVER_ERROR',
    message: typeof error?.message === 'string' ? error.message : `The Ego service returned HTTP ${response.status}.`
  }
}

export async function createLiveSession(sdp: string): Promise<LiveCreateSessionResult> {
  const server = connection()
  if (!server) return { ok: false, code: 'NOT_CONFIGURED', message: 'Sign in to Ego first.' }
  if (!sdp.trim()) return { ok: false, code: 'INVALID_REQUEST', message: 'The voice connection offer is missing.' }
  let response: Response
  try {
    response = await fetch(`${server.url}/v1/live/sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        sdp,
        settings: getLivePreferences(),
        trello: { boardId: getPreference(TRELLO_BOARD) ?? '', listId: getPreference(TRELLO_LIST) ?? '' }
      }),
      signal: AbortSignal.timeout(20_000)
    })
  } catch {
    return { ok: false, code: 'OFFLINE', message: 'The Ego service is unreachable.' }
  }
  let body: unknown
  try { body = await response.json() } catch {
    return { ok: false, code: 'SERVER_ERROR', message: 'The Ego service returned an unreadable response.' }
  }
  if (response.ok && isRecord(body) && typeof body.sessionId === 'string' && typeof body.sdp === 'string') {
    return { ok: true, sessionId: body.sessionId, sdp: body.sdp }
  }
  const error = isRecord(body) && isRecord(body.error) ? body.error : null
  return {
    ok: false,
    code: typeof error?.code === 'string' ? error.code : 'SERVER_ERROR',
    message: typeof error?.message === 'string' ? error.message : `Voice session creation failed with HTTP ${response.status}.`
  }
}

const localToolResults = new Map<string, LiveToolExecuteResult>()

/**
 * The desktop creates voice Trello cards with its own key, so the Worker treats them as a local
 * tool. A browser has no key and asks the Worker to create the card, inside the same audit.
 */
async function executeTrello(input: LiveToolExecuteRequest): Promise<DesktopApiResult<LiveToolExecuteResult>> {
  const existing = localToolResults.get(input.callId)
  if (existing) return { ok: true, data: { ...existing, duplicate: true } }
  const validated = validateLiveToolArguments('trello_create_card', input.arguments)
  if (!validated.ok) return { ok: false, code: 'INVALID_TOOL_ARGUMENTS', message: validated.error }
  const args = validated.value
  const audit = (phase: 'start' | 'complete', outcome?: LiveToolExecuteResult['outcome']): Promise<DesktopApiResult<LiveToolExecuteResult>> =>
    workerRequest<LiveToolExecuteResult>('/v1/live/tools/audit-local', 'POST', {
      sessionId: input.sessionId,
      callId: input.callId,
      toolName: 'trello_create_card',
      phase,
      approved: input.approved === true,
      ...(outcome ? { outcome } : {})
    } satisfies LiveLocalToolAuditRequest)
  const started = await audit('start')
  if (!started.ok) return started
  if (started.data.duplicate) return { ok: true, data: started.data }
  if (input.approved !== true) {
    const rejected: LiveToolExecuteResult = {
      callId: input.callId, toolName: 'trello_create_card', outcome: 'rejected', duplicate: false, data: { rejected: true }
    }
    localToolResults.set(input.callId, rejected)
    return { ok: true, data: rejected }
  }
  if (args.boardId !== getPreference(TRELLO_BOARD) || args.listId !== getPreference(TRELLO_LIST)) {
    return { ok: false, code: 'TRELLO_DESTINATION_DENIED', message: 'Choose the Trello board and list saved in Settings.' }
  }
  const created = await ledgerApi().trelloCard({
    listId: String(args.listId),
    title: String(args.title),
    description: typeof args.description === 'string' ? args.description : ''
  })
  const output: LiveToolExecuteResult = created.ok
    ? { callId: input.callId, toolName: 'trello_create_card', outcome: 'succeeded', duplicate: false, data: created.data }
    : {
      callId: input.callId, toolName: 'trello_create_card', outcome: 'failed', duplicate: false,
      error: { code: 'TRELLO_FAILED', message: created.error.message }
    }
  localToolResults.set(input.callId, output)
  await audit('complete', output.outcome)
  if (localToolResults.size > 500) localToolResults.delete(localToolResults.keys().next().value ?? '')
  return { ok: true, data: output }
}

export function executeLiveTool(input: LiveToolExecuteRequest): Promise<DesktopApiResult<LiveToolExecuteResult>> {
  if (input.toolName === 'trello_create_card') return executeTrello(input)
  return workerRequest('/v1/live/tools/execute', 'POST', input)
}

export function connectorStatus(provider: 'google' | 'wispr'): Promise<DesktopApiResult<ConnectorStatus>> {
  return workerRequest(`/v1/connectors/${provider}/status`, 'GET')
}

export function startGoogleConnector(): Promise<DesktopApiResult<{ authorizationUrl: string; expiresAt: string }>> {
  return workerRequest('/v1/connectors/google/start', 'POST', {})
}

export function startWisprConnector(serverUrl: string): Promise<DesktopApiResult<{ authorizationUrl: string; expiresAt: string }>> {
  return workerRequest('/v1/connectors/wispr/start', 'POST', { serverUrl })
}

export function disconnectConnector(provider: 'google' | 'wispr'): Promise<DesktopApiResult<{ disconnected: true }>> {
  return workerRequest(`/v1/connectors/${provider}`, 'DELETE')
}
