import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { cn } from './utils'
import { SecureStore } from './preferences'

const STORE_KEY = 'ego.blur'

interface BlurValue {
  blurred: boolean
  setBlurred: (on: boolean) => void
}

const BlurContext = createContext<BlurValue | null>(null)

/**
 * Demo mode: personal numbers and entries blur until it is switched off in Settings.
 * Ctrl+Shift+B flips it from anywhere in the window, for a screen share that starts suddenly.
 */
export function BlurProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [blurred, setBlurredState] = useState(false)
  useEffect(() => {
    let active = true
    void SecureStore.getItemAsync(STORE_KEY)
      .then((raw) => { if (active && raw === '1') setBlurredState(true) })
      .catch(() => undefined)
    return () => { active = false }
  }, [])
  const setBlurred = useCallback((on: boolean): void => {
    setBlurredState(on)
    void SecureStore.setItemAsync(STORE_KEY, on ? '1' : '0').catch(() => undefined)
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || !event.shiftKey || event.altKey || event.key.toLowerCase() !== 'b') return
      event.preventDefault()
      setBlurred(!blurred)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [blurred, setBlurred])
  const value = useMemo(() => ({ blurred, setBlurred }), [blurred, setBlurred])
  return <BlurContext.Provider value={value}>{children}</BlurContext.Provider>
}

export function useBlur(): BlurValue {
  const context = useContext(BlurContext)
  if (!context) throw new Error('useBlur must be used inside BlurProvider')
  return context
}

/**
 * Wraps one element that holds personal data. While Blur is on, the element keeps its place and
 * its text turns into a soft smudge that cannot be selected or copied.
 */
export function Blurred({ active = true, children }: {
  active?: boolean
  children: React.ReactElement<{ className?: string }>
}): React.ReactElement {
  const { blurred } = useBlur()
  if (!blurred || !active) return children
  return React.cloneElement(children, { className: cn(children.props.className, 'ego-blurred') })
}

/** An amount or name in the middle of a sentence. It inherits the sentence's type and blurs alone. */
export function BlurSpan({ children }: { children: React.ReactNode }): React.ReactElement {
  const { blurred } = useBlur()
  return <span className={blurred ? 'ego-blurred' : undefined}>{children}</span>
}

/** Stands in for an icon that would give the data away, such as a mood's face or a habit's emoji. */
export function BlurBlob({ size, tint = '#a3a3a3' }: { size: number; tint?: string }): React.ReactElement {
  return <span
    aria-hidden
    className="inline-block shrink-0 rounded-full"
    style={{
      width: size,
      height: size,
      background: `radial-gradient(circle, ${tint}99 0%, ${tint}59 50%, ${tint}00 100%)`
    }}
  />
}
