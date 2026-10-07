import type { DesktopApiResult, LiveCreateSessionResult } from '../platform/types'
import {
  LIVE_TOOL_REGISTRY,
  isLiveToolName,
  validateLiveToolArguments,
  type LiveToolName
} from '@ego/core'
import type { LiveToolExecuteResult } from '@ego/api-contracts'

export type LiveSessionStatus =
  | 'idle'
  | 'permission'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'muted'
  | 'chat-ready'
  | 'thinking'
  | 'tool'
  | 'approval'
  | 'ended'
  | 'error'

export interface TranscriptMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
}

interface LiveEvent {
  type?: string
  delta?: string
  error?: { message?: string }
  delegation_id?: string
  event?: Record<string, unknown>
}

export type LiveSessionMode = 'voice' | 'chat'

export interface LiveToolActivity {
  toolName: LiveToolName
  callId: string
  state: 'running' | 'failed'
  message?: string
}

export interface LiveToolApproval {
  toolName: Extract<LiveToolName, 'ego_record_transaction' | 'trello_create_card'>
  callId: string
  arguments: Record<string, unknown>
  summary: string
}

interface PendingFunction {
  callId: string
  itemId: string | null
  name: string
  arguments: string
  delegationId: string
}

interface DelegationState {
  responseDone: boolean
  pendingCalls: Set<string>
  outputCount: number
}

interface ControllerOptions {
  audio: HTMLAudioElement
  onStatus: (status: LiveSessionStatus, message?: string) => void
  onTranscript: (messages: TranscriptMessage[]) => void
  onToolActivity?: (activity: LiveToolActivity | null) => void
  onApproval?: (approval: LiveToolApproval | null) => void
  createSession?: (sdp: string) => Promise<LiveCreateSessionResult>
  executeTool?: (input: import('@ego/api-contracts').LiveToolExecuteRequest) =>
    Promise<DesktopApiResult<LiveToolExecuteResult>>
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  createPeerConnection?: () => RTCPeerConnection
}

export function appendTranscript(
  messages: TranscriptMessage[], role: TranscriptMessage['role'], delta: string
): TranscriptMessage[] {
  if (!delta) return messages
  const last = messages[messages.length - 1]
  if (last?.role === role) {
    return [...messages.slice(0, -1), { ...last, text: last.text + delta }]
  }
  return [...messages, { id: (last?.id ?? 0) + 1, role, text: delta }]
}

export function waitForIceGathering(peer: RTCPeerConnection, timeoutMs = 10_000): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      peer.removeEventListener('icegatheringstatechange', onChange)
      reject(new Error('Timed out while preparing the voice connection.'))
    }, timeoutMs)
    function onChange(): void {
      if (peer.iceGatheringState !== 'complete') return
      window.clearTimeout(timeout)
      peer.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    peer.addEventListener('icegatheringstatechange', onChange)
  })
}

function microphoneError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Microphone access was denied. Allow it in Windows settings, then try again.'
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'No microphone was found. Connect one, then try again.'
  }
  return error instanceof Error ? error.message : 'The voice session could not start.'
}

export class LiveSessionController {
  private readonly options: ControllerOptions
  private peer: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private microphone: MediaStream | null = null
  private messages: TranscriptMessage[] = []
  private generation = 0
  private ready = false
  private muted = false
  private ending = false
  private mode: LiveSessionMode = 'voice'
  private sessionId = ''
  private readonly functions = new Map<string, PendingFunction>()
  private readonly itemCalls = new Map<string, string>()
  private readonly handledCalls = new Set<string>()
  private readonly pendingApprovals = new Map<string, PendingFunction & { parsed: Record<string, unknown> }>()
  private readonly toolTimers = new Map<string, number>()
  private readonly delegations = new Map<string, DelegationState>()

  constructor(options: ControllerOptions) {
    this.options = options
  }

