import { net } from 'electron'
import { getLedgerConfig, getLedgerToken, getLivePreferences } from './settings'
import type { LiveCreateSessionResult } from '../shared/types'
import type { DesktopApiResult } from '../shared/types'
import type {
  ConnectorStatus,
  LiveLocalToolAuditRequest,
  LiveToolExecuteRequest,
  LiveToolExecuteResult
} from '@ego/api-contracts'
import { validateLiveToolArguments } from '@ego/core'
import { trello } from './trello'
import { getTrelloBoardId, getTrelloListId } from './settings'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function createLiveSession(sdp: string): Promise<LiveCreateSessionResult> {
  const config = getLedgerConfig()
  const token = getLedgerToken()
  if (!config.url || !token) {
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      message: 'Add the Ego service address and device token in Settings.'
    }
  }
  if (typeof sdp !== 'string' || !sdp.trim()) {
    return { ok: false, code: 'INVALID_REQUEST', message: 'The voice connection offer is missing.' }
  }

  let response: Response
  try {
    response = await net.fetch(`${config.url.replace(/\/+$/, '')}/v1/live/sessions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sdp,
        settings: getLivePreferences(),
        trello: { boardId: getTrelloBoardId(), listId: getTrelloListId() }
      }),
      signal: AbortSignal.timeout(20_000)
    })
  } catch {
    return { ok: false, code: 'OFFLINE', message: 'The Ego service is unreachable.' }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, code: 'SERVER_ERROR', message: 'The Ego service returned an unreadable response.' }
  }
  if (response.ok && isRecord(body) && typeof body.sessionId === 'string' && typeof body.sdp === 'string') {
    return { ok: true, sessionId: body.sessionId, sdp: body.sdp }
  }
  const error = isRecord(body) && isRecord(body.error) ? body.error : null
  const code = typeof error?.code === 'string' ? error.code : 'SERVER_ERROR'
  const message = typeof error?.message === 'string'
    ? error.message
    : `Voice session creation failed with HTTP ${response.status}.`
  return { ok: false, code, message }
}

async function workerRequest<T>(path: string, method: string, body?: unknown): Promise<DesktopApiResult<T>> {
  const config = getLedgerConfig()
  const token = getLedgerToken()
  if (!config.url || !token) return { ok: false, code: 'NOT_CONFIGURED', message: 'Connect the Ego service first.' }
  let response: Response
  try {
    response = await net.fetch(`${config.url.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
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

const localToolResults = new Map<string, LiveToolExecuteResult>()

async function executeTrello(input: LiveToolExecuteRequest): Promise<DesktopApiResult<LiveToolExecuteResult>> {
  const existing = localToolResults.get(input.callId)
  if (existing) return { ok: true, data: { ...existing, duplicate: true } }
  const validated = validateLiveToolArguments('trello_create_card', input.arguments)
  if (!validated.ok) return { ok: false, code: 'INVALID_TOOL_ARGUMENTS', message: validated.error }
  const args = validated.value
  const started = await workerRequest<LiveToolExecuteResult>('/v1/live/tools/audit-local', 'POST', {
    sessionId: input.sessionId,
    callId: input.callId,
    toolName: 'trello_create_card',
    phase: 'start',
    approved: input.approved === true
  } satisfies LiveLocalToolAuditRequest)
  if (!started.ok) return started
  if (started.data.duplicate) return { ok: true, data: started.data }
  if (input.approved !== true) {
    const rejected: LiveToolExecuteResult = {
      callId: input.callId, toolName: 'trello_create_card', outcome: 'rejected', duplicate: false,
      data: { rejected: true }
    }
    localToolResults.set(input.callId, rejected)
    return { ok: true, data: rejected }
  }
  if (args.boardId !== getTrelloBoardId() || args.listId !== getTrelloListId()) {
    return { ok: false, code: 'TRELLO_DESTINATION_DENIED', message: 'Choose the Trello board and list saved in Settings.' }
  }
  const result = await trello.createCard({
    idList: String(args.listId),
    name: String(args.title),
    desc: typeof args.description === 'string' ? args.description : ''
  })
  const output: LiveToolExecuteResult = result.ok
    ? { callId: input.callId, toolName: 'trello_create_card', outcome: 'succeeded', duplicate: false, data: result.data }
    : { callId: input.callId, toolName: 'trello_create_card', outcome: 'failed', duplicate: false, error: { code: 'TRELLO_FAILED', message: result.detail ?? 'Trello could not create the card.' } }
  localToolResults.set(input.callId, output)
  await workerRequest<LiveToolExecuteResult>('/v1/live/tools/audit-local', 'POST', {
    sessionId: input.sessionId,
    callId: input.callId,
    toolName: 'trello_create_card',
    phase: 'complete',
    approved: true,
    outcome: output.outcome
  } satisfies LiveLocalToolAuditRequest)
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
