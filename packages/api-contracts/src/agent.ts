/** Every MCP key starts with this, so the Worker can tell one from a device token at a glance. */
export const AGENT_KEY_PREFIX = 'egomcp_'

/** Where Claude reaches Ego's tools, on the Worker's own address. */
export const MCP_PATH = '/mcp'

export const AGENT_MEMORY_MAX_CHARS = 300
/** The chat reads every note on each turn, so the list stays short enough to fit. */
export const AGENT_MEMORY_MAX_NOTES = 200
export const AGENT_KEY_NAME_MAX = 80

export interface AgentKeySummary {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
}

export interface AgentKeyList {
  keys: AgentKeySummary[]
  /** The address to paste into a claude.ai custom connector. */
  mcpUrl: string
}

/** `token` is shown once. The Worker keeps only its hash. */
export interface AgentKeyCreated {
  key: AgentKeySummary
  token: string
  mcpUrl: string
}

/** Who wrote a note: the in-app chat, Claude over MCP, or the user in Memory. */
export type AgentMemorySource = 'chat' | 'agent' | 'user'

export interface AgentMemory {
  id: string
  text: string
  source: AgentMemorySource
  createdAt: string
  updatedAt: string
}

export interface AgentMemoryList {
  memories: AgentMemory[]
}

export interface AgentMemoryInput {
  text: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isAgentMemoryInput(value: unknown): value is AgentMemoryInput {
  return isRecord(value) && typeof value.text === 'string'
}
