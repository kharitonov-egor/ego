// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { LiveSessionController, appendTranscript, type LiveSessionStatus } from './LiveSessionController'
import type { LiveCreateSessionResult } from '../../shared/types'
import type { LiveToolExecuteRequest, LiveToolExecuteResult } from '@ego/api-contracts'

class FakeTrack {
  enabled = true
  stopped = false
  stop(): void { this.stopped = true }
}

class FakeStream {
  readonly track = new FakeTrack()
  getTracks(): FakeTrack[] { return [this.track] }
  getAudioTracks(): FakeTrack[] { return [this.track] }
}

class FakeChannel extends EventTarget {
  readyState: RTCDataChannelState = 'open'
  sent: string[] = []
  send(data: string): void { this.sent.push(data) }
  close(): void {
    this.readyState = 'closed'
    this.dispatchEvent(new Event('close'))
  }
  receive(event: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }))
  }
}

class FakePeer extends EventTarget {
  readonly channel = new FakeChannel()
  iceGatheringState: RTCIceGatheringState = 'complete'
  connectionState: RTCPeerConnectionState = 'new'
  localDescription: RTCSessionDescriptionInit | null = null
  remoteDescription: RTCSessionDescriptionInit | null = null
  closed = false
  order: string[] = []
  createDataChannel(label: string): RTCDataChannel {
    this.order.push(`channel:${label}`)
    return this.channel as unknown as RTCDataChannel
  }
  addTrack(): RTCRtpSender {
    this.order.push('track')
    return {} as RTCRtpSender
  }
  addTransceiver(): RTCRtpTransceiver {
    this.order.push('transceiver:audio')
    return {} as RTCRtpTransceiver
  }
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.order.push('offer')
    return { type: 'offer', sdp: 'offer-sdp' }
  }
  async setLocalDescription(value: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = value
  }
  async setRemoteDescription(value: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = value
  }
  close(): void {
    this.closed = true
    this.connectionState = 'closed'
  }
  fail(): void {
    this.connectionState = 'failed'
    this.dispatchEvent(new Event('connectionstatechange'))
  }
}

function setup(
  result: LiveCreateSessionResult = { ok: true, sessionId: 'live_1', sdp: 'answer-sdp' },
  executeTool?: (input: LiveToolExecuteRequest) => Promise<{
    ok: true; data: LiveToolExecuteResult
  } | { ok: false; code: string; message: string }>
) {
  const peer = new FakePeer()
  const stream = new FakeStream()
  const statuses: Array<{ status: LiveSessionStatus; message?: string }> = []
  const transcripts: ReturnType<typeof appendTranscript>[] = []
  const approvals: unknown[] = []
  const activities: unknown[] = []
  const getUserMedia = vi.fn(async () => stream as unknown as MediaStream)
  const audio = {
    srcObject: null,
    play: vi.fn(async () => undefined),
    pause: vi.fn()
  } as unknown as HTMLAudioElement
  const controller = new LiveSessionController({
    audio,
    onStatus: (status, message) => statuses.push({ status, message }),
    onTranscript: (messages) => transcripts.push(messages),
    onApproval: (approval) => approvals.push(approval),
    onToolActivity: (activity) => activities.push(activity),
    createSession: vi.fn(async () => result),
    executeTool,
    getUserMedia,
    createPeerConnection: () => peer as unknown as RTCPeerConnection
  })
  return { controller, peer, stream, statuses, transcripts, audio, approvals, activities, getUserMedia }
}

