/**
 * The JSON Schema subset the assistant tools are written in. Small enough to check by hand,
 * rich enough for a list of sets or a receipt with its lines.
 */
export type SchemaType = 'string' | 'integer' | 'number' | 'boolean' | 'null' | 'array' | 'object'

export interface ToolSchema {
  type: SchemaType | SchemaType[]
  description?: string
  enum?: ReadonlyArray<string | number | null>
  minLength?: number
  maxLength?: number
  pattern?: string
  minimum?: number
  maximum?: number
  items?: ToolSchema
  minItems?: number
  maxItems?: number
  properties?: Record<string, ToolSchema>
  required?: string[]
  /** true passes unknown keys through unchecked, for arguments another service validates. */
  additionalProperties?: boolean
}

export type ToolValidation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

type Checked = { ok: true; value: unknown } | { ok: false; error: string }

function typesOf(schema: ToolSchema): SchemaType[] {
  return Array.isArray(schema.type) ? schema.type : [schema.type]
}

function matches(value: unknown, type: SchemaType): boolean {
  switch (type) {
    case 'null': return value === null
    case 'string': return typeof value === 'string'
    case 'integer': return Number.isSafeInteger(value)
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'boolean': return typeof value === 'boolean'
    case 'array': return Array.isArray(value)
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value)
  }
}

function describeType(schema: ToolSchema): string {
  return typesOf(schema).join(' or ')
}

function check(schema: ToolSchema, value: unknown, path: string): Checked {
  const types = typesOf(schema)
  if (value === undefined) {
    if (types.includes('null')) return { ok: true, value: null }
    return { ok: false, error: `${path} is missing` }
  }
  if (!types.some((type) => matches(value, type))) {
    return { ok: false, error: `${path} must be ${describeType(schema)}` }
  }
  if (value === null) return { ok: true, value: null }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) return { ok: false, error: `${path} is too short` }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return { ok: false, error: `${path} is too long` }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) return { ok: false, error: `${path} has the wrong format` }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return { ok: false, error: `${path} is too small` }
    if (schema.maximum !== undefined && value > schema.maximum) return { ok: false, error: `${path} is too large` }
  }
  if (schema.enum && (typeof value === 'string' || typeof value === 'number') && !schema.enum.includes(value)) {
    return { ok: false, error: `${path} must be one of ${schema.enum.filter((item) => item !== null).join(', ')}` }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return { ok: false, error: `${path} needs at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}` }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return { ok: false, error: `${path} has too many items` }
    if (!schema.items) return { ok: true, value }
    const items: unknown[] = []
    for (const [index, item] of value.entries()) {
      const checked = check(schema.items, item, `${path}[${index}]`)
      if (!checked.ok) return checked
      items.push(checked.value)
    }
    return { ok: true, value: items }
  }
  if (typeof value === 'object') {
    const properties = schema.properties ?? {}
    const input = value as Record<string, unknown>
    const open = schema.additionalProperties === true
    for (const key of Object.keys(input)) {
      if (!open && !Object.prototype.hasOwnProperty.call(properties, key)) return { ok: false, error: `${path}.${key} is not a known field` }
    }
    const output: Record<string, unknown> = open ? { ...input } : {}
    for (const [key, property] of Object.entries(properties)) {
      const checked = check(property, input[key], path === '' ? key : `${path}.${key}`)
      if (!checked.ok) return checked
      output[key] = checked.value
    }
    return { ok: true, value: output }
  }
  return { ok: true, value }
}

/**
 * Checks tool arguments against their schema and returns them normalized: every declared field
 * present, with null for anything nullable the model left out.
 */
export function validateToolArguments(schema: ToolSchema, value: unknown): ToolValidation {
  if (!matches(value, 'object')) return { ok: false, error: 'Tool arguments must be an object' }
  const checked = check(schema, value, '')
  if (!checked.ok) return { ok: false, error: checked.error.replace(/^\./, '') }
  return { ok: true, value: checked.value as Record<string, unknown> }
}
