import type { ToolSchema, ToolValidation } from './tool-schema'
import { validateToolArguments } from './tool-schema'

export type AssistantToolName =
  | 'read_mood'
  | 'read_habits'
  | 'read_gym'
  | 'gym_records'
  | 'read_health'
  | 'read_heart_rate'
  | 'money_summary'
  | 'list_accounts'
  | 'read_budget'
  | 'search_transactions'
  | 'read_transaction'
  | 'read_study'
  | 'record_transactions'
  | 'save_mood'
  | 'log_habit'
  | 'unlog_habit'
  | 'log_gym_sets'
  | 'mark_study'

export type AssistantToolAccess = 'read' | 'write'

export interface AssistantToolDefinition {
  name: AssistantToolName
  description: string
  parameters: ToolSchema
  access: AssistantToolAccess
  /** A write that stops for a Confirm card. Other writes are applied at once and offer Undo. */
  confirm: boolean
}

const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$'
const MONTH_PATTERN = '^\\d{4}-\\d{2}$'

const date: ToolSchema = { type: 'string', pattern: DATE_PATTERN, description: 'YYYY-MM-DD' }
const nullableDate: ToolSchema = { type: ['string', 'null'], pattern: DATE_PATTERN, description: 'YYYY-MM-DD, or null' }
const id: ToolSchema = { type: 'string', minLength: 1, maxLength: 64 }
const nullableId: ToolSchema = { type: ['string', 'null'], minLength: 1, maxLength: 64 }
const cents: ToolSchema = { type: 'integer', minimum: 0, description: 'Integer cents' }

function object(properties: Record<string, ToolSchema>, description?: string): ToolSchema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false, description }
}

const range = { from: date, to: date }

const receiptItem = object({
  name: { type: 'string', minLength: 1, maxLength: 160 },
  quantity: { type: 'number', minimum: 0.001 },
  unitPriceCents: { type: ['integer', 'null'], minimum: 0 },
  grossPriceCents: cents,
  discountCents: cents,
  lineTotalCents: cents
})

const receipt: ToolSchema = {
  ...object({
    merchant: { type: 'string', minLength: 1, maxLength: 120 },
    purchaseDate: date,
    subtotalCents: cents,
    discountCents: cents,
    taxCents: cents,
    feesCents: cents,
    totalCents: { type: 'integer', minimum: 1, description: 'Must equal amountCents' },
    items: { type: 'array', minItems: 1, maxItems: 500, items: receiptItem }
  }),
  type: ['object', 'null'],
  description: 'Only for an attached itemized receipt. Copy every readable line. Otherwise null.'
}

const transaction = object({
  kind: { type: 'string', enum: ['income', 'expense'] },
  accountId: id,
  categoryId: { ...id, description: 'A category of the same kind' },
  amountCents: { type: 'integer', minimum: 1, description: 'The final amount paid, in integer cents' },
  date,
  merchant: { type: ['string', 'null'], maxLength: 120, description: 'Who was paid or who paid' },
  notes: { type: ['string', 'null'], maxLength: 400, description: 'Short, without repeating the merchant' },
  receipt
})

const gymSet = object({
  exerciseId: id,
  weight: { type: ['number', 'null'], minimum: 0 },
  weightUnit: { type: ['string', 'null'], enum: ['lbs', 'kg', null], description: 'Null uses the exercise\'s unit' },
  reps: { type: ['integer', 'null'], minimum: 0 },
  distance: { type: ['number', 'null'], minimum: 0 },
  distanceUnit: { type: ['string', 'null'], enum: ['mi', 'km', 'm', null] },
  durationSeconds: { type: ['integer', 'null'], minimum: 0 },
  comment: { type: ['string', 'null'], maxLength: 500 }
})

