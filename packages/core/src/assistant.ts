import type { FetchLike } from './trello'
import {
  ASSISTANT_TOOLS, ASSISTANT_TOOL_NAMES, assistantFunctionTool, isAssistantToolName, validateAssistantArguments,
  type AssistantToolName
} from './assistant-tools'

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const DEFAULT_ASSISTANT_MODEL = 'openai/gpt-6-sol'
/** A tool result longer than this is replaced by a note asking for a narrower question. */
export const MAX_TOOL_RESULT_CHARS = 30_000
export const DEFAULT_MAX_MODEL_CALLS = 8
const MODEL_CALL_TIMEOUT_MS = 60_000
const MAX_OUTPUT_TOKENS = 1500

export interface ModelTextPart {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

export interface ModelImagePart {
  type: 'image_url'
  image_url: { url: string }
}

export type ModelContentPart = ModelTextPart | ModelImagePart

export interface ModelToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** Messages in the shape the chat completions API takes, which is also how a chat is stored. */
export type ModelMessage =
  | { role: 'system'; content: string | ModelContentPart[] }
  | { role: 'user'; content: string | ModelContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ModelToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface AssistantUsage {
  inputTokens: number
  outputTokens: number
  modelCalls: number
}

/** A write the model asked for. It waits on the phone's card until it saves or the user taps Undo. */
export interface PendingWrite {
  callId: string
  name: AssistantToolName
  args: Record<string, unknown>
}

export interface ToolOutcome {
  data: unknown
  /** One short line for the trail under the reply, like "Read mood for 7 days". */
  trail: string
}

export interface AssistantCall {
  name: AssistantToolName
  args: Record<string, unknown>
  callId: string
}

export type AssistantEvent =
  | { type: 'delta'; text: string }
  | { type: 'trail'; line: string }
  | { type: 'message'; message: ModelMessage }

export interface RunAssistantOptions {
  fetcher: FetchLike
  apiKey: string
  model: string
  system: string
  /** The chat so far, ending with the user's message or the tool result that resumes a turn. */
  history: ModelMessage[]
  tools?: readonly AssistantToolName[]
  /** Runs a read, or a direct tool such as remember. A throw becomes an error result for the model. */
  run: (call: AssistantCall) => Promise<ToolOutcome>
  /** Called as text streams in, after each tool runs, and for every message to store. */
  onEvent: (event: AssistantEvent) => void | Promise<void>
  /** Epoch milliseconds. The loop stops calling the model once this passes. */
  deadline: number
  now?: () => number
  maxModelCalls?: number
}

export type AssistantFailure = 'unauthorized' | 'rate_limited' | 'timeout' | 'upstream' | 'steps'

export type RunAssistantResult =
  | { ok: true; reply: string; pending: PendingWrite[]; usage: AssistantUsage }
  | { ok: false; reason: AssistantFailure; message: string; usage: AssistantUsage }

interface StreamedMessage {
  content: string
  toolCalls: ModelToolCall[]
  usage: { prompt: number; completion: number } | null
}

type ModelCallResult =
  | { ok: true; message: StreamedMessage }
  | { ok: false; reason: AssistantFailure; message: string }

interface ToolCallDelta {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

interface Chunk {
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: ToolCallDelta[] }
    message?: { content?: string | null; tool_calls?: ToolCallDelta[] }
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class Assembler {
  content = ''
  usage: StreamedMessage['usage'] = null
  error: string | null = null
  private readonly calls = new Map<number, { id: string; name: string; arguments: string }>()

  take(chunk: Chunk, onDelta: (text: string) => void | Promise<void>): Promise<void> | void {
    if (chunk.error) {
      this.error = chunk.error.message ?? 'The model returned an error'
      return
    }
    if (chunk.usage) {
      this.usage = { prompt: chunk.usage.prompt_tokens ?? 0, completion: chunk.usage.completion_tokens ?? 0 }
    }
    const choice = chunk.choices?.[0]
    const delta = choice?.delta ?? choice?.message
    if (!delta) return
    for (const [position, call] of (delta.tool_calls ?? []).entries()) {
      const index = call.index ?? position
      const existing = this.calls.get(index) ?? { id: '', name: '', arguments: '' }
      if (call.id) existing.id = call.id
      if (call.function?.name) existing.name = call.function.name
      if (call.function?.arguments) existing.arguments += call.function.arguments
      this.calls.set(index, existing)
    }
    if (delta.content) {
      this.content += delta.content
      return onDelta(delta.content)
    }
  }

  message(): StreamedMessage {
    const toolCalls = [...this.calls.entries()].sort(([left], [right]) => left - right).map(([index, call]) => ({
      id: call.id || `call_${index}_${Date.now().toString(36)}`,
      type: 'function' as const,
      function: { name: call.name, arguments: call.arguments }
    }))
    return { content: this.content, toolCalls, usage: this.usage }
  }
}

async function readEventStream(
  response: Response, assembler: Assembler, onDelta: (text: string) => void | Promise<void>
): Promise<void> {
  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const handleLine = async (raw: string): Promise<boolean> => {
    const line = raw.replace(/\r$/, '')
    if (!line.startsWith('data:')) return false
    const payload = line.slice(5).trim()
    if (payload === '[DONE]') return true
    let chunk: unknown
    try { chunk = JSON.parse(payload) } catch { return false }
    if (isRecord(chunk)) await assembler.take(chunk as Chunk, onDelta)
    return false
  }
  if (!reader) {
    for (const line of (await response.text()).split('\n')) {
      if (await handleLine(line)) return
    }
    return
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (await handleLine(line)) {
        void reader.cancel().catch(() => undefined)
        return
      }
      newline = buffer.indexOf('\n')
    }
  }
  if (buffer.trim()) await handleLine(buffer)
}

async function callModel(
  options: RunAssistantOptions,
  messages: ModelMessage[],
  tools: Record<string, unknown>[],
  timeoutMs: number,
  onDelta: (text: string) => void | Promise<void>
): Promise<ModelCallResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await options.fetcher(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey.trim()}`,
        'content-type': 'application/json',
        'x-title': 'Ego assistant'
      },
      body: JSON.stringify({
        model: options.model.trim(),
        messages,
        tools,
        tool_choice: 'auto',
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: MAX_OUTPUT_TOKENS
      }),
      signal: controller.signal
    })
  } catch (error: unknown) {
    clearTimeout(timer)
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, reason: 'timeout', message: 'The model took too long to answer. Try again.' }
    }
    return { ok: false, reason: 'upstream', message: 'OpenRouter is unreachable. Check the connection and try again.' }
  }
  try {
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: 'unauthorized', message: 'OpenRouter rejected the server key. Replace OPENROUTER_API_KEY on the Worker.' }
    }
    if (response.status === 429) {
      return { ok: false, reason: 'rate_limited', message: 'OpenRouter rate limited the request. Wait a moment and try again.' }
    }
    if (!response.ok) {
      let detail = `OpenRouter returned HTTP ${response.status}.`
      try {
        const body: unknown = await response.json()
        if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') detail = body.error.message
      } catch {
        // The status is the message.
      }
      return { ok: false, reason: 'upstream', message: detail }
    }
    const assembler = new Assembler()
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const body: unknown = await response.json()
      if (isRecord(body)) await assembler.take(body as Chunk, onDelta)
    } else {
      await readEventStream(response, assembler, onDelta)
    }
    if (assembler.error) return { ok: false, reason: 'upstream', message: assembler.error }
    return { ok: true, message: assembler.message() }
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, reason: 'timeout', message: 'The model took too long to answer. Try again.' }
    }
    return { ok: false, reason: 'upstream', message: 'OpenRouter returned an unreadable response.' }
  } finally {
    clearTimeout(timer)
  }
}

function serializeResult(data: unknown): string {
  const encoded = JSON.stringify(data ?? null)
  if (encoded.length <= MAX_TOOL_RESULT_CHARS) return encoded
  return JSON.stringify({ truncated: true, message: 'The result was too large. Ask for a narrower range.' })
}

function parseArguments(raw: string): unknown {
  if (!raw.trim()) return {}
  try { return JSON.parse(raw) } catch { return undefined }
}

export function systemMessage(text: string): ModelMessage {
  return { role: 'system', content: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }] }
}

/**
 * One turn of the assistant: call the model, run the reads it asks for, feed the results back, and
 * repeat until it answers in words or asks for writes. Writes stop the turn and come back together,
 * so one card can hold everything a message asked to save.
 */
export async function runAssistant(options: RunAssistantOptions): Promise<RunAssistantResult> {
  const now = options.now ?? Date.now
  const enabled = options.tools ?? ASSISTANT_TOOL_NAMES
  const tools = enabled.map(assistantFunctionTool)
  const messages: ModelMessage[] = [systemMessage(options.system), ...options.history]
  const usage: AssistantUsage = { inputTokens: 0, outputTokens: 0, modelCalls: 0 }
  const replies: string[] = []
  const maxCalls = options.maxModelCalls ?? DEFAULT_MAX_MODEL_CALLS

  for (let step = 0; step < maxCalls; step += 1) {
    const remaining = options.deadline - now()
    if (remaining <= 0) return { ok: false, reason: 'timeout', message: 'That took too long. Try a narrower question.', usage }
    let separated = replies.length === 0
    const result = await callModel(options, messages, tools, Math.min(MODEL_CALL_TIMEOUT_MS, remaining), async (text) => {
      if (!separated) {
        separated = true
        await options.onEvent({ type: 'delta', text: '\n\n' })
      }
      await options.onEvent({ type: 'delta', text })
    })
    usage.modelCalls += 1
    if (!result.ok) return { ok: false, reason: result.reason, message: result.message, usage }
    const { content, toolCalls } = result.message
    if (result.message.usage) {
      usage.inputTokens += result.message.usage.prompt
      usage.outputTokens += result.message.usage.completion
    }
    const assistant: ModelMessage = {
      role: 'assistant',
      content: content || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
    }
    messages.push(assistant)
    await options.onEvent({ type: 'message', message: assistant })
    if (content.trim()) replies.push(content.trim())
    if (toolCalls.length === 0) return { ok: true, reply: replies.join('\n\n'), pending: [], usage }

    const pending: PendingWrite[] = []
    for (const call of toolCalls) {
      const name = call.function.name
      let content: string
      if (!isAssistantToolName(name) || !enabled.includes(name)) {
        content = JSON.stringify({ error: `There is no tool named ${name}` })
      } else {
        const parsed = parseArguments(call.function.arguments)
        const validated = parsed === undefined
          ? { ok: false as const, error: 'The arguments were not valid JSON' }
          : validateAssistantArguments(name, parsed)
        if (!validated.ok) {
          content = JSON.stringify({ error: validated.error })
        } else if (ASSISTANT_TOOLS[name].access === 'write') {
          pending.push({ callId: call.id, name, args: validated.value })
          continue
        } else {
          try {
            const outcome = await options.run({ name, args: validated.value, callId: call.id })
            content = serializeResult(outcome.data)
            await options.onEvent({ type: 'trail', line: outcome.trail })
          } catch (error: unknown) {
            content = JSON.stringify({ error: error instanceof Error ? error.message : 'The tool failed' })
          }
        }
      }
      const toolMessage: ModelMessage = { role: 'tool', tool_call_id: call.id, content }
      messages.push(toolMessage)
      await options.onEvent({ type: 'message', message: toolMessage })
    }
    if (pending.length > 0) return { ok: true, reply: replies.join('\n\n'), pending, usage }
  }
  return { ok: false, reason: 'steps', message: 'That took too many steps. Try a narrower question.', usage }
}
