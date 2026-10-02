import React, { useEffect, useState } from 'react'
import { Server } from 'lucide-react'
import { normalizeApiUrl } from '@ego/local/api-client'
import { useLedger } from '../lib/ledger'
import { Button } from './ui/button'
import { inputClass } from './ui/input'
import { Spinner } from './ui/spinner'

export interface GoogleSignIn {
  server: string
  setServer: (value: string) => void
  editingServer: boolean
  setEditingServer: (value: boolean) => void
  signingIn: boolean
  /** The browser is open on Google's page and Ego waits for it to come back. */
  waiting: boolean
  error: string | null
  signIn: () => Promise<void>
}

/** Starts Google sign-in against the typed server address, or the one built into the app. */
export function useGoogleSignIn(): GoogleSignIn {
  const { apiUrl } = useLedger()
  const [server, setServer] = useState(apiUrl)
  const [editingServer, setEditingServer] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setServer(apiUrl)
  }, [apiUrl])

  useEffect(() => window.api.onSignInFinished((outcome) => {
    setWaiting(false)
    setError(outcome.ok ? null : outcome.message)
  }), [])

  const signIn = async (): Promise<void> => {
    const address = normalizeApiUrl(server)
    if (!/^https:\/\//.test(address)) {
      setError('Enter the Worker address, starting with https://')
      setEditingServer(true)
      return
    }
    setSigningIn(true)
    setError(null)
    const outcome = await window.api.signInWithGoogle(address)
    setSigningIn(false)
    if (outcome.ok) setWaiting(true)
    else setError(outcome.message)
  }

  return { server, setServer, editingServer, setEditingServer, signingIn, waiting, error, signIn }
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: string }): React.ReactElement {
  return <label htmlFor={htmlFor} className="mb-2 mt-4 block text-[15px] font-medium text-surface-200">{children}</label>
}

/**
 * The one way into Ego. Every app reads the same signed-in copy, so Home asks for this before
 * showing any of them.
 */
export function SignInPanel(): React.ReactElement {
  const google = useGoogleSignIn()
  const [enteringToken, setEnteringToken] = useState(false)
  const [token, setToken] = useState('')
  const [tokenError, setTokenError] = useState<string | null>(null)

  const connectWithToken = async (): Promise<void> => {
    const outcome = await window.api.signInWithToken(google.server, token)
    if (!outcome.ok) {
      setTokenError(outcome.message)
      google.setEditingServer(true)
      return
    }
    setTokenError(null)
    setToken('')
    setEnteringToken(false)
  }

  const problem = google.error ?? tokenError
  return <div>
    <p className="text-[15px] leading-6 text-muted-foreground">Sign in with the Google account your Ego server allows. The server holds every API key, so there is nothing else to paste here.</p>
    {google.server && !google.editingServer
      ? <button type="button" onClick={() => google.setEditingServer(true)} className="mt-3 flex min-h-11 w-full items-center text-left">
        <Server color="#a3a3a3" size={16} />
        <span className="ml-2 min-w-0 flex-1 truncate font-mono text-[14px] text-muted-foreground">{google.server}</span>
        <span className="text-[15px] font-semibold underline">Change</span>
      </button>
      : <div>
        <FieldLabel htmlFor="sign-in-server">Server address</FieldLabel>
        <input id="sign-in-server" value={google.server} onChange={(event) => google.setServer(event.target.value)} spellCheck={false} placeholder="https://ego-money.example.workers.dev" className={inputClass} />
      </div>}
    <Button size="lg" disabled={google.signingIn} onClick={() => void google.signIn()} className="mt-4 w-full">
      {google.signingIn && <Spinner size={16} color="#0a0a0a" />}
      {google.signingIn ? 'Opening Google...' : 'Sign in with Google'}
    </Button>
    {google.waiting && <p className="mt-3 text-[15px] leading-5 text-muted-foreground">Finish in the browser. Ego comes back to the front when Google is done.</p>}
    {enteringToken
      ? <div>
        <FieldLabel htmlFor="sign-in-token">Device token</FieldLabel>
        <input id="sign-in-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="From ego-device enroll" className={inputClass} />
        <Button variant="outline" size="lg" onClick={() => void connectWithToken()} className="mt-3 w-full">Connect with this token</Button>
      </div>
      : <Button variant="ghost" onClick={() => setEnteringToken(true)} className="mt-2 w-full font-medium text-muted-foreground">Use a device token instead</Button>}
    {problem && <p role="alert" className="mt-3 text-[15px] leading-5 text-destructive">{problem}</p>}
  </div>
}
