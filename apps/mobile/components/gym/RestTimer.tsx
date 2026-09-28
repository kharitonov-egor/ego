import React from 'react'
import { Pressable, Switch, View } from 'react-native'
import { AlarmClock } from 'lucide-react-native'
import { formatSetDuration } from '@ego/core'
import { REST_PRESETS, useRestClock, useRestTimer } from '../../lib/rest-timer'
import { BottomSheet } from '../money/Common'
import { color, tabular } from '../money/tokens'
import { Button } from '../ui/button'
import { Text } from '../ui/text'
import { HeaderIcon } from './ui'

export function RestTimerButton({ onPress }: { onPress: () => void }): React.ReactElement {
  const { running } = useRestTimer()
  const { remaining, finished } = useRestClock()
  const tint = finished ? color.positive : running ? color.text : color.textSecondary
  return <HeaderIcon label={running ? `Rest timer, ${formatSetDuration(remaining)} left` : 'Rest timer'} onPress={onPress}>
    <AlarmClock color={tint} size={21} />
    {running && <Text className="ml-1 text-[15px] font-semibold" style={tabular}>{formatSetDuration(remaining)}</Text>}
  </HeaderIcon>
}

function Countdown(): React.ReactElement {
  const { running, preference } = useRestTimer()
  const { remaining, finished } = useRestClock()
  return <View className="items-center py-4">
    <Text className="text-[64px] font-bold tracking-tight" style={tabular}>
      {formatSetDuration(running ? remaining : preference.seconds)}
    </Text>
    <Text className={`mt-1 text-[15px] ${finished ? 'text-positive' : 'text-muted-foreground'}`}>
      {finished ? 'Rest is over' : running ? 'Resting' : 'Ready'}
    </Text>
  </View>
}

export function RestTimerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }): React.ReactElement {
  const timer = useRestTimer()
  const { preference } = timer
  return <BottomSheet visible={visible} title="Rest timer" onClose={onClose} dismissOnBackdrop>
    <Countdown />
    {timer.running && <View className="flex-row gap-3">
      <Button variant="outline" size="lg" onPress={() => timer.adjust(-15)} className="flex-1"><Text>-15s</Text></Button>
      <Button variant="outline" size="lg" onPress={() => timer.adjust(15)} className="flex-1"><Text>+15s</Text></Button>
    </View>}
    <Button size="lg" onPress={() => timer.running ? timer.stop() : timer.start()} className="mt-3">
      <Text>{timer.running ? 'Stop' : `Start ${formatSetDuration(preference.seconds)}`}</Text>
    </Button>
    <Text className="mb-2 mt-6 text-[15px] font-medium text-surface-200">Length</Text>
    <View className="flex-row flex-wrap gap-2">
      {REST_PRESETS.map((seconds) => {
        const selected = seconds === preference.seconds
        return <Pressable
          key={seconds}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          onPress={() => timer.setSeconds(seconds)}
          className={`min-h-12 min-w-[72px] items-center justify-center rounded-xl border px-4 ${selected ? 'border-primary bg-primary' : 'border-input bg-surface-900 active:bg-surface-800'}`}
        >
          <Text className={`text-[16px] ${selected ? 'font-semibold text-primary-foreground' : 'text-surface-200'}`} style={tabular}>{formatSetDuration(seconds)}</Text>
        </Pressable>
      })}
    </View>
    <View className="mt-6 min-h-14 flex-row items-center">
      <View className="flex-1 pr-3">
        <Text className="text-[16px]">Start after each set</Text>
        <Text className="text-[14px] leading-5 text-muted-foreground">Saving a new set starts the countdown.</Text>
      </View>
      <Switch
        accessibilityLabel="Start the rest timer after each set"
        value={preference.autoStart}
        onValueChange={timer.setAutoStart}
        trackColor={{ false: '#404040', true: '#fafafa' }}
        thumbColor={preference.autoStart ? '#0a0a0a' : '#d4d4d4'}
        ios_backgroundColor="#404040"
      />
    </View>
  </BottomSheet>
}
