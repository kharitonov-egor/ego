import React from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import { CloudAlert, CloudCheck, CloudOff, CloudUpload } from 'lucide-react-native'
import { syncLabel, useLedger } from '../../lib/ledger-context'
import { Text } from '../ui/text'

/**
 * The whole sync story in one header icon. A tap syncs, or opens what is blocking the sync: the
 * conflict review in Activity, or Settings when the device has to sign in again.
 */
export function SyncButton(): React.ReactElement | null {
  const ledger = useLedger()
  const router = useRouter()
  if (!ledger.enabled) return null
  const state = ledger.status?.state
  const conflicts = ledger.conflicts.length
  const attention = conflicts > 0 || state === 'attention'
  const paused = state === 'paused'
  const onPress = (): void => {
    if (attention) router.push({ pathname: '/(money)/transactions', params: { review: 'true' } })
    else if (paused) router.push('/settings')
    else void ledger.sync()
  }
  const icon = ledger.syncing ? <ActivityIndicator size="small" color="#d4d4d4" />
    : attention || paused ? <CloudAlert color="#fbbf24" size={21} />
      : state === 'offline' ? <CloudOff color="#737373" size={21} />
        : (ledger.status?.pendingCount ?? 0) > 0 ? <CloudUpload color="#d4d4d4" size={21} />
          : <CloudCheck color="#d4d4d4" size={21} />
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`Sync status: ${syncLabel(ledger.status)}`}
    accessibilityHint={attention ? 'Opens the changes that need a decision' : paused ? 'Opens Settings to sign in' : 'Syncs with the server'}
    disabled={ledger.syncing}
    onPress={onPress}
    hitSlop={8}
    className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-800"
  >
    {icon}
    {conflicts > 0 && <View className="absolute right-0.5 top-0.5 h-4 min-w-4 items-center justify-center rounded-full bg-attention px-1">
      <Text className="text-[11px] font-bold text-background">{conflicts}</Text>
    </View>}
  </Pressable>
}
