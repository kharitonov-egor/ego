import type {
  AssistantConfirmRequest, AssistantStreamEvent, AssistantTurnRequest, MediaScope
} from '@ego/api-contracts'
import type { EgoApi } from '@ego/local/api-client'
import type { SyncOutcome, Touched } from '@ego/local/sync/coordinator'

/**
 * The Worker calls a screen may make through the main process. Uploads, media URLs, and the
 * auth header stay out, so the device token never reaches the renderer.
 */
export const REMOTE_API_METHODS = [
  'session',
  'devices',
  'revokeDevice',
  'reference',
  'transactions',
  'receipt',
  'balances',
  'studyAssignments',
  'markStudyAssignment',
  'healthData',
  'healthSync',
  'healthConnect',
  'healthDisconnect',
  'calendarData',
  'calendarSync',
  'calendarConnect',
  'calendarDisconnect',
  'calendarCreate',
  'calendarUpdate',
  'calendarDelete',
  'calendarRestore',
  'calendarRsvp',
  'calendarList',
  'calendarSeries',
  'calendarRange',
  'assistantChats',
  'assistantDeleteChat',
  'assistantMessages',
  'foodAnalyze',
  'foodProduct',
  'trelloBoards',
  'trelloLists',
  'trelloCard',
  'dockets',
  'docket',
  'updateDocket',
  'deleteDocket',
  'docketKeys',
  'createDocketKey',
  'revokeDocketKey',
  'agentKeys',
  'createAgentKey',
  'revokeAgentKey',
  'agentMemories',
  'addAgentMemory',
  'updateAgentMemory',
  'deleteAgentMemory',
  'agentSettings',
  'saveAgentSettings',
  'agentGoals',
  'createAgentGoal',
  'updateAgentGoal',
  'deleteAgentGoal',
  'runAgentGoal',
  'agentRuns',
  'answerAgentProposal',
  'agentInbox',
  'markAgentRead',
  'agentNotifications',
  'fireAgentRoutine'
] as const

export type RemoteApiMethod = typeof REMOTE_API_METHODS[number]

export type RemoteApi = Pick<EgoApi, RemoteApiMethod>

export function isRemoteApiMethod(value: unknown): value is RemoteApiMethod {
  return typeof value === 'string' && (REMOTE_API_METHODS as readonly string[]).includes(value)
}

export interface SignedInAccount {
  email: string | null
  deviceId: string
  deviceName: string
}

export interface LedgerState {
  /** This computer holds a device token, so it keeps and syncs its own copy of the ledger. */
  signedIn: boolean
  apiUrl: string
  account: SignedInAccount | null
  /** The local copy holds a complete download and screens can read it. */
  ready: boolean
  /** That download is in the current format. */
  current: boolean
  syncing: boolean
  status: SyncOutcome | null
  /** Why the local database did not open. Screens cannot read anything while it is set. */
  error: string | null
  /** Why the last sync stopped, when it was not the network. The data on this computer still works. */
  syncError: string | null
}

export interface LedgerEvent {
  state: LedgerState
  /** What a finished sync changed, so screens re-read only their own data. Null for other updates. */
  touched: Touched | null
  /** The database was closed and opened again, for another account or server. */
  reopened: boolean
}

export type SignInOutcome =
  | { ok: true }
  | { ok: false; message: string }

/** A file picked, pasted, or dropped in the renderer, on its way into the upload queue. */
export interface MediaFileInput {
  mediaId: string
  fileName: string | null
  mimeType: string
  data: ArrayBuffer
}

/** A file already on disk, such as a video dropped from Explorer. */
export interface MediaPathInput {
  mediaId: string
  path: string
  fileName: string | null
  mimeType: string
}

/** Where the main process keeps the file. The renderer queues the upload with this path. */
export interface StagedMedia {
  localUri: string
  size: number
}

export interface MediaOpenInput {
  mediaId: string
  scope: MediaScope
  fileName: string | null
  mimeType: string
}

export interface MediaProgress {
  mediaId: string
  /** Between 0 and 1 while sending; null once the attempt is over. */
  share: number | null
}

/** A Windows notification from a screen. A click brings Ego forward and opens `route`. */
export interface NotifyInput {
  title: string
  body: string
  route?: string
  silent?: boolean
}

export type AssistantStreamKind = 'turn' | 'confirm'

export interface AssistantStreamRequests {
  turn: AssistantTurnRequest
  confirm: AssistantConfirmRequest
}

/** One line of a streamed assistant reply, tagged with the call it belongs to. */
export interface AssistantStreamMessage {
  streamId: string
  event: AssistantStreamEvent
}
