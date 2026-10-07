import type { RemoteApi, RemoteApiMethod } from '../platform/local'
import { createRemoteDatabase } from '../platform/remote-database'

export const remoteDatabase = createRemoteDatabase(() => window.api)

/** TypeScript cannot follow one generic method name through the union of signatures, hence the cast. */
function call<K extends RemoteApiMethod>(method: K): RemoteApi[K] {
  const forward = (...args: Parameters<RemoteApi[K]>): ReturnType<RemoteApi[K]> => window.api.apiCall(method, ...args)
  return forward as unknown as RemoteApi[K]
}

/** The Worker, reached through the main process, which holds the device token. */
export const remoteApi: RemoteApi = {
  session: call('session'),
  devices: call('devices'),
  revokeDevice: call('revokeDevice'),
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
  calendarData: call('calendarData'),
  calendarSync: call('calendarSync'),
  calendarConnect: call('calendarConnect'),
  calendarDisconnect: call('calendarDisconnect'),
  calendarCreate: call('calendarCreate'),
  calendarUpdate: call('calendarUpdate'),
  calendarDelete: call('calendarDelete'),
  calendarRestore: call('calendarRestore'),
  calendarRsvp: call('calendarRsvp'),
  calendarList: call('calendarList'),
  calendarSeries: call('calendarSeries'),
  calendarRange: call('calendarRange'),
  assistantChats: call('assistantChats'),
  assistantDeleteChat: call('assistantDeleteChat'),
  assistantMessages: call('assistantMessages'),
  foodAnalyze: call('foodAnalyze'),
  foodProduct: call('foodProduct'),
  trelloBoards: call('trelloBoards'),
  trelloLists: call('trelloLists'),
  trelloCard: call('trelloCard'),
  dockets: call('dockets'),
  docket: call('docket'),
  updateDocket: call('updateDocket'),
  deleteDocket: call('deleteDocket'),
  docketKeys: call('docketKeys'),
  createDocketKey: call('createDocketKey'),
  revokeDocketKey: call('revokeDocketKey'),
  agentKeys: call('agentKeys'),
  createAgentKey: call('createAgentKey'),
  revokeAgentKey: call('revokeAgentKey'),
  agentMemories: call('agentMemories'),
  addAgentMemory: call('addAgentMemory'),
  updateAgentMemory: call('updateAgentMemory'),
  deleteAgentMemory: call('deleteAgentMemory'),
  agentSettings: call('agentSettings'),
  saveAgentSettings: call('saveAgentSettings'),
  agentGoals: call('agentGoals'),
  createAgentGoal: call('createAgentGoal'),
  updateAgentGoal: call('updateAgentGoal'),
  deleteAgentGoal: call('deleteAgentGoal'),
  runAgentGoal: call('runAgentGoal'),
  agentRuns: call('agentRuns'),
  answerAgentProposal: call('answerAgentProposal'),
  agentInbox: call('agentInbox'),
  markAgentRead: call('markAgentRead'),
  agentNotifications: call('agentNotifications'),
  fireAgentRoutine: call('fireAgentRoutine'),
  webPushKey: call('webPushKey'),
  saveWebPushSubscription: call('saveWebPushSubscription'),
  deleteWebPushSubscription: call('deleteWebPushSubscription'),
  testWebPush: call('testWebPush'),
  composioStatus: call('composioStatus')
}
