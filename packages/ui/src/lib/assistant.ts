import type { ApiResult, AssistantStreamEvent } from '@ego/api-contracts'
import type { AssistantStreamKind, AssistantStreamRequests } from '../../shared/local'

let streams = 0

/**
 * The phone's `api.assistantTurn` and `api.assistantConfirm`, which take a callback. The main
 * process holds the device token, so it runs the stream and sends each event back by ID.
 */
export async function assistantStream<K extends AssistantStreamKind>(
  kind: K, request: AssistantStreamRequests[K], onEvent: (event: AssistantStreamEvent) => void
): Promise<ApiResult<{ done: true }>> {
  streams += 1
  const streamId = `${Date.now().toString(36)}-${streams}`
  const unsubscribe = window.api.onAssistantEvent((message) => {
    if (message.streamId === streamId) onEvent(message.event)
  })
  try {
    return await window.api.assistantStream(streamId, kind, request)
  } catch {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Ego could not send that message' } }
  } finally {
    unsubscribe()
  }
}
