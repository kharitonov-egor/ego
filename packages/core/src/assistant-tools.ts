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
  | 'read_tasks'
  | 'record_transactions'
  | 'save_mood'
  | 'log_habit'
  | 'unlog_habit'
  | 'log_gym_sets'
  | 'mark_study'
  | 'add_task_card'
  | 'update_task_card'
  | 'read_food'
  | 'read_fridge'
  | 'log_food'
  | 'add_fridge_items'
  | 'remove_fridge_items'
  | 'set_food_targets'
  | 'read_calendar'
  | 'add_calendar_event'
  | 'update_calendar_event'
  | 'delete_calendar_event'
  | 'answer_calendar_event'
  | 'remember'
  | 'forget'

/** `direct` tools change something small and run inside the turn, with no card: memory notes. */
export type AssistantToolAccess = 'read' | 'write' | 'direct'

/** How long a card waits for Undo before it saves. After that nothing can be taken back. */
export const SAVE_DELAY_MS = 3000

/** Every write waits on a card that saves itself after `SAVE_DELAY_MS` unless the user taps Undo. */
export interface AssistantToolDefinition {
  name: AssistantToolName
  description: string
  parameters: ToolSchema
  access: AssistantToolAccess
}

const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$'
const TIME_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$'
const MONTH_PATTERN = '^\\d{4}-\\d{2}$'

const date: ToolSchema = { type: 'string', pattern: DATE_PATTERN, description: 'YYYY-MM-DD' }
const nullableDate: ToolSchema = { type: ['string', 'null'], pattern: DATE_PATTERN, description: 'YYYY-MM-DD, or null' }
const id: ToolSchema = { type: 'string', minLength: 1, maxLength: 64 }
const nullableId: ToolSchema = { type: ['string', 'null'], minLength: 1, maxLength: 64 }
const cents: ToolSchema = { type: 'integer', minimum: 0, description: 'Integer cents' }
const nullableTime: ToolSchema = { type: ['string', 'null'], pattern: TIME_PATTERN, description: '24-hour HH:MM, or null' }
const priority: ToolSchema = { type: ['string', 'null'], enum: ['none', 'low', 'medium', 'high', 'urgent', null] }

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

const fridgeItem = object({
  name: { type: 'string', minLength: 1, maxLength: 120, description: 'A plain name, like "Whole milk", not a receipt code' },
  icon: { type: 'string', maxLength: 16, description: 'One emoji' },
  brand: { type: ['string', 'null'], maxLength: 80 }
})

const transaction = object({
  kind: { type: 'string', enum: ['income', 'expense'] },
  accountId: id,
  categoryId: { ...id, description: 'A category of the same kind' },
  amountCents: { type: 'integer', minimum: 1, description: 'The final amount paid, in integer cents' },
  date,
  merchant: { type: ['string', 'null'], maxLength: 120, description: 'Who was paid or who paid' },
  notes: { type: ['string', 'null'], maxLength: 400, description: 'Short, without repeating the merchant' },
  receipt,
  fridgeItems: {
    type: ['array', 'null'], maxItems: 60, items: fridgeItem,
    description: 'For groceries: every food and drink bought, so it lands in the fridge list. Null for anything else.'
  }
})

const foodEntry = object({
  name: { type: 'string', minLength: 1, maxLength: 120, description: 'What was eaten, like "Chicken burrito bowl"' },
  date,
  time: { ...nullableTime, description: '24-hour HH:MM when it was eaten, or null for now' },
  serving: { type: ['string', 'null'], maxLength: 80, description: 'How much, like "1 bowl" or "2 slices"' },
  calories: { type: 'number', minimum: 0, maximum: 20000, description: 'kcal for the amount eaten' },
  protein: { type: 'number', minimum: 0, maximum: 3000, description: 'grams' },
  carbs: { type: 'number', minimum: 0, maximum: 3000, description: 'grams' },
  fat: { type: 'number', minimum: 0, maximum: 3000, description: 'grams' },
  usePhoto: { type: 'boolean', description: 'True for the entry the photo attached to this very message shows. A photo from an earlier message cannot be attached.' }
})

