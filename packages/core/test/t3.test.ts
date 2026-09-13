import { describe, expect, it } from 'vitest'
import {
  diffShell,
  formatDuration,
  parsePairingUrl,
  parseServerRuntimeOrigin,
  parseShell,
  type T3Shell,
  type T3WatchState
} from '../src/t3'

function shellPayload(
  overrides: Record<string, unknown>
): Record<string, unknown> {
  return {
    snapshotSequence: 1,
    updatedAt: '2026-09-10T10:00:00.000Z',
    projects: [
      { id: 'p1', title: 'ego', faviconPath: '/api/assets/ego.png', projectIcon: null }
    ],
    threads: [
      {
        id: 't1',
        projectId: 'p1',
        title: 'Thread notifications',
        modelSelection: { instanceId: 'claudeAgent', model: 'claude-opus-5' },
        branch: 'master',
        latestTurn: {
          turnId: 'turn-1',
          state: 'running',
          requestedAt: '2026-09-10T09:55:00.000Z',
          startedAt: '2026-09-10T09:55:00.000Z',
          completedAt: null,
          assistantMessageId: null
        },
        archivedAt: null,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        hasActionableProposedPlan: false,
        session: { status: 'running', lastError: null },
        ...overrides
      }
    ]
  }
}

function seed(shell: T3Shell): T3WatchState {
  return diffShell(null, shell).state
}

describe('parsePairingUrl', () => {
  it('reads the token from the fragment', () => {
    expect(parsePairingUrl('http://127.0.0.1:3773/pair#token=abc123')).toEqual({
      origin: 'http://127.0.0.1:3773',
      credential: 'abc123'
    })
  })

  it('falls back to the query string', () => {
    expect(parsePairingUrl('https://box.ts.net/pair?token=xyz')?.credential).toBe('xyz')
  })

  it('rejects a link with no token', () => {
    expect(parsePairingUrl('http://127.0.0.1:3773/pair')).toBeNull()
    expect(parsePairingUrl('not a url')).toBeNull()
  })
})

describe('parseServerRuntimeOrigin', () => {
  it('prefers the explicit origin', () => {
    expect(
      parseServerRuntimeOrigin({ host: '127.0.0.1', port: 4000, origin: 'http://127.0.0.1:3773' })
    ).toBe('http://127.0.0.1:3773')
  })

  it('falls back to host and port', () => {
    expect(parseServerRuntimeOrigin({ host: '127.0.0.1', port: 4111 })).toBe(
      'http://127.0.0.1:4111'
    )
    expect(parseServerRuntimeOrigin({ host: '127.0.0.1' })).toBeNull()
  })
})

describe('parseShell', () => {
  it('reads threads and drops archived ones', () => {
    const parsed = parseShell(shellPayload({}))
    expect(parsed?.threads).toHaveLength(1)
    expect(parsed?.threads[0].model).toBe('claude-opus-5')
    expect(parsed?.threads[0].provider).toBe('claudeAgent')
    expect(parsed?.threads[0].branch).toBe('master')
    expect(parsed?.projects.p1.title).toBe('ego')
    expect(parsed?.projects.p1.faviconPath).toBe('/api/assets/ego.png')

    expect(parseShell(shellPayload({ branch: null }))?.threads[0].branch).toBeNull()

    expect(parseShell(shellPayload({ archivedAt: '2026-09-10T09:00:00.000Z' }))?.threads).toEqual(
      []
    )
  })

  it('returns null on a payload that is not a shell', () => {
    expect(parseShell({ nope: true })).toBeNull()
  })
})

describe('diffShell', () => {
  const running = parseShell(shellPayload({}))!

  const completed = parseShell(
    shellPayload({
      latestTurn: {
        turnId: 'turn-1',
        state: 'completed',
        requestedAt: '2026-09-10T09:55:00.000Z',
        startedAt: '2026-09-10T09:55:00.000Z',
        completedAt: '2026-09-10T09:59:12.000Z',
        assistantMessageId: 'm1'
      }
    })
  )!

  it('stays quiet on the first snapshot', () => {
    expect(diffShell(null, completed).events).toEqual([])
  })

  it('reports a finished turn with its duration', () => {
    const { events } = diffShell(seed(running), completed)
    expect(events).toEqual([
      {
        kind: 'finished',
        threadId: 't1',
        title: 'Thread notifications',
        project: {
          id: 'p1',
          title: 'ego',
          faviconPath: '/api/assets/ego.png',
          emoji: null,
          color: null
        },
        model: 'claude-opus-5',
        provider: 'claudeAgent',
        branch: 'master',
        durationMs: 252_000,
        detail: null
      }
    ])
  })

  it('does not repeat the event on the next poll', () => {
    const after = diffShell(seed(running), completed).state
    expect(diffShell(after, completed).events).toEqual([])
  })

  it('holds the finish until background work stops', () => {
    const stillWorking = parseShell(
      shellPayload({
        latestTurn: {
          turnId: 'turn-1',
          state: 'completed',
          requestedAt: '2026-09-10T09:55:00.000Z',
          startedAt: '2026-09-10T09:55:00.000Z',
          completedAt: '2026-09-10T09:59:12.000Z',
          assistantMessageId: 'm1'
        },
        backgroundLiveness: 'working'
      })
    )!

    const held = diffShell(seed(running), stillWorking)
    expect(held.events).toEqual([])

    const released = diffShell(held.state, completed)
    expect(released.events.map((event) => event.kind)).toEqual(['finished'])
  })

  it('reports an errored turn with the session error', () => {
    const errored = parseShell(
      shellPayload({
        latestTurn: {
          turnId: 'turn-1',
          state: 'error',
          requestedAt: '2026-09-10T09:55:00.000Z',
          startedAt: '2026-09-10T09:55:00.000Z',
          completedAt: '2026-09-10T09:56:00.000Z',
          assistantMessageId: null
        },
        session: { status: 'error', lastError: 'provider exited with code 1' }
      })
    )!

    const { events } = diffShell(seed(running), errored)
    expect(events[0].kind).toBe('errored')
    expect(events[0].detail).toBe('provider exited with code 1')
  })

  it('stays quiet when the user interrupts the turn', () => {
    const interrupted = parseShell(
      shellPayload({
        latestTurn: {
          turnId: 'turn-1',
          state: 'interrupted',
          requestedAt: '2026-09-10T09:55:00.000Z',
          startedAt: '2026-09-10T09:55:00.000Z',
          completedAt: '2026-09-10T09:56:00.000Z',
          assistantMessageId: null
        }
      })
    )!

    expect(diffShell(seed(running), interrupted).events).toEqual([])
  })

  it('reports an approval only on the edge into waiting', () => {
    const waiting = parseShell(shellPayload({ hasPendingApprovals: true }))!

    const first = diffShell(seed(running), waiting)
    expect(first.events.map((event) => event.kind)).toEqual(['waiting'])
    expect(diffShell(first.state, waiting).events).toEqual([])
  })
})

describe('formatDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(9_000)).toBe('9s')
    expect(formatDuration(252_000)).toBe('4m12s')
    expect(formatDuration(7_260_000)).toBe('2h01m')
    expect(formatDuration(null)).toBeNull()
  })
})
