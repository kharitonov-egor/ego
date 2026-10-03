import { describe, expect, it, vi } from 'vitest'
import type { AssistantConfirmRequest, AssistantStreamEvent, AssistantTurnRequest } from '@ego/api-contracts'
import type { AssistantEventHandler } from '@ego/local/api-client'
import type { AssistantStreamMessage } from '../../shared/local'
import { parseConfirmRequest, parseTurnRequest, streamAssistant } from './assistant'

const turn: AssistantTurnRequest = {
  chatId: null, text: 'Publix $42', today: '2026-10-02', timeZone: 'America/New_York', units: 'imperial'
}

const confirm: AssistantConfirmRequest = {
  chatId: 'chat-1', callId: 'call-1', approved: true, today: '2026-10-02', timeZone: null, units: null
}

function fakeApi(events: AssistantStreamEvent[]) {
  const play = async (onEvent: AssistantEventHandler) => {
    for (const event of events) onEvent(event)
    return { ok: true as const, data: { done: true as const } }
  }
  return {
    assistantTurn: vi.fn((_request: AssistantTurnRequest, onEvent: AssistantEventHandler) => play(onEvent)),
    assistantConfirm: vi.fn((_request: AssistantConfirmRequest, onEvent: AssistantEventHandler) => play(onEvent))
  }
}

describe('assistant requests from the window', () => {
  it('keeps only the fields the Worker reads', () => {
    expect(parseTurnRequest({ ...turn, extra: 'dropped' })).toEqual(turn)
    expect(parseTurnRequest({ ...turn, text: '', image: { base64: 'aGk=', mimeType: 'image/jpeg' } }))
      .toEqual({ ...turn, text: '', image: { base64: 'aGk=', mimeType: 'image/jpeg' } })
    expect(parseConfirmRequest({ ...confirm, extra: 1 })).toEqual(confirm)
  })

  it('turns away malformed requests', () => {
    expect(parseTurnRequest({ ...turn, text: '   ' })).toBeNull()
    expect(parseTurnRequest({ ...turn, text: 'x'.repeat(4001) })).toBeNull()
    expect(parseTurnRequest({ ...turn, today: 'yesterday' })).toBeNull()
    expect(parseTurnRequest({ ...turn, units: 'stone' })).toBeNull()
    expect(parseTurnRequest({ ...turn, chatId: 42 })).toBeNull()
    expect(parseTurnRequest({ ...turn, image: { base64: 1, mimeType: 'image/jpeg' } })).toBeNull()
    expect(parseConfirmRequest({ ...confirm, approved: 'yes' })).toBeNull()
    expect(parseConfirmRequest({ ...confirm, callId: '' })).toBeNull()
    expect(parseConfirmRequest(null)).toBeNull()
  })
})

describe('streaming an assistant reply', () => {
  it('forwards every event under the stream ID and settles with the result', async () => {
    const events: AssistantStreamEvent[] = [{ type: 'delta', text: 'Saved' }, { type: 'trail', line: 'Read mood for yesterday' }]
    const api = fakeApi(events)
    const sent: AssistantStreamMessage[] = []
    const result = await streamAssistant(api, 'stream-1', 'turn', turn, (message) => sent.push(message))
    expect(result).toEqual({ ok: true, data: { done: true } })
    expect(sent).toEqual(events.map((event) => ({ streamId: 'stream-1', event })))
    expect(api.assistantTurn).toHaveBeenCalledWith(turn, expect.any(Function))
  })

  it('sends a confirmation to the confirm call', async () => {
    const api = fakeApi([{ type: 'done' }])
    await streamAssistant(api, 'stream-2', 'confirm', confirm, () => undefined)
    expect(api.assistantConfirm).toHaveBeenCalledWith(confirm, expect.any(Function))
    expect(api.assistantTurn).not.toHaveBeenCalled()
  })

  it('refuses a bad stream ID, kind, or request before calling the Worker', () => {
    const api = fakeApi([])
    expect(() => streamAssistant(api, '../x', 'turn', turn, () => undefined)).toThrow()
    expect(() => streamAssistant(api, 'stream-3', 'undo', turn, () => undefined)).toThrow()
    expect(() => streamAssistant(api, 'stream-3', 'confirm', turn, () => undefined)).toThrow()
    expect(api.assistantTurn).not.toHaveBeenCalled()
    expect(api.assistantConfirm).not.toHaveBeenCalled()
  })
})