export const ASSISTANT_TOOLS: Record<AssistantToolName, AssistantToolDefinition> = {
  read_mood: {
    name: 'read_mood',
    description: 'Mood entries between two dates: a 1 to 5 mood and a note per day. Days without an entry are left out.',
    parameters: object(range),
    access: 'read', confirm: false
  },
  read_habits: {
    name: 'read_habits',
    description: 'Every habit with its target, plus check-offs (habits to build) or slips (habits to break) between two dates, counted and listed by day.',
    parameters: object(range),
    access: 'read', confirm: false
  },
  read_gym: {
    name: 'read_gym',
    description: 'Logged gym sets between two dates, grouped by day and exercise, with weight, reps, distance, and time. Pass exerciseId to narrow to one exercise.',
    parameters: object({ ...range, exerciseId: nullableId }),
    access: 'read', confirm: false
  },
  gym_records: {
    name: 'gym_records',
    description: 'Personal records for one exercise: heaviest weight, best weight at each rep count, estimated one-rep max (Epley), most reps, best set and workout volume, longest distance and time. Dates narrow the window; null means all time.',
    parameters: object({ exerciseId: id, from: nullableDate, to: nullableDate }),
    access: 'read', confirm: false
  },
  read_health: {
    name: 'read_health',
    description: 'Fitbit data from Google Health between two dates: steps, distance, calories, active zone minutes, resting heart rate, HRV, daily heart rate range, weight, and each night of sleep with its stages. Up to 120 days.',
    parameters: object(range),
    access: 'read', confirm: false
  },
  read_heart_rate: {
    name: 'read_heart_rate',
    description: 'Five-minute heart rate readings for one day, within the last two weeks.',
    parameters: object({ date }),
    access: 'read', confirm: false
  },
  money_summary: {
    name: 'money_summary',
    description: 'Income, spending, net, transfers, and budget totals for a date range, in cents. Null dates mean all time.',
    parameters: object({ from: nullableDate, to: nullableDate }),
    access: 'read', confirm: false
  },
  list_accounts: {
    name: 'list_accounts',
    description: 'Money accounts with their current balances in cents.',
    parameters: object({}),
    access: 'read', confirm: false
  },
  read_budget: {
    name: 'read_budget',
    description: 'The budget for one month: planned income and the amount per expense category, with what was spent.',
    parameters: object({ month: { type: 'string', pattern: MONTH_PATTERN, description: 'YYYY-MM' } }),
    access: 'read', confirm: false
  },
  search_transactions: {
    name: 'search_transactions',
    description: 'Transactions matching a text query, date range, account, category, or kind. Newest first, up to 25.',
    parameters: object({
      query: { type: ['string', 'null'], maxLength: 120, description: 'Matches notes and merchant names' },
      from: nullableDate,
      to: nullableDate,
      accountId: nullableId,
      categoryId: nullableId,
      kind: { type: ['string', 'null'], enum: ['income', 'expense', 'transfer', null] },
      limit: { type: ['integer', 'null'], minimum: 1, maximum: 25 }
    }),
    access: 'read', confirm: false
  },
  read_transaction: {
    name: 'read_transaction',
    description: 'One transaction with its receipt lines, if it has a receipt.',
    parameters: object({ transactionId: id }),
    access: 'read', confirm: false
  },
  read_study: {
    name: 'read_study',
    description: 'Canvas assignments with due dates, courses, and whether each is checked off.',
    parameters: object({}),
    access: 'read', confirm: false
  },
  record_transactions: {
    name: 'record_transactions',
    description: 'Record one or more incomes or expenses. Put every transaction the user mentioned in one call. The user confirms on screen before anything is saved.',
    parameters: object({ transactions: { type: 'array', minItems: 1, maxItems: 50, items: transaction } }),
    access: 'write', confirm: true
  },
  save_mood: {
    name: 'save_mood',
    description: 'Set the mood for one day, 1 (awful) to 5 (great). A null note keeps the note already saved for that day.',
    parameters: object({ date, mood: { type: 'integer', minimum: 1, maximum: 5 }, note: { type: ['string', 'null'], maxLength: 2000 } }),
    access: 'write', confirm: false
  },
  log_habit: {
    name: 'log_habit',
    description: 'Check off a habit to build for a day, or log a slip for a habit to break. times adds several check-offs for a habit with a daily target above one.',
    parameters: object({ habitId: id, date, times: { type: ['integer', 'null'], minimum: 1, maximum: 10 } }),
    access: 'write', confirm: false
  },
  unlog_habit: {
    name: 'unlog_habit',
    description: 'Take back the latest check-off of a habit for a day.',
    parameters: object({ habitId: id, date }),
    access: 'write', confirm: false
  },
  log_gym_sets: {
    name: 'log_gym_sets',
    description: 'Log gym sets for one day, in the order they were done. "3x8 at 185" is three sets with reps 8 and weight 185. Leave fields the exercise does not use as null.',
    parameters: object({ date, sets: { type: 'array', minItems: 1, maxItems: 60, items: gymSet } }),
    access: 'write', confirm: false
  },
  mark_study: {
    name: 'mark_study',
    description: 'Check off a Canvas assignment, or uncheck it.',
    parameters: object({ assignmentId: { type: 'string', minLength: 1, maxLength: 200 }, done: { type: 'boolean' } }),
    access: 'write', confirm: false
  }
}

export const ASSISTANT_TOOL_NAMES = Object.keys(ASSISTANT_TOOLS) as AssistantToolName[]

export function isAssistantToolName(value: unknown): value is AssistantToolName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ASSISTANT_TOOLS, value)
}

export function validateAssistantArguments(name: AssistantToolName, value: unknown): ToolValidation {
  return validateToolArguments(ASSISTANT_TOOLS[name].parameters, value)
}

/** The tool in the shape OpenRouter's chat completions API takes. */
export function assistantFunctionTool(name: AssistantToolName): Record<string, unknown> {
  const definition = ASSISTANT_TOOLS[name]
  return {
    type: 'function',
    function: { name: definition.name, description: definition.description, parameters: definition.parameters }
  }
}
