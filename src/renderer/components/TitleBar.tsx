import React, { useState, useEffect } from 'react'
import { Minus, Square, X, Package, Loader2, Check, AlertCircle } from 'lucide-react'
import { windowMinimize, windowMaximize, windowClose } from '../hooks/useIpc'
import appIcon from '../app-icon.png'
import type { BuildStage } from '../../shared/types'

type BuildStatus = 'idle' | BuildStage

const BUILD_LABELS: Record<BuildStatus, string> = {
  idle: 'Build & Install',
  compiling: 'Compiling…',
  packaging: 'Packaging…',
  installing: 'Launching installer…',
  done: 'Done!',
  error: 'Build failed'
}

export default function TitleBar(): React.ReactElement {
  const [build, setBuild] = useState<BuildStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!window.api?.onBuildProgress) return
    return window.api.onBuildProgress((stage) => {
      setBuild(stage)
      if (stage === 'done' || stage === 'error') {
        setTimeout(() => setBuild('idle'), 4000)
      }
    })
  }, [])

  const handleBuild = async (): Promise<void> => {
    if (build !== 'idle') return
    if (!window.api?.buildAndInstall) return
    setErrorMsg('')
    setBuild('compiling')
    const result = await window.api.buildAndInstall()
    if (!result.success) {
      setErrorMsg(result.error ?? 'Unknown error')
      setBuild('error')
      setTimeout(() => setBuild('idle'), 4000)
    }
  }

  const isBuilding = build === 'compiling' || build === 'packaging' || build === 'installing'

  return (
    <div
      className="flex items-center h-8 bg-surface-950 border-b border-surface-800 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 px-3 text-xs font-medium text-surface-300">
        <img src={appIcon} alt="" className="h-4 w-4 rounded-sm" />
        <span>Ego</span>
      </div>

      <div
        className="flex items-center ml-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => void handleBuild()}
          disabled={isBuilding}
          title={build === 'error' && errorMsg ? `Build failed: ${errorMsg}` : BUILD_LABELS[build]}
          className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${
            build === 'done'
              ? 'text-emerald-400'
              : build === 'error'
                ? 'text-red-400'
                : isBuilding
                  ? 'text-accent-400'
                  : 'text-surface-600 hover:text-surface-300 hover:bg-surface-800'
          }`}
        >
          {build === 'idle' && <Package size={12} />}
          {isBuilding && <Loader2 size={12} className="animate-spin" />}
          {build === 'done' && <Check size={12} />}
          {build === 'error' && <AlertCircle size={12} />}
        </button>
        {build !== 'idle' && (
          <span
            className={`text-[10px] ml-1 ${
              build === 'done'
                ? 'text-emerald-400'
                : build === 'error'
                  ? 'text-red-400'
                  : 'text-surface-500'
            }`}
          >
            {BUILD_LABELS[build]}
          </span>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={windowMinimize}
          className="h-8 w-10 flex items-center justify-center hover:bg-surface-800 transition-colors text-surface-400 hover:text-surface-200"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={windowMaximize}
          className="h-8 w-10 flex items-center justify-center hover:bg-surface-800 transition-colors text-surface-400 hover:text-surface-200"
        >
          <Square size={11} />
        </button>
        <button
          onClick={windowClose}
          className="h-8 w-10 flex items-center justify-center hover:bg-red-600 transition-colors text-surface-400 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
