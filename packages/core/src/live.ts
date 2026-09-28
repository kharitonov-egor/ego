export const LIVE_VOICES = [
  'alloy', 'ash', 'ballad', 'beacon', 'bossa', 'cedar', 'cinder', 'coral', 'delta', 'echo',
  'gleam', 'marin', 'meridian', 'quartz', 'ripple', 'sage', 'shimmer', 'stone', 'tempo', 'verse',
  'vesper', 'willow'
] as const

export type LiveVoice = typeof LIVE_VOICES[number]
export type LiveAnswerDetail = 'low' | 'medium' | 'high'
export type LiveReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'
export type LiveWebSearch = 'auto' | 'required' | 'none'

export interface LiveToolPreferences {
  readGmail: boolean
  readGoogleDrive: boolean
  readWispr: boolean
  readEgoMoney: boolean
  recordEgoTransactions: boolean
  createTrelloCards: boolean
}

export const DEFAULT_LIVE_TOOL_PREFERENCES: LiveToolPreferences = {
  readGmail: false,
  readGoogleDrive: false,
  readWispr: false,
  readEgoMoney: false,
  recordEgoTransactions: false,
  createTrelloCards: false
}

export interface LivePreferences {
  voice: LiveVoice
  answerDetail: LiveAnswerDetail
  reasoningEffort: LiveReasoningEffort
  webSearch: LiveWebSearch
  maxOutputTokens: number
  customInstructions: string
  tools?: LiveToolPreferences
}

export const DEFAULT_LIVE_PREFERENCES: LivePreferences = {
  voice: 'marin',
  answerDetail: 'low',
  reasoningEffort: 'medium',
  webSearch: 'auto',
  maxOutputTokens: 800,
  customInstructions: '',
  tools: DEFAULT_LIVE_TOOL_PREFERENCES
}

export function resolvedLiveToolPreferences(preferences: LivePreferences): LiveToolPreferences {
  return preferences.tools ?? DEFAULT_LIVE_TOOL_PREFERENCES
}

function isLiveToolPreferences(value: unknown): value is LiveToolPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return Object.keys(DEFAULT_LIVE_TOOL_PREFERENCES).every((key) => typeof input[key] === 'boolean') &&
    Object.keys(input).every((key) => Object.prototype.hasOwnProperty.call(DEFAULT_LIVE_TOOL_PREFERENCES, key))
}

export function isLivePreferences(value: unknown): value is LivePreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return LIVE_VOICES.includes(input.voice as LiveVoice) &&
    (input.answerDetail === 'low' || input.answerDetail === 'medium' || input.answerDetail === 'high') &&
    (input.reasoningEffort === 'low' || input.reasoningEffort === 'medium' || input.reasoningEffort === 'high' || input.reasoningEffort === 'xhigh') &&
    (input.webSearch === 'auto' || input.webSearch === 'required' || input.webSearch === 'none') &&
    Number.isInteger(input.maxOutputTokens) && Number(input.maxOutputTokens) >= 16 && Number(input.maxOutputTokens) <= 4096 &&
    typeof input.customInstructions === 'string' && input.customInstructions.length <= 2000 &&
    (input.tools === undefined || isLiveToolPreferences(input.tools))
}