describe('LiveSessionController', () => {
  it('creates the event channel before the offer and waits for session.started', async () => {
    const { controller, peer, statuses } = setup()
    await controller.start()
    expect(peer.order).toEqual(['track', 'channel:oai-events', 'offer'])
    expect(peer.remoteDescription).toEqual({ type: 'answer', sdp: 'answer-sdp' })
    expect(statuses.map((entry) => entry.status)).toEqual(['permission', 'connecting'])
    peer.channel.receive({ type: 'session.started', session: { id: 'live_1' } })
    expect(statuses.at(-1)?.status).toBe('listening')
  })

  it('assembles input and output transcript deltas in delivery order', async () => {
    const { controller, peer, transcripts, statuses } = setup()
    await controller.start()
    peer.channel.receive({ type: 'session.started' })
    peer.channel.receive({ type: 'session.input_transcript.delta', delta: 'Hello' })
    peer.channel.receive({ type: 'session.input_transcript.delta', delta: ' there' })
    peer.channel.receive({ type: 'session.output_transcript.delta', delta: 'Hi.' })
    expect(transcripts.at(-1)).toEqual([
      { id: 1, role: 'user', text: 'Hello there' },
      { id: 2, role: 'assistant', text: 'Hi.' }
    ])
    expect(statuses.at(-1)?.status).toBe('speaking')
  })

  it('mutes and unmutes both the track and the Live input', async () => {
    const { controller, peer, stream, statuses } = setup()
    await controller.start()
    peer.channel.receive({ type: 'session.started' })
    controller.toggleMute()
    expect(stream.track.enabled).toBe(false)
    expect(JSON.parse(peer.channel.sent.at(-1) ?? '{}').type).toBe('session.input_audio.mute')
    expect(statuses.at(-1)?.status).toBe('muted')
    controller.toggleMute()
    expect(stream.track.enabled).toBe(true)
    expect(JSON.parse(peer.channel.sent.at(-1) ?? '{}').type).toBe('session.input_audio.unmute')
  })

  it.each(['session.closed', 'error', 'connection-failed'])(
    'cleans up on %s', async (terminal) => {
      const { controller, peer, stream, statuses, audio } = setup()
      await controller.start()
      peer.channel.receive({ type: 'session.started' })
      if (terminal === 'session.closed') peer.channel.receive({ type: 'session.closed' })
      if (terminal === 'error') peer.channel.receive({ type: 'error', error: { message: 'Server stopped' } })
      if (terminal === 'connection-failed') peer.fail()
      expect(stream.track.stopped).toBe(true)
      expect(peer.closed).toBe(true)
      expect((audio as HTMLAudioElement).srcObject).toBeNull()
      expect(statuses.at(-1)?.status).toBe(terminal === 'session.closed' ? 'ended' : 'error')
    }
  )

  it('cleans up after a session creation failure and sends session.close on End', async () => {
    const failed = setup({ ok: false as const, code: 'RATE_LIMITED', message: 'Try later.' })
    await failed.controller.start()
    expect(failed.statuses.at(-1)).toEqual({ status: 'error', message: 'Try later.' })
    expect(failed.stream.track.stopped).toBe(true)

    const active = setup()
    await active.controller.start()
    active.peer.channel.receive({ type: 'session.started' })
    active.controller.end()
    expect(active.peer.channel.sent.map((item) => JSON.parse(item).type)).toContain('session.close')
    expect(active.stream.track.stopped).toBe(true)
    expect(active.statuses.at(-1)?.status).toBe('ended')
  })

  it('assembles nested function arguments and executes a read once', async () => {
    const execute = vi.fn(async (input: LiveToolExecuteRequest) => ({
      ok: true as const,
      data: {
        callId: input.callId,
        toolName: input.toolName,
        outcome: 'succeeded' as const,
        duplicate: false,
        data: { accounts: [] }
      }
    }))
    const { controller, peer } = setup(undefined, execute)
    await controller.start()
    peer.channel.receive({ type: 'session.started' })
    peer.channel.receive({
      type: 'response.event', delegation_id: 'delegation-1',
      event: { type: 'response.output_item.added', item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'ego_list_accounts' } }
    })
    peer.channel.receive({
      type: 'response.event', delegation_id: 'delegation-1',
      event: { type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: '{' }
    })
    peer.channel.receive({
      type: 'response.event', delegation_id: 'delegation-1',
      event: { type: 'response.function_call_arguments.done', item_id: 'item-1', arguments: '{}' }
    })
    peer.channel.receive({
      type: 'response.event', delegation_id: 'delegation-1',
      event: { type: 'response.output_item.done', item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'ego_list_accounts', arguments: '{}' } }
    })
    peer.channel.receive({
      type: 'response.event', delegation_id: 'delegation-1',
      event: { type: 'response.completed' }
    })
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      sessionId: 'live_1', callId: 'call-1', toolName: 'ego_list_accounts', arguments: {}
    })
    await vi.waitFor(() => {
      const events = peer.channel.sent.map((value) => JSON.parse(value))
      expect(events.some((event) => event.type === 'response.item.create' && event.item.call_id === 'call-1')).toBe(true)
      expect(events.some((event) => event.type === 'response.create')).toBe(true)
    })
  })

  it('waits for a button press before running a write', async () => {
    const execute = vi.fn(async (input: LiveToolExecuteRequest) => ({
      ok: true as const,
      data: {
        callId: input.callId, toolName: input.toolName, outcome: 'rejected' as const,
        duplicate: false, data: { rejected: true }
      }
    }))
    const { controller, peer, approvals } = setup(undefined, execute)
    await controller.start()
    peer.channel.receive({ type: 'session.started' })
    const args = JSON.stringify({
      kind: 'expense', accountId: 'checking', categoryId: 'food', amountCents: 500,
      destinationAccountId: null, date: '2026-09-15', merchant: 'Cafe', notes: null
    })
    peer.channel.receive({
      type: 'response.event', delegation_id: 'delegation-write',
      event: { type: 'response.output_item.done', item: { type: 'function_call', id: 'write-item', call_id: 'write-call', name: 'ego_record_transaction', arguments: args } }
    })
    expect(execute).not.toHaveBeenCalled()
    expect(approvals.at(-1)).toMatchObject({ callId: 'write-call', toolName: 'ego_record_transaction' })
    controller.reject('write-call')
    await vi.waitFor(() => expect(execute).toHaveBeenCalledWith(expect.objectContaining({ approved: false })))
  })

  it('sends typed messages without requesting microphone access', async () => {
    const { controller, peer, getUserMedia, transcripts, statuses } = setup()
    await controller.start('chat')
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(peer.order).toEqual(['transceiver:audio', 'channel:oai-events', 'offer'])
    peer.channel.receive({ type: 'session.started' })
    expect(statuses.at(-1)?.status).toBe('chat-ready')
    controller.sendText('Find my last receipt')
    expect(transcripts.at(-1)?.at(-1)).toMatchObject({ role: 'user', text: 'Find my last receipt' })
    const sent = peer.channel.sent.map((value) => JSON.parse(value))
    expect(sent.at(-2)).toMatchObject({ type: 'response.item.create', item: { role: 'user' } })
    peer.channel.receive({
      type: 'response.event', delegation_id: 'chat-1',
      event: { type: 'response.output_text.delta', delta: 'Found it.' }
    })
    expect(transcripts.at(-1)?.at(-1)).toMatchObject({ role: 'assistant', text: 'Found it.' })
  })
})
