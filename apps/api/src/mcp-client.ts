/** A remote MCP server the Worker calls as a client, over Streamable HTTP. */
export interface McpServer {
  url: string
  headers: Record<string, string>
}

export interface McpToolInfo {
  name: string
  description: string
  inputSchema: unknown
}

const PROTOCOL_VERSION = '2025-06-18'
const TIMEOUT_MS = 30_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A reply may come as plain JSON or as a server-sent event stream; both carry JSON-RPC messages. */
async function readReply(response: Response, id: number): Promise<Record<string, unknown> | null> {
  const type = response.headers.get('content-type') ?? ''
  const text = await response.text()
  const messages: unknown[] = []
  if (type.includes('text/event-stream')) {
    for (const line of text.split('\n')) {
      const trimmed = line.replace(/\r$/, '')
      if (!trimmed.startsWith('data:')) continue
      try { messages.push(JSON.parse(trimmed.slice(5).trim())) } catch { continue }
    }
  } else if (text.trim()) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (Array.isArray(parsed)) messages.push(...parsed)
      else messages.push(parsed)
    } catch {
      return null
    }
  }
  const reply = messages.find((message) => isRecord(message) && message.id === id)
  return isRecord(reply) ? reply : null
}

export class McpClientError extends Error {}

/**
 * Opens a session, sends one request, and returns its result. Each call starts fresh, since the
 * Worker keeps no state between requests.
 */
export async function mcpRequest(server: McpServer, method: string, params: Record<string, unknown>): Promise<unknown> {
  const post = async (body: Record<string, unknown>, session: string | null): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      return await fetch(server.url, {
        method: 'POST',
        headers: {
          ...server.headers,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': PROTOCOL_VERSION,
          ...(session ? { 'mcp-session-id': session } : {})
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
    } finally {
      clearTimeout(timer)
    }
  }
  let opened: Response
  try {
    opened = await post({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'Ego', version: '1.0.0' } }
    }, null)
  } catch {
    throw new McpClientError('The connector could not be reached')
  }
  if (opened.status === 401 || opened.status === 403) throw new McpClientError('The connector rejected Ego. Connect it again in Settings.')
  if (!opened.ok) throw new McpClientError(`The connector answered HTTP ${opened.status}`)
  const session = opened.headers.get('mcp-session-id')
  await readReply(opened, 1)
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, session).then((response) => response.body?.cancel()).catch(() => undefined)
  let answered: Response
  try {
    answered = await post({ jsonrpc: '2.0', id: 2, method, params }, session)
  } catch {
    throw new McpClientError('The connector stopped answering')
  }
  if (!answered.ok) throw new McpClientError(`The connector answered HTTP ${answered.status}`)
  const reply = await readReply(answered, 2)
  if (!reply) throw new McpClientError('The connector sent an unreadable answer')
  if (isRecord(reply.error)) throw new McpClientError(typeof reply.error.message === 'string' ? reply.error.message : 'The connector refused the call')
  return reply.result
}

export async function listMcpTools(server: McpServer): Promise<McpToolInfo[]> {
  const result = await mcpRequest(server, 'tools/list', {})
  const tools = isRecord(result) && Array.isArray(result.tools) ? result.tools : []
  return tools.filter(isRecord).filter((tool) => typeof tool.name === 'string').map((tool) => ({
    name: String(tool.name),
    description: typeof tool.description === 'string' ? tool.description : '',
    inputSchema: tool.inputSchema ?? {}
  }))
}

/** A tool's result as text, or its error message thrown. */
export async function callMcpTool(server: McpServer, name: string, args: Record<string, unknown>): Promise<string> {
  const result = await mcpRequest(server, 'tools/call', { name, arguments: args })
  if (!isRecord(result)) throw new McpClientError('The connector sent an empty answer')
  const content = Array.isArray(result.content) ? result.content : []
  const text = content.filter(isRecord).map((part) => typeof part.text === 'string' ? part.text : '').filter(Boolean).join('\n')
  if (result.isError === true) throw new McpClientError(text || 'The tool failed')
  return text
}
