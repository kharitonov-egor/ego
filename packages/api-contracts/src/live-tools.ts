import type { LiveToolName } from '@ego/core'

export interface LiveToolExecuteRequest {
  sessionId: string
  callId: string
  toolName: LiveToolName
  arguments: unknown
  approved?: boolean
}

export type LiveToolOutcome = 'succeeded' | 'rejected' | 'failed'

export interface LiveToolExecuteResult {
  callId: string
  toolName: LiveToolName
  outcome: LiveToolOutcome
  duplicate: boolean
  data?: unknown
  error?: { code: string; message: string }
}

export interface LiveLocalToolAuditRequest {
  sessionId: string
  callId: string
  toolName: 'trello_create_card'
  phase: 'start' | 'complete'
  approved: boolean
  outcome?: LiveToolOutcome
}

export interface ConnectorStatus {
  provider: 'google' | 'wispr'
  connected: boolean
  accountLabel: string | null
  scopes: string[]
  readOnly: true
  revoked: boolean
}

export interface GoogleConnectorStartResult {
  authorizationUrl: string
  expiresAt: string
}

export interface WisprConnectorStartInput {
  serverUrl: string
}

export interface LiveToolSessionInfo {
  sessionId: string
  enabledTools: LiveToolName[]
  expiresAt: string
}
