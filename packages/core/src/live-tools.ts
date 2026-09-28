export type LiveToolName =
  | 'ego_get_summary'
  | 'ego_list_accounts'
  | 'ego_get_budget'
  | 'ego_search_transactions'
  | 'ego_get_transaction'
  | 'ego_record_transaction'
  | 'gmail_search'
  | 'gmail_read'
  | 'trello_create_card'

export type LiveToolAccess = 'read' | 'write'

export interface LiveToolDefinition {
  name: LiveToolName
  description: string
  parameters: Record<string, unknown>
  access: LiveToolAccess
  confirmationRequired: boolean
  maxResultBytes: number
  approvalSummary: string
}

const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$'
const MONTH_PATTERN = '^\\d{4}-\\d{2}$'

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
})

const shortId = { type: 'string', minLength: 1, maxLength: 128 } as const
const date = { type: 'string', pattern: DATE_PATTERN } as const
const nullableShortId = { ...shortId, type: ['string', 'null'] } as const
const nullableDate = { ...date, type: ['string', 'null'] } as const

export const LIVE_TOOL_REGISTRY: Record<LiveToolName, LiveToolDefinition> = {
  ego_get_summary: {
    name: 'ego_get_summary',
    description: 'Read income, spending, transfers, and budget totals for an optional date range.',
    parameters: objectSchema({ from: nullableDate, to: nullableDate }, ['from', 'to']),
    access: 'read', confirmationRequired: false, maxResultBytes: 16_384,
    approvalSummary: 'Read an Ego Money summary'
  },
  ego_list_accounts: {
    name: 'ego_list_accounts',
    description: 'List Ego Money accounts with current balances.',
    parameters: objectSchema({}),
    access: 'read', confirmationRequired: false, maxResultBytes: 24_576,
    approvalSummary: 'Read Ego Money accounts and balances'
  },
  ego_get_budget: {
    name: 'ego_get_budget',
    description: 'Read the budget and category allocations for one month.',
    parameters: objectSchema({ month: { type: 'string', pattern: MONTH_PATTERN } }, ['month']),
    access: 'read', confirmationRequired: false, maxResultBytes: 24_576,
    approvalSummary: 'Read an Ego Money budget'
  },
  ego_search_transactions: {
    name: 'ego_search_transactions',
    description: 'Search Ego Money transactions by text, date, account, category, or kind.',
    parameters: objectSchema({
      query: { type: ['string', 'null'], maxLength: 120 },
      from: nullableDate,
      to: nullableDate,
      accountId: nullableShortId,
      categoryId: nullableShortId,
      kind: { type: ['string', 'null'], enum: ['income', 'expense', 'transfer', null] },
      limit: { type: ['integer', 'null'], minimum: 1, maximum: 25 }
    }, ['query', 'from', 'to', 'accountId', 'categoryId', 'kind', 'limit']),
    access: 'read', confirmationRequired: false, maxResultBytes: 48_000,
    approvalSummary: 'Search Ego Money transactions'
  },
  ego_get_transaction: {
    name: 'ego_get_transaction',
    description: 'Read one Ego Money transaction and its receipt details.',
    parameters: objectSchema({ transactionId: shortId }, ['transactionId']),
    access: 'read', confirmationRequired: false, maxResultBytes: 32_768,
    approvalSummary: 'Read an Ego Money transaction'
  },
  ego_record_transaction: {
    name: 'ego_record_transaction',
    description: 'Record one Ego Money transaction after the user confirms the exact details on screen.',
    parameters: objectSchema({
      kind: { type: 'string', enum: ['income', 'expense', 'transfer'] },
      accountId: shortId,
      destinationAccountId: nullableShortId,
      categoryId: nullableShortId,
      amountCents: { type: 'integer', minimum: 1, maximum: 999_999_999_99 },
      merchant: { type: ['string', 'null'], maxLength: 120 },
      date,
      notes: { type: ['string', 'null'], maxLength: 500 }
    }, ['kind', 'accountId', 'destinationAccountId', 'categoryId', 'amountCents', 'merchant', 'date', 'notes']),
    access: 'write', confirmationRequired: true, maxResultBytes: 8_192,
    approvalSummary: 'Record this transaction in Ego Money'
  },
  gmail_search: {
    name: 'gmail_search',
    description: 'Search the connected Gmail account and return short message summaries.',
    parameters: objectSchema({
      query: { type: 'string', minLength: 1, maxLength: 500 },
      maxResults: { type: ['integer', 'null'], minimum: 1, maximum: 10 }
    }, ['query', 'maxResults']),
    access: 'read', confirmationRequired: false, maxResultBytes: 32_768,
    approvalSummary: 'Search Gmail'
  },
  gmail_read: {
    name: 'gmail_read',
    description: 'Read one Gmail message, with its body shortened for a spoken answer.',
    parameters: objectSchema({ messageId: shortId }, ['messageId']),
    access: 'read', confirmationRequired: false, maxResultBytes: 48_000,
    approvalSummary: 'Read a Gmail message'
  },
  trello_create_card: {
    name: 'trello_create_card',
    description: 'Create one Trello card through Ego after the user confirms the exact card on screen.',
    parameters: objectSchema({
      boardId: shortId,
      listId: shortId,
      title: { type: 'string', minLength: 1, maxLength: 16384 },
      description: { type: ['string', 'null'], maxLength: 16384 }
    }, ['boardId', 'listId', 'title', 'description']),
    access: 'write', confirmationRequired: true, maxResultBytes: 8_192,
    approvalSummary: 'Create this Trello card'
  }
}

