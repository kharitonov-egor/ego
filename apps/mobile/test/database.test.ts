import { afterEach, describe, expect, it } from 'vitest'
import { withPreparedRuns, type LocalDatabase } from '../lib/database/types'
import { openTestLedger } from './local-db'

let db: LocalDatabase | null = null

afterEach(async () => {
  await db?.close()
  db = null
})

describe('prepared writes', () => {
  it('prepares each SQL string once and finalizes it after the batch', async () => {
    db = await openTestLedger()
    let prepares = 0
    let finalizes = 0
    const observed: LocalDatabase = {
      ...db,
      prepare: async (sql) => {
        prepares += 1
        const statement = await db!.prepare(sql)
        return {
          run: statement.run,
          finalize: async () => {
            finalizes += 1
            await statement.finalize()
          }
        }
      }
    }

    await withPreparedRuns(observed, async (cached) => {
      await cached.run('UPDATE sync_state SET server_sequence = ? WHERE id = 1', [1])
      await cached.run('UPDATE sync_state SET server_sequence = ? WHERE id = 1', [2])
      await cached.run('UPDATE sync_state SET bootstrapped_at = ? WHERE id = 1', ['2026-09-28'])
    })

    expect(prepares).toBe(2)
    expect(finalizes).toBe(2)
  })
})
