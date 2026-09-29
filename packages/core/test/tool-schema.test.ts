import { describe, expect, it } from 'vitest'
import { validateAssistantArguments } from '../src/assistant-tools'
import { validateToolArguments, type ToolSchema } from '../src/tool-schema'

const schema: ToolSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['date', 'note', 'sets'],
  properties: {
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    note: { type: ['string', 'null'], maxLength: 5 },
    sets: {
      type: 'array', minItems: 1, maxItems: 2,
      items: {
        type: 'object', additionalProperties: false, required: ['reps', 'unit'],
        properties: { reps: { type: ['integer', 'null'], minimum: 0 }, unit: { type: ['string', 'null'], enum: ['lbs', 'kg', null] } }
      }
    }
  }
}

describe('validateToolArguments', () => {
  it('fills nullable fields that were left out', () => {
    expect(validateToolArguments(schema, { date: '2026-09-28', sets: [{ reps: 8 }] })).toEqual({
      ok: true, value: { date: '2026-09-28', note: null, sets: [{ reps: 8, unit: null }] }
    })
  })

  it('names the field that is wrong, including inside lists', () => {
    expect(validateToolArguments(schema, { sets: [{ reps: 8 }] })).toEqual({ ok: false, error: 'date is missing' })
    expect(validateToolArguments(schema, { date: '2026-09-28', sets: [{ reps: 8.5 }] })).toEqual({ ok: false, error: 'sets[0].reps must be integer or null' })
    expect(validateToolArguments(schema, { date: '2026-09-28', sets: [{ reps: 8, unit: 'stone' }] })).toEqual({ ok: false, error: 'sets[0].unit must be one of lbs, kg' })
    expect(validateToolArguments(schema, { date: '2026-09-28', sets: [] })).toEqual({ ok: false, error: 'sets needs at least 1 item' })
    expect(validateToolArguments(schema, { date: '2026-09-28', note: 'toolong', sets: [{ reps: 1 }] })).toEqual({ ok: false, error: 'note is too long' })
    expect(validateToolArguments(schema, { date: '28/09/2026', sets: [{ reps: 1 }] })).toEqual({ ok: false, error: 'date has the wrong format' })
  })

  it('rejects fields the schema does not know', () => {
    expect(validateToolArguments(schema, { date: '2026-09-28', sets: [{ reps: 8 }], extra: 1 })).toEqual({ ok: false, error: 'extra is not a known field' })
    expect(validateToolArguments(schema, { date: '2026-09-28', sets: [{ reps: 8, weight: 1 }] })).toEqual({ ok: false, error: 'sets[0].weight is not a known field' })
    expect(validateToolArguments(schema, 'nope')).toEqual({ ok: false, error: 'Tool arguments must be an object' })
  })

  it('checks the assistant tools against their own schemas', () => {
    expect(validateAssistantArguments('save_mood', { date: '2026-09-28', mood: 4 })).toEqual({ ok: true, value: { date: '2026-09-28', mood: 4, note: null } })
    expect(validateAssistantArguments('save_mood', { date: '2026-09-28', mood: 6 })).toEqual({ ok: false, error: 'mood is too large' })
    expect(validateAssistantArguments('record_transactions', { transactions: [] })).toEqual({ ok: false, error: 'transactions needs at least 1 item' })
    const receipt = validateAssistantArguments('record_transactions', {
      transactions: [{
        kind: 'expense', accountId: 'a', categoryId: 'c', amountCents: 500, date: '2026-09-28',
        receipt: { merchant: 'Publix', purchaseDate: '2026-09-28', subtotalCents: 500, discountCents: 0, taxCents: 0, feesCents: 0, totalCents: 500, items: [{ name: 'Milk', quantity: 1, grossPriceCents: 500, discountCents: 0, lineTotalCents: 500 }] }
      }]
    })
    expect(receipt.ok).toBe(true)
    if (receipt.ok) {
      const [first] = receipt.value.transactions as Array<Record<string, unknown>>
      expect(first.merchant).toBeNull()
      expect((first.receipt as { items: Array<Record<string, unknown>> }).items[0].unitPriceCents).toBeNull()
    }
  })
})
