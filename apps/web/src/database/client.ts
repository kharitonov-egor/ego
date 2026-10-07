import { migrate } from '@ego/local/database/migrations'
import type { LocalDatabase } from '@ego/local/database/types'
import { createRemoteDatabase, type DatabaseBridge } from '@ego/ui/platform/remote-database'
import type { DatabaseMessage, DatabaseReply, DatabaseRequest, DatabaseResults } from './protocol'

type Request<K extends DatabaseRequest['type']> = Extract<DatabaseRequest, { type: K }>

export type Send = <K extends DatabaseRequest['type']>(request: Request<K>) => Promise<DatabaseResults[K]>

interface Connection {
  send: Send
  terminate: () => void
}

function connect(): Connection {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'ego-database' })
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  let nextId = 0
  worker.onmessage = (event: MessageEvent<DatabaseReply>): void => {
    const reply = event.data
    const waiting = pending.get(reply.id)
    if (!waiting) return
    pending.delete(reply.id)
    if (reply.ok) waiting.resolve(reply.value)
    else waiting.reject(new Error(reply.message))
  }
  worker.onerror = (): void => {
    for (const waiting of pending.values()) waiting.reject(new Error('The database worker stopped'))
    pending.clear()
  }
  return {
    send: <K extends DatabaseRequest['type']>(request: Request<K>): Promise<DatabaseResults[K]> =>
      new Promise<DatabaseResults[K]>((resolve, reject) => {
        nextId += 1
        pending.set(nextId, { resolve: (value) => resolve(value as DatabaseResults[K]), reject })
        worker.postMessage({ id: nextId, request } satisfies DatabaseMessage)
      }),
    terminate: () => {
      worker.terminate()
      for (const waiting of pending.values()) waiting.reject(new Error('The database closed'))
      pending.clear()
    }
  }
}

function turnstile(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve()
  return async <T>(work: () => Promise<T>): Promise<T> => {
    const previous = tail
    let release!: () => void
    tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await work()
    } finally {
      release()
    }
  }
}

export interface BrowserDatabase {
  /** What `window.api` hands the screens, the same calls the desktop sends over IPC. */
  bridge: DatabaseBridge
  /** For sync in this page. Its transactions take turns with the screens' through the bridge. */
  local: LocalDatabase
  close: () => Promise<void>
}

/**
 * Like the desktop's main process, this runs one statement or transaction at a time, so a sync
 * never lands inside a transaction a screen opened.
 */
export function createDatabaseBridge(send: Send): { bridge: DatabaseBridge; close: () => Promise<void> } {
  const turn = turnstile()
  const open = new Map<number, () => void>()
  let nextTransaction = 0

  const within = (transaction: number): void => {
    if (!open.has(transaction)) throw new Error('That transaction already ended')
  }

  const bridge: DatabaseBridge = {
    localAll: async (transaction, sql, params) => {
      if (transaction === null) return turn(() => send({ type: 'all', sql, params }))
      within(transaction)
      return send({ type: 'all', sql, params })
    },
    localRun: async (transaction, sql, params) => {
      if (transaction === null) return turn(() => send({ type: 'run', sql, params }))
      within(transaction)
      return send({ type: 'run', sql, params })
    },
    localBegin: () => new Promise<number>((opened, failed) => {
      void turn(() => new Promise<void>((release) => {
        nextTransaction += 1
        const id = nextTransaction
        send({ type: 'exec', sql: 'BEGIN' }).then(() => {
          open.set(id, release)
          opened(id)
        }, (error: unknown) => {
          release()
          failed(error)
        })
      }))
    }),
    localFinish: async (transaction, commit) => {
      const release = open.get(transaction)
      if (!release) {
        if (commit) throw new Error('That transaction already ended and was rolled back')
        return
      }
      open.delete(transaction)
      try {
        if (!commit) {
          await send({ type: 'exec', sql: 'ROLLBACK' })
          return
        }
        try {
          await send({ type: 'exec', sql: 'COMMIT' })
        } catch (error: unknown) {
          await send({ type: 'exec', sql: 'ROLLBACK' }).catch(() => undefined)
          throw error
        }
      } finally {
        release()
      }
    }
  }

  return {
    bridge,
    close: async () => {
      for (const id of [...open.keys()]) await bridge.localFinish(id, false).catch(() => undefined)
      await turn(() => send({ type: 'close' })).catch(() => undefined)
    }
  }
}

/** The browser's copy of the ledger, in a worker, brought up to the current schema. */
export async function openBrowserDatabase(file: string | null): Promise<BrowserDatabase> {
  const connection = connect()
  try {
    await connection.send({ type: 'open', file })
    const { bridge, close } = createDatabaseBridge(connection.send)
    const local = createRemoteDatabase(() => bridge)
    await migrate(local)
    return {
      bridge,
      local,
      close: async () => {
        await close()
        connection.terminate()
      }
    }
  } catch (error: unknown) {
    connection.terminate()
    throw error
  }
}

/** Deletes every ledger file this browser keeps, for sign-out. The database must be closed first. */
export async function eraseBrowserDatabases(): Promise<void> {
  const connection = connect()
  try {
    await connection.send({ type: 'erase' })
  } finally {
    connection.terminate()
  }
}
