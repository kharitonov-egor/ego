import { describe, expect, it } from 'vitest'
import {
  LIVE_TOOL_NAMES,
  LIVE_TOOL_REGISTRY,
  validateLiveToolArguments
} from '../src/live-tools'

describe('live tool registry', () => {
  it('uses strict object schemas for every tool', () => {
    expect(LIVE_TOOL_NAMES).toHaveLength(9)
    for (const name of LIVE_TOOL_NAMES) {
      expect(LIVE_TOOL_REGISTRY[name].parameters).toMatchObject({
        type: 'object', additionalProperties: false
      })
      expect(new Set(LIVE_TOOL_REGISTRY[name].parameters.required as string[])).toEqual(
        new Set(Object.keys(LIVE_TOOL_REGISTRY[name].parameters.properties as object))
      )
      expect(LIVE_TOOL_REGISTRY[name].maxResultBytes).toBeGreaterThan(0)
    }
  })

  it('rejects unknown and malformed arguments', () => {
    expect(validateLiveToolArguments('ego_list_accounts', { surprise: true })).toEqual({
      ok: false, error: 'Unknown argument: surprise'
    })
    expect(validateLiveToolArguments('gmail_search', { query: '', maxResults: 11 }).ok).toBe(false)
    expect(validateLiveToolArguments('ego_get_summary', { from: '09/12/2026' }).ok).toBe(false)
  })

  it('enforces transaction relationships before a write can run', () => {
    expect(validateLiveToolArguments('ego_record_transaction', {
      kind: 'transfer', accountId: 'checking', destinationAccountId: 'checking',
      amountCents: 100, date: '2026-09-15'
    }).ok).toBe(false)
    expect(validateLiveToolArguments('ego_record_transaction', {
      kind: 'expense', accountId: 'checking', categoryId: 'food',
      destinationAccountId: null, amountCents: 100, date: '2026-09-15', merchant: 'Cafe', notes: null
    }).ok).toBe(true)
  })
})
