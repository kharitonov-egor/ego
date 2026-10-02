import { afterEach, describe, expect, it } from 'vitest'
import type { LocalDatabase } from '../lib/database/types'
import { SPEND_DAYS, localGlance } from '../lib/launcher/summary'
import { openTestLedger } from './local-db'

const NOW = new Date(2026, 8, 30, 9, 0)
const TODAY = '2026-09-30'
const STAMP = '2026-09-30T09:00:00.000Z'
let db: LocalDatabase | null = null

afterEach(async () => {
  await db?.close()
  db = null
})

async function spend(database: LocalDatabase, id: string, date: string, cents: number, kind = 'expense'): Promise<void> {
  await database.run(`INSERT INTO transactions (id, kind, account_id, category_id, amount_cents, date, created_at, updated_at)
    VALUES (?, ?, 'acct', 'cat', ?, ?, ?, ?)`, [id, kind, cents, date, STAMP, STAMP])
}

describe('the start screen glance', () => {
  it('reads every part from an empty phone', async () => {
    db = await openTestLedger()
    const glance = await localGlance(db, TODAY, NOW)
    expect(glance.habits).toEqual(expect.objectContaining({ done: 0, total: 0, week: [0, 0, 0, 0, 0, 0, 0] }))
    expect(glance.money).toEqual({ todayCents: 0, monthCents: 0, days: Array.from({ length: SPEND_DAYS }, () => 0) })
    expect(glance.gym).toEqual({ setsToday: 0, lastDate: null, week: [false, false, false, false, false, false, false] })
    expect(glance.health).toEqual({ connected: false, steps: null, sleepMinutes: null })
    expect(glance.study).toEqual({ overdue: 0, week: 0, next: null })
    expect(glance.moodLogged).toBe(false)
    expect(glance.diary).toEqual({ lastAt: null })
  })

  it('totals this month and the last two weeks of spending, leaving out income and deleted rows', async () => {
    db = await openTestLedger()
    await spend(db, 't1', TODAY, 1250)
    await spend(db, 't2', TODAY, 750)
    await spend(db, 't3', '2026-09-02', 4000)
    await spend(db, 't4', '2026-08-25', 9900)
    await spend(db, 't5', TODAY, 50000, 'income')
    await spend(db, 't6', TODAY, 3000)
    await db.run('UPDATE transactions SET deleted_at = ? WHERE id = ?', [STAMP, 't6'])
    const money = (await localGlance(db, TODAY, NOW)).money
    expect(money?.todayCents).toBe(2000)
    expect(money?.monthCents).toBe(6000)
    expect(money?.days).toHaveLength(SPEND_DAYS)
    expect(money?.days[SPEND_DAYS - 1]).toBe(2000)
    expect(money?.days.reduce((sum, cents) => sum + cents, 0)).toBe(2000)
  })
})
