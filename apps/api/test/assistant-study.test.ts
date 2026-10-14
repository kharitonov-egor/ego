import { afterEach, describe, expect, it } from 'vitest'
import { validateAssistantArguments } from '@ego/core'
import { describeWrite, executeAssistantRead, executeAssistantWrite, type ToolContext } from '../src/assistant-tools'
import { readStudyEntries } from '../src/reads'
import { toStudyEntryRecord } from '../src/rows'
import { NOW, seedLedger, type Ledger } from './helpers'

const TODAY = '2026-09-12'
let ledger: Ledger | null = null

afterEach(() => {
  ledger?.close()
  ledger = null
})

async function context(): Promise<ToolContext> {
  ledger = await seedLedger()
  return {
    env: { DB: ledger.db },
    device: { deviceId: 'device-a', name: 'Phone', datasetId: 'ego' },
    now: NOW,
    today: TODAY,
    timeZone: 'America/New_York',
    units: 'imperial'
  }
}

async function entries(ctx: ToolContext) {
  return (await readStudyEntries(ctx.env.DB)).map(toStudyEntryRecord)
}

describe('Study items in the AI chat', () => {
  it('adds an exam at a time on the user\'s clock', async () => {
    const ctx = await context()
    const args = { kind: 'exam', title: 'Midterm 2', course: 'COP4530', date: '2026-10-20', time: '14:00', notes: null }
    expect(validateAssistantArguments('add_study_item', args).ok).toBe(true)
    expect(await describeWrite(ctx, 'add_study_item', args)).toEqual({
      title: 'Add an exam', lines: ['"Midterm 2" · COP4530', 'Oct 20 at 2:00 PM']
    })
    const outcome = await executeAssistantWrite(ctx, { name: 'add_study_item', args, callId: 'call-1' })
    expect(outcome.trail).toBe('Added an exam, "Midterm 2"')
    expect(await entries(ctx)).toMatchObject([{
      kind: 'exam', title: 'Midterm 2', course: 'COP4530', due: { kind: 'time', at: '2026-10-20T18:00:00.000Z' }, notes: '', doneAt: null
    }])
  })

  it('adds a whole-day deadline, reads it back without Canvas, and checks it off', async () => {
    const ctx = await context()
    const args = { kind: 'deadline', title: 'Last day to withdraw', course: null, date: '2026-10-30', time: null, notes: 'Online form' }
    await executeAssistantWrite(ctx, { name: 'add_study_item', args, callId: 'call-2' })
    const [entry] = await entries(ctx)
    expect(entry).toMatchObject({ due: { kind: 'day', date: '2026-10-30' }, notes: 'Online form' })

    const read = await executeAssistantRead(ctx, { name: 'read_study', args: {}, callId: 'call-3' })
    expect(read.data).toMatchObject({
      assignments: [{ id: entry.id, kind: 'deadline', due: '2026-10-30', dueIsWholeDay: true, done: false, addedByUser: true }],
      canvasError: 'The Canvas calendar is not set up on the server'
    })

    const marked = await executeAssistantWrite(ctx, { name: 'mark_study', args: { assignmentId: entry.id, done: true }, callId: 'call-4' })
    expect(marked.trail).toBe('Checked off "Last day to withdraw"')
    expect((await entries(ctx))[0]).toMatchObject({ doneAt: NOW, revision: 2 })
  })

  it('keeps 11:59 PM on the night the clocks go back, and takes a known course\'s spelling', async () => {
    const ctx = await context()
    await executeAssistantWrite(ctx, { name: 'add_study_item', args: { kind: 'exam', title: 'Quiz', course: 'COP4530', date: '2026-10-28', time: null, notes: null }, callId: 'call-6' })
    const args = { kind: 'assignment', title: 'Lab 7', course: 'cop 4530', date: '2026-11-01', time: '23:59', notes: null }
    await executeAssistantWrite(ctx, { name: 'add_study_item', args, callId: 'call-7' })
    const lab = (await entries(ctx)).find((entry) => entry.title === 'Lab 7')
    expect(lab).toMatchObject({ course: 'COP4530', due: { kind: 'time', at: '2026-11-02T04:59:00.000Z' } })
    expect(await describeWrite(ctx, 'mark_study', { assignmentId: (await entries(ctx))[0].id, done: true })).toEqual({
      title: 'Check off an exam', lines: ['"Quiz"']
    })
  })

  it('turns away a day that does not exist', async () => {
    const ctx = await context()
    const args = { kind: 'exam', title: 'Final', course: null, date: '2026-02-30', time: '09:00', notes: null }
    await expect(executeAssistantWrite(ctx, { name: 'add_study_item', args, callId: 'call-8' })).rejects.toThrow('does not exist')
  })

  it('still fails a read with nothing added and no Canvas', async () => {
    const ctx = await context()
    await expect(executeAssistantRead(ctx, { name: 'read_study', args: {}, callId: 'call-5' })).rejects.toThrow('not set up')
  })
})
