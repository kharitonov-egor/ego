import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native'
import { Server } from 'lucide-react-native'
import { normalizeApiUrl } from '@ego/local/api-client'
import { apiUrlFor, useSettings } from '../lib/settings'
import { beginGoogleSignIn } from '../lib/sign-in'
import { inputClass } from './money/Common'
import { color } from './money/tokens'
import { Button } from './ui/button'
import { Text } from './ui/text'

export interface GoogleSignIn {
  server: string
  setServer: (value: string) => void
  editingServer: boolean
  setEditingServer: (value: boolean) => void
  signingIn: boolean
  error: string | null
  signIn: () => Promise<void>
}

/** Starts Google sign-in against the typed server address, or the one built into the app. */
export function useGoogleSignIn(): GoogleSignIn {
  const { settings, update } = useSettings()
  const [server, setServer] = useState(apiUrlFor(settings))
  const [editingServer, setEditingServer] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setServer(apiUrlFor(settings))
  }, [settings.apiUrl])

  const signIn = async (): Promise<void> => {
    const address = normalizeApiUrl(server)
    if (!/^https:\/\//.test(address)) {
      setError('Enter the Worker address, starting with https://')
      setEditingServer(true)
      return
    }
    setSigningIn(true)
    setError(null)
    if (address !== apiUrlFor(settings)) await update({ apiUrl: address })
    const problem = await beginGoogleSignIn(address)
    setSigningIn(false)
    if (problem) setError(problem)
  }

  return { server, setServer, editingServer, setEditingServer, signingIn, error, signIn }
}

function FieldLabel({ children }: { children: string }): React.ReactElement {
  return <Text className="mb-2 mt-4 text-[15px] font-medium text-surface-200">{children}</Text>
}

/**
 * The one way into Ego. Finance and Gym both read the same signed-in copy, so the start screen
 * asks for this before showing either.
 */
export function SignInPanel(): React.ReactElement {
  const { update } = useSettings()
  const google = useGoogleSignIn()
  const buildApiUrl = apiUrlFor({ apiUrl: '' })
  const [enteringToken, setEnteringToken] = useState(false)
  const [token, setToken] = useState('')
  const [tokenError, setTokenError] = useState<string | null>(null)

  const connectWithToken = async (): Promise<void> => {
    const address = normalizeApiUrl(google.server)
    if (!/^https:\/\//.test(address) || token.trim().length < 32) {
      setTokenError('Enter the Worker address and the full token from ego-device enroll.')
      google.setEditingServer(true)
      return
    }
    setTokenError(null)
    await update({ apiUrl: address, deviceToken: token.trim(), account: null })
    setToken('')
    setEnteringToken(false)
  }

  const problem = google.error ?? tokenError
  return <View>
    <Text className="text-[15px] leading-6 text-muted-foreground">Sign in with the Google account your Ego server allows. The server holds every API key, so there is nothing else to paste here.</Text>
    {buildApiUrl && !google.editingServer
      ? <Pressable accessibilityRole="button" accessibilityHint="Change the server address" onPress={() => google.setEditingServer(true)} className="mt-3 min-h-12 flex-row items-center">
        <Server color={color.textMuted} size={16} />
        <Text numberOfLines={1} className="ml-2 flex-1 font-mono text-[14px] text-muted-foreground">{google.server}</Text>
        <Text className="text-[15px] font-semibold underline">Change</Text>
      </Pressable>
      : <View>
        <FieldLabel>Server address</FieldLabel>
        <TextInput value={google.server} onChangeText={google.setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://ego-money.example.workers.dev" placeholderTextColor={color.textFaint} className={inputClass} />
      </View>}
    <Button size="lg" disabled={google.signingIn} onPress={() => void google.signIn()} className="mt-4">
      {google.signingIn && <ActivityIndicator color={color.screen} size="small" />}
      <Text>{google.signingIn ? 'Opening Google...' : 'Sign in with Google'}</Text>
    </Button>
    {enteringToken
      ? <View>
        <FieldLabel>Device token</FieldLabel>
        <TextInput value={token} onChangeText={setToken} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="From ego-device enroll" placeholderTextColor={color.textFaint} className={inputClass} />
        <Button variant="outline" size="lg" onPress={() => void connectWithToken()} className="mt-3"><Text>Connect with this token</Text></Button>
      </View>
      : <Button variant="ghost" onPress={() => setEnteringToken(true)} className="mt-2">
        <Text className="text-[15px] font-medium text-muted-foreground">Use a device token instead</Text>
      </Button>}
    {problem && <Text className="mt-3 text-[15px] leading-5 text-destructive">{problem}</Text>}
  </View>
}