const target: ToolSchema = { type: ['number', 'null'], minimum: 0, maximum: 20000 }

const eventKey: ToolSchema = { type: 'string', minLength: 3, maxLength: 600, description: 'An event key from read_calendar' }
const allEvents: ToolSchema = {
  type: ['boolean', 'null'],
  description: 'For a repeating event: true changes every occurrence, null or false only this one'
}

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
    access: 'read'
  },
  read_habits: {
    name: 'read_habits',
    description: 'Every habit with its target, plus check-offs (habits to build) or slips (habits to break) between two dates, counted and listed by day.',
    parameters: object(range),
    access: 'read'
  },
  read_gym: {
    name: 'read_gym',
    description: 'Logged gym sets between two dates, grouped by day and exercise, with weight, reps, distance, and time. Pass exerciseId to narrow to one exercise.',
    parameters: object({ ...range, exerciseId: nullableId }),
    access: 'read'
  },
  gym_records: {
    name: 'gym_records',
    description: 'Personal records for one exercise: heaviest weight, best weight at each rep count, estimated one-rep max (Epley), most reps, best set and workout volume, longest distance and time. Dates narrow the window; null means all time.',
    parameters: object({ exerciseId: id, from: nullableDate, to: nullableDate }),
    access: 'read'
  },
  read_health: {
    name: 'read_health',
    description: 'Fitbit data from Google Health between two dates: steps, distance, calories, active zone minutes, resting heart rate, HRV, daily heart rate range, weight, and each night of sleep with its stages. Up to 120 days.',
    parameters: object(range),
    access: 'read'
  },
  read_heart_rate: {
    name: 'read_heart_rate',
    description: 'Five-minute heart rate readings for one day, within the last two weeks.',
    parameters: object({ date }),
    access: 'read'
  },
  money_summary: {
    name: 'money_summary',
    description: 'Income, spending, net, transfers, and budget totals for a date range, in cents. Null dates mean all time.',
    parameters: object({ from: nullableDate, to: nullableDate }),
    access: 'read'
  },
  list_accounts: {
    name: 'list_accounts',
    description: 'Money accounts with their current balances in cents.',
    parameters: object({}),
    access: 'read'
  },
  read_budget: {
    name: 'read_budget',
    description: 'The budget for one month: planned income and the amount per expense category, with what was spent.',
    parameters: object({ month: { type: 'string', pattern: MONTH_PATTERN, description: 'YYYY-MM' } }),
    access: 'read'
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
    access: 'read'
  },
  read_transaction: {
    name: 'read_transaction',
    description: 'One transaction with its receipt lines, if it has a receipt.',
    parameters: object({ transactionId: id }),
    access: 'read'
  },
  read_study: {
    name: 'read_study',
    description: 'Canvas assignments with due dates, courses, and whether each is checked off.',
    parameters: object({}),
    access: 'read'
  },
  read_tasks: {
    name: 'read_tasks',
    description: 'Cards from the Tasks boards with their list, labels, priority, due date, checklist progress, and the start of the description. Open cards only unless includeDone. Due dates narrow to cards due in that range; query matches titles and descriptions. Up to 150 cards.',
    parameters: object({
      boardId: nullableId,
      includeDone: { type: ['boolean', 'null'] },
      dueFrom: nullableDate,
      dueTo: nullableDate,
      query: { type: ['string', 'null'], maxLength: 120 }
    }),
    access: 'read'
  },
  record_transactions: {
    name: 'record_transactions',
    description: 'Record one or more incomes or expenses. Put every transaction the user mentioned in one call. A grocery receipt also fills fridgeItems.',
    parameters: object({ transactions: { type: 'array', minItems: 1, maxItems: 50, items: transaction } }),
    access: 'write'
  },
  save_mood: {
    name: 'save_mood',
    description: 'Set the mood for one day, 1 (awful) to 5 (great). A null note keeps the note already saved for that day.',
    parameters: object({ date, mood: { type: 'integer', minimum: 1, maximum: 5 }, note: { type: ['string', 'null'], maxLength: 2000 } }),
    access: 'write'
  },
  log_habit: {
    name: 'log_habit',
    description: 'Check off a habit to build for a day, or log a slip for a habit to break. times adds several check-offs for a habit with a daily target above one.',
    parameters: object({ habitId: id, date, times: { type: ['integer', 'null'], minimum: 1, maximum: 10 } }),
    access: 'write'
  },
  unlog_habit: {
    name: 'unlog_habit',
    description: 'Take back the latest check-off of a habit for a day.',
    parameters: object({ habitId: id, date }),
    access: 'write'
  },
  log_gym_sets: {
    name: 'log_gym_sets',
    description: 'Log gym sets for one day, in the order they were done. "3x8 at 185" is three sets with reps 8 and weight 185. Leave fields the exercise does not use as null.',
    parameters: object({ date, sets: { type: 'array', minItems: 1, maxItems: 60, items: gymSet } }),
    access: 'write'
  },
  mark_study: {
    name: 'mark_study',
    description: 'Check off a Canvas assignment, or uncheck it.',
    parameters: object({ assignmentId: { type: 'string', minLength: 1, maxLength: 200 }, done: { type: 'boolean' } }),
    access: 'write'
  },
  add_task_card: {
    name: 'add_task_card',
    description: 'Add a card to the bottom of a Tasks list. A due date gets the usual reminder. labelIds come from that board. checklist makes one checklist of these items.',
    parameters: object({
      listId: id,
      title: { type: 'string', minLength: 1, maxLength: 500 },
      description: { type: ['string', 'null'], maxLength: 4000, description: 'Markdown, or null' },
      dueDate: nullableDate,
      dueTime: nullableTime,
      priority,
      labelIds: { type: ['array', 'null'], maxItems: 10, items: id },
      checklist: { type: ['array', 'null'], maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 500 } }
    }),
    access: 'write'
  },
  update_task_card: {
    name: 'update_task_card',
    description: 'Change one Tasks card. Null leaves a field as it is. done marks it done or not done; listId moves it to the bottom of another list on the same board; clearDue removes the due date; archived archives it or brings it back.',
    parameters: object({
      cardId: id,
      done: { type: ['boolean', 'null'] },
      listId: nullableId,
      title: { type: ['string', 'null'], minLength: 1, maxLength: 500 },
      dueDate: nullableDate,
      dueTime: nullableTime,
      clearDue: { type: ['boolean', 'null'] },
      priority,
      archived: { type: ['boolean', 'null'] }
    }),
    access: 'write'
  },
  read_food: {
    name: 'read_food',
    description: 'Food logged between two dates: each entry with its time, calories, protein, carbs, and fat, the totals per day, and the daily targets. Up to 62 days.',
    parameters: object(range),
    access: 'read'
  },
  read_fridge: {
    name: 'read_fridge',
    description: 'Everything on the fridge list, newest first, with when it was added.',
    parameters: object({}),
    access: 'read'
  },
  log_food: {
    name: 'log_food',
    description: 'Log food the user ate. Estimate calories and protein, carbs, and fat for the amount eaten. When a photo is attached, read it, and use a visible nutrition label\'s numbers. Put every dish or snack the user mentioned in one call.',
    parameters: object({ entries: { type: 'array', minItems: 1, maxItems: 20, items: foodEntry } }),
    access: 'write'
  },
  add_fridge_items: {
    name: 'add_fridge_items',
    description: 'Add food to the fridge list, like groceries the user bought or a photo of their fridge.',
    parameters: object({ items: { type: 'array', minItems: 1, maxItems: 60, items: fridgeItem } }),
    access: 'write'
  },
  remove_fridge_items: {
    name: 'remove_fridge_items',
    description: 'Take items off the fridge list, like food that was finished or thrown out. Ids come from read_fridge.',
    parameters: object({ itemIds: { type: 'array', minItems: 1, maxItems: 60, items: id } }),
    access: 'write'
  },
  read_calendar: {
    name: 'read_calendar',
    description: "Google Calendar events between two dates from every ticked calendar, with times on the user's clock, the calendar, location, guests, the user's own answer to invitations, and each event's key. query narrows by title, location, or description. Up to 62 days and 200 events.",
    parameters: object({ ...range, query: { type: ['string', 'null'], maxLength: 120 } }),
    access: 'read'
  },
  add_calendar_event: {
    name: 'add_calendar_event',
    description: 'Add an event to Google Calendar. A null startTime makes an all-day event. calendarId comes from the calendar list; null uses the primary calendar. Guests get Google\'s invitation email.',
    parameters: object({
      calendarId: { type: ['string', 'null'], maxLength: 400 },
      title: { type: 'string', minLength: 1, maxLength: 500 },
      date,
      startTime: { ...nullableTime, description: '24-hour HH:MM on the user\'s clock, or null for all day' },
      endTime: { ...nullableTime, description: 'Null means one hour after the start' },
      endDate: { ...nullableDate, description: 'For an event that ends on a later day, or the last day of a multi-day all-day event' },
      location: { type: ['string', 'null'], maxLength: 500 },
      description: { type: ['string', 'null'], maxLength: 4000 },
      guests: { type: ['array', 'null'], maxItems: 50, items: { type: 'string', minLength: 3, maxLength: 200, description: 'Email address' } },
      meet: { type: ['boolean', 'null'], description: 'True adds a Google Meet link' },
      repeat: { type: ['string', 'null'], maxLength: 300, description: 'An RFC 5545 rule like RRULE:FREQ=WEEKLY;BYDAY=MO,WE, or null for a one-off' }
    }),
    access: 'write'
  },
  update_calendar_event: {
    name: 'update_calendar_event',
    description: 'Change a Google Calendar event the user can edit. Null leaves a field as it is. Moving keeps the length unless endTime is given.',
    parameters: object({
      eventKey,
      title: { type: ['string', 'null'], minLength: 1, maxLength: 500 },
      date: nullableDate,
      startTime: nullableTime,
      endTime: nullableTime,
      location: { type: ['string', 'null'], maxLength: 500 },
      description: { type: ['string', 'null'], maxLength: 4000 },
      allEvents
    }),
    access: 'write'
  },
  delete_calendar_event: {
    name: 'delete_calendar_event',
    description: 'Delete a Google Calendar event the user can edit. Guests are told.',
    parameters: object({ eventKey, allEvents }),
    access: 'write'
  },
  answer_calendar_event: {
    name: 'answer_calendar_event',
    description: 'Answer an invitation as the user: accepted, tentative (maybe), or declined, with an optional note to the organizer.',
    parameters: object({
      eventKey,
      answer: { type: 'string', enum: ['accepted', 'tentative', 'declined'] },
      note: { type: ['string', 'null'], maxLength: 500 },
      allEvents
    }),
    access: 'write'
  },
  set_food_targets: {
    name: 'set_food_targets',
    description: 'Set the daily food targets: calories in kcal, protein, carbs, and fat in grams. Null keeps a target as it is; 0 removes it.',
    parameters: object({ calories: target, protein: target, carbs: target, fat: target }),
    access: 'write'
  },
  remember: {
    name: 'remember',
    description: 'Save a short note about the user that will matter in later chats: a lasting preference, a fact about their life, a person, or a plan. One fact per note, written in the third person, like "Prefers metric for body weight". replaces takes the id of an older note this one corrects. Never save passwords, card numbers, or anything from the diary.',
    parameters: object({
      text: { type: 'string', minLength: 3, maxLength: 300 },
      replaces: { ...nullableId, description: 'The id of a note this one replaces, or null' }
    }),
    access: 'direct'
  },
  forget: {
    name: 'forget',
    description: 'Delete a note about the user that is wrong or no longer true, by its id from the notes list.',
    parameters: object({ id }),
    access: 'direct'
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
