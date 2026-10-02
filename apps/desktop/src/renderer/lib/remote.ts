import type { RemoteApi, RemoteApiMethod } from '../../shared/local'
import { createRemoteDatabase } from '../../shared/remote-database'

export const remoteDatabase = createRemoteDatabase(() => window.api)

/** TypeScript cannot follow one generic method name through the union of signatures, hence the cast. */
function call<K extends RemoteApiMethod>(method: K): RemoteApi[K] {
  const forward = (...args: Parameters<RemoteApi[K]>): ReturnType<RemoteApi[K]> => window.api.apiCall(method, ...args)
  return forward as unknown as RemoteApi[K]
}

/** The Worker, reached through the main process, which holds the device token. */
export const remoteApi: RemoteApi = {
  session: call('session'),
  reference: call('reference'),
  transactions: call('transactions'),
  receipt: call('receipt'),
  balances: call('balances'),
  studyAssignments: call('studyAssignments'),
  markStudyAssignment: call('markStudyAssignment'),
  healthData: call('healthData'),
  healthSync: call('healthSync'),
  healthConnect: call('healthConnect'),
  healthDisconnect: call('healthDisconnect'),
  assistantChats: call('assistantChats'),
  assistantDeleteChat: call('assistantDeleteChat'),
  assistantMessages: call('assistantMessages'),
  assistantUndo: call('assistantUndo'),
  trelloBoards: call('trelloBoards'),
  trelloLists: call('trelloLists'),
  trelloCard: call('trelloCard')
}
