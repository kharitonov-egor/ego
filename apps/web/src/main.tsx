import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from '@ego/ui/App'
import '@ego/ui/styles/globals.css'
import { announceSignIn, createWebApi, requestNavigation, stopLiveSessions } from './api'
import { docketOpenTarget, refreshDocketCookie, rememberDocketReturn, takeDocketReturn } from './docket'
import { currentSession, ledgerApi, ledgerDatabase, startLedger, stopLedger } from './ledger'
import { answerMedia } from './media'
import { isMediaQuestion, type MediaAnswer } from './media-protocol'
import { isOpenRequest } from './notification-protocol'
import { QuickAdd } from './QuickAdd'
import { finishGoogleSignIn, isSignInReturn } from './sign-in'
import { Elsewhere } from './Elsewhere'

/** Only one tab runs Ego, since only one can hold the browser's copy of the database open. */
const TAB_LOCK = 'ego-tab'
const tabs = new BroadcastChannel('ego-tab')
/** Whether this tab holds the lock and shows Ego, rather than the page that says Ego is open elsewhere. */
let running = false

type TabMessage = { type: 'take-over' } | { type: 'navigate'; route: string }

function isTabMessage(value: unknown): value is TabMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  return message.type === 'take-over' || (message.type === 'navigate' && typeof message.route === 'string')
}

window.api = createWebApi()

// A file dropped where no screen takes it would replace the whole page with that file. Screens that
// accept files handle their drops before the event reaches the window.
window.addEventListener('dragover', (event) => event.preventDefault())
window.addEventListener('drop', (event) => event.preventDefault())

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)

function answerServiceWorker(): void {
  navigator.serviceWorker?.addEventListener('message', (event: MessageEvent<unknown>) => {
    const port = event.ports[0]
    if (port && isOpenRequest(event.data)) {
      port.postMessage(running)
      if (running) requestNavigation(event.data.route)
      return
    }
    if (!port || !isMediaQuestion(event.data)) return
    const question = event.data
    void (async (): Promise<MediaAnswer> => {
      const session = currentSession()
      if (!session) return { kind: 'missing' }
      const db = (await ledgerDatabase())?.local ?? null
      return answerMedia(question, db, ledgerApi(), session.remember)
    })().catch((): MediaAnswer => ({ kind: 'missing' })).then((answer) => port.postMessage(answer))
  })
}

/**
 * Media URLs only work once the service worker controls this page, so the first visit waits a
 * moment for it. A browser without service workers still runs everything else.
 */
async function startServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const script = import.meta.env.DEV ? '/src/sw.ts' : '/sw.js'
  try {
    await navigator.serviceWorker.register(script, { scope: '/', ...(import.meta.env.DEV ? { type: 'module' } : {}) })
  } catch {
    return
  }
  if (navigator.serviceWorker.controller) return
  await new Promise<void>((resolve) => {
    const done = (): void => resolve()
    navigator.serviceWorker.addEventListener('controllerchange', done, { once: true })
    setTimeout(done, 3000)
  })
}

/** Health and Calendar consent opens in its own tab and comes back to a route the open tab should show. */
function connectReturnRoute(): string | null {
  const params = new URLSearchParams(location.search)
  if (!['/health', '/calendar'].includes(location.pathname)) return null
  return params.has('connected') || params.has('error') ? `${location.pathname}${location.search}` : null
}

function renderApp(): void {
  root.render(<React.StrictMode>
    <BrowserRouter>
      <App overlay={<QuickAdd />} />
    </BrowserRouter>
  </React.StrictMode>)
}

function takeOver(): void {
  tabs.postMessage({ type: 'take-over' } satisfies TabMessage)
  void navigator.locks.request(TAB_LOCK, () => run())
}

function renderElsewhere(reason: 'open' | 'moved' | 'connected'): void {
  root.render(<Elsewhere reason={reason} onUseHere={takeOver} />)
}

/** Runs Ego in this tab until another tab takes over, then lets go of the database and the lock. */
async function run(): Promise<void> {
  running = true
  startLedger()
  renderApp()
  await new Promise<void>((released) => {
    tabs.onmessage = (event: MessageEvent<unknown>) => {
      if (!isTabMessage(event.data)) return
      if (event.data.type === 'navigate') {
        requestNavigation(event.data.route)
        window.focus()
        return
      }
      tabs.onmessage = null
      running = false
      stopLiveSessions()
      void stopLedger().finally(() => {
        renderElsewhere('moved')
        released()
      })
    }
  })
}

/**
 * A private docket's "Open in Ego" link lands here. With a sign-in, the cookie is all it needs, so
 * this tab goes straight back without opening Ego. Without one, the docket waits for the sign-in.
 */
async function openDocket(): Promise<boolean> {
  const target = docketOpenTarget(location)
  if (!target) return false
  if (await refreshDocketCookie(currentSession())) {
    location.replace(target)
    return true
  }
  rememberDocketReturn(target)
  history.replaceState(null, '', '/')
  return false
}

async function boot(): Promise<void> {
  if (await openDocket()) return
  await startServiceWorker()
  answerServiceWorker()
  if (isSignInReturn()) {
    const outcome = await finishGoogleSignIn(new URLSearchParams(location.search))
    history.replaceState(null, '', '/')
    const docket = takeDocketReturn()
    if (outcome.ok && docket && await refreshDocketCookie(currentSession())) {
      location.replace(docket)
      return
    }
    announceSignIn(outcome)
  } else {
    void refreshDocketCookie(currentSession())
  }
  if (!('locks' in navigator)) {
    await run()
    return
  }
  await navigator.locks.request(TAB_LOCK, { ifAvailable: true }, async (lock) => {
    if (lock) return run()
    const route = connectReturnRoute()
    if (route) {
      tabs.postMessage({ type: 'navigate', route } satisfies TabMessage)
      window.close()
      renderElsewhere('connected')
      return
    }
    renderElsewhere('open')
  })
}

void boot()