export const LIVE_TOOL_NAMES = Object.keys(LIVE_TOOL_REGISTRY) as LiveToolName[]

export interface LiveToolValidationSuccess {
  ok: true
  value: Record<string, unknown>
}

export interface LiveToolValidationFailure {
  ok: false
  error: string
}

export type LiveToolValidation = LiveToolValidationSuccess | LiveToolValidationFailure

function matchesType(value: unknown, type: unknown): boolean {
  const types = Array.isArray(type) ? type : [type]
  return types.some((entry) => {
    if (entry === 'null') return value === null
    if (entry === 'string') return typeof value === 'string'
    if (entry === 'integer') return Number.isSafeInteger(value)
    if (entry === 'number') return typeof value === 'number' && Number.isFinite(value)
    if (entry === 'boolean') return typeof value === 'boolean'
    return false
  })
}

function validateProperty(name: string, value: unknown, schema: Record<string, unknown>): string | null {
  if (!matchesType(value, schema.type)) return `${name} has the wrong type`
  if (value === null) return null
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return `${name} is too short`
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return `${name} is too long`
    if (typeof schema.pattern === 'string' && !(new RegExp(schema.pattern).test(value))) return `${name} has the wrong format`
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${name} is not allowed`
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `${name} is too small`
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `${name} is too large`
  }
  return null
}

export function isLiveToolName(value: unknown): value is LiveToolName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LIVE_TOOL_REGISTRY, value)
}

export function validateLiveToolArguments(name: LiveToolName, value: unknown): LiveToolValidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Tool arguments must be an object' }
  }
  const input = value as Record<string, unknown>
  const schema = LIVE_TOOL_REGISTRY[name].parameters
  const properties = schema.properties as Record<string, Record<string, unknown>>
  const required = new Set((schema.required as string[] | undefined) ?? [])
  for (const key of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) {
      return { ok: false, error: `Unknown argument: ${key}` }
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) return { ok: false, error: `Missing argument: ${key}` }
  }
  for (const [key, item] of Object.entries(input)) {
    const problem = validateProperty(key, item, properties[key]!)
    if (problem) return { ok: false, error: problem }
  }
  if (name === 'ego_get_summary' || name === 'ego_search_transactions') {
    const from = input.from
    const to = input.to
    if (typeof from === 'string' && typeof to === 'string' && from > to) {
      return { ok: false, error: 'from must not be after to' }
    }
  }
  if (name === 'ego_record_transaction') {
    const kind = input.kind
    if (kind === 'transfer') {
      if (typeof input.destinationAccountId !== 'string' || input.destinationAccountId === input.accountId) {
        return { ok: false, error: 'A transfer needs a different destination account' }
      }
      if (input.categoryId !== undefined && input.categoryId !== null) {
        return { ok: false, error: 'A transfer cannot have a category' }
      }
    } else if (typeof input.categoryId !== 'string') {
      return { ok: false, error: 'Income and expense transactions need a category' }
    }
  }
  return { ok: true, value: input }
}

export function liveFunctionTool(name: LiveToolName): Record<string, unknown> {
  const definition = LIVE_TOOL_REGISTRY[name]
  return {
    type: 'function',
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    strict: true
  }
}