  async start(mode: LiveSessionMode = 'voice'): Promise<void> {
    this.release()
    this.mode = mode
    const generation = ++this.generation
    this.messages = []
    this.options.onTranscript([])
    this.options.onStatus('permission')

    try {
      let microphone: MediaStream | null = null
      if (mode === 'voice') {
        const getUserMedia = this.options.getUserMedia ?? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        microphone = await getUserMedia({ audio: true })
        if (generation !== this.generation) {
          microphone.getTracks().forEach((track) => track.stop())
          return
        }
        this.microphone = microphone
      }
      this.options.onStatus('connecting')

      const peer = (this.options.createPeerConnection ?? (() => new RTCPeerConnection()))()
      this.peer = peer
      peer.addEventListener('track', (event) => {
        if (generation !== this.generation) return
        this.options.audio.srcObject = event.streams[0] ?? new MediaStream([event.track])
        void this.options.audio.play().catch(() => {
          this.fail('Ego could not play the assistant audio. Check the Windows output device.')
        })
      })
      peer.addEventListener('connectionstatechange', () => {
        if (generation !== this.generation || this.ending) return
        if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
          this.fail('The voice connection was lost. Try again.')
        } else if (peer.connectionState === 'closed' && this.ready) {
          this.finish()
        }
      })
      microphone?.getAudioTracks().forEach((track) => peer.addTrack(track, microphone!))
      if (mode === 'chat') peer.addTransceiver('audio', { direction: 'recvonly' })

      const channel = peer.createDataChannel('oai-events')
      this.channel = channel
      channel.addEventListener('message', (event) => this.handleEvent(event.data, generation))
      channel.addEventListener('close', () => {
        if (generation === this.generation && !this.ending && this.ready) {
          this.fail('The voice connection closed before the session ended.')
        }
      })

      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      await waitForIceGathering(peer)
      if (generation !== this.generation) return
      const sdp = peer.localDescription?.sdp
      if (!sdp) throw new Error('Ego could not create a voice connection offer.')
      const createSession = this.options.createSession ?? window.api.liveCreateSession
      const result = await createSession(sdp)
      if (generation !== this.generation) return
      if (!result.ok) throw new Error(result.message)
      this.sessionId = result.sessionId
      await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp })
    } catch (error) {
      if (generation !== this.generation) return
      this.fail(microphoneError(error))
    }
  }

  sendText(text: string): void {
    const value = text.trim()
    if (this.mode !== 'chat' || !this.ready || !value || !this.channel || this.channel.readyState !== 'open') return
    this.addTranscript('user', value)
    this.options.onStatus('thinking')
    this.channel.send(JSON.stringify({
      type: 'response.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: value }] }
    }))
    this.channel.send(JSON.stringify({ type: 'response.create' }))
  }

  approve(callId: string): void {
    const pending = this.pendingApprovals.get(callId)
    if (pending) void this.runFunction(pending, pending.parsed, true)
  }

  reject(callId: string): void {
    const pending = this.pendingApprovals.get(callId)
    if (pending) void this.runFunction(pending, pending.parsed, false)
  }

  toggleMute(): void {
    if (!this.ready || !this.channel || this.channel.readyState !== 'open') return
    this.muted = !this.muted
    this.microphone?.getAudioTracks().forEach((track) => { track.enabled = !this.muted })
    this.channel.send(JSON.stringify({
      type: this.muted ? 'session.input_audio.mute' : 'session.input_audio.unmute'
    }))
    this.options.onStatus(this.muted ? 'muted' : 'listening')
  }

  end(): void {
    if (this.channel?.readyState === 'open') {
      this.channel.send(JSON.stringify({ type: 'session.close' }))
    }
    this.ending = true
    this.generation += 1
    this.release()
    this.options.onStatus('ended')
  }

  dispose(): void {
    if (this.channel?.readyState === 'open') {
      this.channel.send(JSON.stringify({ type: 'session.close' }))
    }
    this.ending = true
    this.generation += 1
    this.release()
  }

  private handleEvent(raw: unknown, generation: number): void {
    if (generation !== this.generation || typeof raw !== 'string') return
    let event: LiveEvent
    try {
      event = JSON.parse(raw) as LiveEvent
    } catch {
      return
    }
    if (event.type === 'session.started') {
      this.ready = true
      this.options.onStatus(this.mode === 'chat' ? 'chat-ready' : this.muted ? 'muted' : 'listening')
      return
    }
    if (event.type === 'session.input_transcript.delta' && typeof event.delta === 'string') {
      this.addTranscript('user', event.delta)
      if (!this.muted) this.options.onStatus('listening')
      return
    }
    if (event.type === 'session.output_transcript.delta' && typeof event.delta === 'string') {
      this.addTranscript('assistant', event.delta)
      if (!this.muted) this.options.onStatus('speaking')
      return
    }
    if (event.type === 'session.input_audio.muted') {
      this.muted = true
      this.options.onStatus('muted')
      return
    }
    if (event.type === 'session.input_audio.unmuted') {
      this.muted = false
      this.options.onStatus('listening')
      return
    }
    if (event.type === 'session.closed') {
      this.finish()
      return
    }
    if (event.type === 'error') {
      this.fail(event.error?.message || 'The voice service reported an error.')
      return
    }
    if (event.type === 'response.event' && event.event) {
      this.handleResponseEvent(event.event, event.delegation_id ?? '', generation)
    }
  }

  private handleResponseEvent(event: Record<string, unknown>, delegationId: string, generation: number): void {
    if (generation !== this.generation || typeof event.type !== 'string') return
    const type = event.type
    const item = isRecord(event.item) ? event.item : null
    if ((type === 'response.output_item.added' || type === 'response.output_item.done') && item?.type === 'function_call') {
      const callId = typeof item.call_id === 'string' ? item.call_id : ''
      const name = typeof item.name === 'string' ? item.name : ''
      const itemId = typeof item.id === 'string' ? item.id : null
      if (callId && name) {
        const current = this.functions.get(callId)
        this.functions.set(callId, {
          callId, name, itemId, delegationId,
          arguments: typeof item.arguments === 'string' ? item.arguments : current?.arguments ?? ''
        })
        if (itemId) this.itemCalls.set(itemId, callId)
        if (type === 'response.output_item.done' && typeof item.arguments === 'string') this.finishFunction(callId)
      }
      return
    }
    if (type === 'response.function_call_arguments.delta') {
      const callId = this.eventCallId(event)
      const pending = callId ? this.functions.get(callId) : null
      if (pending && typeof event.delta === 'string') pending.arguments += event.delta
      return
    }
    if (type === 'response.function_call_arguments.done') {
      const callId = this.eventCallId(event)
      const pending = callId ? this.functions.get(callId) : null
      if (pending && typeof event.arguments === 'string') pending.arguments = event.arguments
      if (callId) this.finishFunction(callId)
      return
    }
    if (this.mode === 'chat' && type === 'response.output_text.delta' && typeof event.delta === 'string') {
      this.addTranscript('assistant', event.delta)
      return
    }
    if (type === 'response.completed' || type === 'response.failed') {
      const state = this.delegation(delegationId)
      state.responseDone = true
      const waitingForTools = state.pendingCalls.size > 0 || state.outputCount > 0
      this.maybeContinue(delegationId)
      if (this.mode === 'chat' && !waitingForTools) {
        this.options.onStatus('chat-ready', type === 'response.failed' ? 'The answer could not be completed.' : undefined)
      }
    }
  }

  private eventCallId(event: Record<string, unknown>): string | null {
    if (typeof event.call_id === 'string') return event.call_id
    if (typeof event.item_id === 'string') return this.itemCalls.get(event.item_id) ?? null
    return null
  }

  private finishFunction(callId: string): void {
    if (this.handledCalls.has(callId)) return
    const pending = this.functions.get(callId)
    if (!pending) return
    this.handledCalls.add(callId)
    this.delegation(pending.delegationId).pendingCalls.add(callId)
    if (!isLiveToolName(pending.name)) {
      this.sendToolOutput(pending, { error: { code: 'UNKNOWN_TOOL', message: 'That tool is unavailable.' } })
      return
    }
    let args: unknown
    try { args = JSON.parse(pending.arguments || '{}') } catch {
      this.sendToolOutput(pending, { error: { code: 'INVALID_TOOL_ARGUMENTS', message: 'The tool arguments were not valid JSON.' } })
      return
    }
    const checked = validateLiveToolArguments(pending.name, args)
    if (!checked.ok) {
      this.sendToolOutput(pending, { error: { code: 'INVALID_TOOL_ARGUMENTS', message: checked.error } })
      return
    }
    if (LIVE_TOOL_REGISTRY[pending.name].confirmationRequired) {
      const write = pending as PendingFunction & { name: LiveToolApproval['toolName'] }
      this.pendingApprovals.set(callId, { ...write, parsed: checked.value })
      this.options.onStatus('approval')
      this.options.onApproval?.({
        toolName: write.name,
        callId,
        arguments: checked.value,
        summary: LIVE_TOOL_REGISTRY[write.name].approvalSummary
      })
      return
    }
    void this.runFunction(pending, checked.value)
  }

  private async runFunction(
    pending: PendingFunction,
    args: Record<string, unknown>,
    approved?: boolean
  ): Promise<void> {
    this.pendingApprovals.delete(pending.callId)
    this.options.onApproval?.(null)
    this.options.onStatus('tool')
    this.options.onToolActivity?.({ toolName: pending.name as LiveToolName, callId: pending.callId, state: 'running' })
    const generation = this.generation
    let timer = 0
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('The tool timed out.')), 20_000)
      this.toolTimers.set(pending.callId, timer)
    })
    try {
      const execute = this.options.executeTool ?? window.api.liveExecuteTool
      const result = await Promise.race([execute({
        sessionId: this.sessionId,
        callId: pending.callId,
        toolName: pending.name as LiveToolName,
        arguments: args,
        ...(approved === undefined ? {} : { approved })
      }), timeout])
      if (generation !== this.generation) return
      if (!result.ok) {
        this.options.onToolActivity?.({ toolName: pending.name as LiveToolName, callId: pending.callId, state: 'failed', message: result.message })
        this.sendToolOutput(pending, { error: { code: result.code, message: result.message } })
      } else {
        this.options.onToolActivity?.(null)
        this.sendToolOutput(pending, result.data)
      }
    } catch (error) {
      if (generation !== this.generation) return
      const message = error instanceof Error ? error.message : 'The tool failed.'
      this.options.onToolActivity?.({ toolName: pending.name as LiveToolName, callId: pending.callId, state: 'failed', message })
      this.sendToolOutput(pending, { error: { code: 'TOOL_FAILED', message } })
    } finally {
      window.clearTimeout(timer)
      this.toolTimers.delete(pending.callId)
    }
  }

  private sendToolOutput(pending: PendingFunction, result: LiveToolExecuteResult | Record<string, unknown>): void {
    if (!this.channel || this.channel.readyState !== 'open') return
    this.channel.send(JSON.stringify({
      type: 'response.item.create',
      event_id: `${pending.delegationId}:${pending.callId}`,
      item: { type: 'function_call_output', call_id: pending.callId, output: JSON.stringify(result) }
    }))
    const state = this.delegation(pending.delegationId)
    state.pendingCalls.delete(pending.callId)
    state.outputCount += 1
    this.maybeContinue(pending.delegationId)
  }

  private delegation(id: string): DelegationState {
    const existing = this.delegations.get(id)
    if (existing) return existing
    const created: DelegationState = { responseDone: false, pendingCalls: new Set(), outputCount: 0 }
    this.delegations.set(id, created)
    return created
  }

  private maybeContinue(delegationId: string): void {
    const state = this.delegations.get(delegationId)
    if (!state?.responseDone || state.pendingCalls.size > 0 || state.outputCount === 0 ||
        !this.channel || this.channel.readyState !== 'open') return
    this.channel.send(JSON.stringify({ type: 'response.create', event_id: `${delegationId}:continue` }))
    state.responseDone = false
    state.outputCount = 0
    this.options.onStatus(this.mode === 'chat' ? 'thinking' : this.muted ? 'muted' : 'listening')
  }

  private addTranscript(role: TranscriptMessage['role'], delta: string): void {
    this.messages = appendTranscript(this.messages, role, delta)
    this.options.onTranscript(this.messages)
  }

  private finish(): void {
    this.ending = true
    this.generation += 1
    this.release()
    this.options.onStatus('ended')
  }

  private fail(message: string): void {
    this.ending = true
    this.generation += 1
    this.release()
    this.options.onStatus('error', message)
  }

  private release(): void {
    this.microphone?.getTracks().forEach((track) => track.stop())
    this.microphone = null
    if (this.channel && this.channel.readyState !== 'closed') this.channel.close()
    this.channel = null
    if (this.peer && this.peer.connectionState !== 'closed') this.peer.close()
    this.peer = null
    this.options.audio.pause()
    this.options.audio.srcObject = null
    for (const timer of this.toolTimers.values()) window.clearTimeout(timer)
    this.toolTimers.clear()
    this.functions.clear()
    this.itemCalls.clear()
    this.handledCalls.clear()
    this.pendingApprovals.clear()
    this.delegations.clear()
    this.options.onApproval?.(null)
    this.options.onToolActivity?.(null)
    this.sessionId = ''
    this.ready = false
    this.muted = false
    this.ending = false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
