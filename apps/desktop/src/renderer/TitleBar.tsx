import React, { useState, useEffect } from 'react'
import { Minus, Square, X, Package, LoaderCircle, Check, CircleAlert } from 'lucide-react'
import { windowMinimize, windowMaximize, windowClose } from '../hooks/useIpc'
import appIcon from '../app-icon.png'
import type { BuildStage } from '../../shared/types'
import { cn } from '../lib/utils'

type BuildStatus = 'idle' | BuildStage

const BUILD_LABELS: Record<BuildStatus, string> = {
  idle: 'Build & Install',
  compiling: 'Compiling…',
  packaging: 'Packaging…',
  installing: 'Launching installer…',
  done: 'Done!',
  error: 'Build failed'
}

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

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
  const tone = build === 'done' ? 'text-positive' : build === 'error' ? 'text-destructive' : isBuilding ? 'text-foreground' : 'text-surface-600 hover:text-surface-300 hover:bg-surface-800'

  return (
    <div className="flex h-9 shrink-0 select-none items-center border-b border-border bg-background" style={drag}>
      <div className="flex items-center gap-2 px-3 text-[13px] font-semibold text-surface-300">
        <img src={appIcon} alt="" className="h-4 w-4 rounded-sm" />
        <span>Ego</span>
      </div>

      <div className="ml-1 flex items-center" style={noDrag}>
        <button
          type="button"
          aria-label={BUILD_LABELS[build]}
          onClick={() => void handleBuild()}
          disabled={isBuilding}
          title={build === 'error' && errorMsg ? `Build failed: ${errorMsg}` : BUILD_LABELS[build]}
          className={cn('flex h-6 w-6 items-center justify-center rounded transition-colors', tone)}
        >
          {build === 'idle' && <Package size={13} />}
          {isBuilding && <LoaderCircle size={13} className="animate-spin" />}
          {build === 'done' && <Check size={13} />}
          {build === 'error' && <CircleAlert size={13} />}
        </button>
        {build !== 'idle' && <span className={cn('ml-1 text-[11px]', build === 'done' ? 'text-positive' : build === 'error' ? 'text-destructive' : 'text-surface-500')}>
          {BUILD_LABELS[build]}
        </span>}
      </div>

      <div className="flex-1" />

      <div className="flex" style={noDrag}>
        <button type="button" aria-label="Minimize" onClick={windowMinimize} className="flex h-9 w-11 items-center justify-center text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-100">
          <Minus size={15} />
        </button>
        <button type="button" aria-label="Maximize" onClick={windowMaximize} className="flex h-9 w-11 items-center justify-center text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-100">
          <Square size={12} />
        </button>
        <button type="button" aria-label="Close to the tray" onClick={windowClose} className="flex h-9 w-11 items-center justify-center text-surface-400 transition-colors hover:bg-[#c42b1c] hover:text-white">
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
