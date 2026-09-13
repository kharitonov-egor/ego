import React, { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import type { T3Status } from '../../shared/types'

const inputClass =
  'w-full px-3 py-2 rounded-lg border border-surface-700 bg-surface-800/50 ' +
  'text-sm text-surface-200 placeholder-surface-500 ' +
  'hover:border-surface-600 focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30 ' +
  'outline-none transition-all'

function describe(status: T3Status): string {
  if (status.expired) return 'Pairing expired or revoked. Pair again.'
  if (status.lastError) return status.lastError
  if (!status.watching) return 'Idle'

  const threads = `Watching ${status.threadCount} thread${status.threadCount === 1 ? '' : 's'}`
  if (!status.expiresAt) return threads

  const days = Math.round((status.expiresAt - Date.now()) / 86_400_000)
  return days > 0 ? `${threads} · renew in ${days}d` : threads
}

export default function T3Settings(): React.ReactElement {
  const [status, setStatus] = useState<T3Status | null>(null)
  const [pairingUrl, setPairingUrl] = useState('')
  const [pairing, setPairing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.t3GetStatus().then(setStatus)
    const id = setInterval(() => void window.api.t3GetStatus().then(setStatus), 5000)
    return () => clearInterval(id)
  }, [])

  const pair = async (): Promise<void> => {
    setPairing(true)
    setError(null)
    const result = await window.api.t3Pair(pairingUrl.trim())
    setPairing(false)
    if (!result.ok) {
      setError(result.detail)
      return
    }
    setPairingUrl('')
    setStatus(await window.api.t3GetStatus())
  }

  const unpair = async (): Promise<void> => {
    setStatus(await window.api.t3Unpair())
    setError(null)
  }

  const toggle = async (enabled: boolean): Promise<void> => {
    setStatus(await window.api.t3SetEnabled(enabled))
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <Bell size={14} />
        <h3 className="text-sm font-medium text-surface-300">T3 Code thread notifications</h3>
      </div>
      <p className="text-xs text-surface-500 mb-4">
        Toasts when a turn finishes, fails, or blocks on your approval.
      </p>

      {status?.paired ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-surface-700 bg-surface-800/50 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm text-surface-200 truncate">{status.origin}</div>
              <div className="text-xs text-surface-500">{describe(status)}</div>
            </div>
            <button
              type="button"
              onClick={() => void unpair()}
              className="shrink-0 text-[11px] text-surface-500 hover:text-red-400 transition-colors"
            >
              Unpair
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-surface-400">
            <input
              type="checkbox"
              checked={status.enabled}
              onChange={(event) => void toggle(event.target.checked)}
            />
            Notify me about thread activity
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-surface-500">
            In T3 Code open Settings, then Connections, and create a pairing link with
            orchestration:read. Paste it here.
          </p>
          <input
            value={pairingUrl}
            onChange={(event) => setPairingUrl(event.target.value)}
            placeholder="http://127.0.0.1:3773/pair#token=..."
            className={inputClass}
          />
          <div className="flex items-center justify-between">
            {error ? <span className="text-[11px] text-red-400">{error}</span> : <span />}
            <button
              type="button"
              disabled={pairing || !pairingUrl.trim()}
              onClick={() => void pair()}
              className="rounded-lg bg-accent-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
            >
              {pairing ? 'Pairing…' : 'Pair with T3 Code'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
