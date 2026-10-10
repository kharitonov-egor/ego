import React from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { RefreshCw, TriangleAlert } from 'lucide-react-native'
import type { TrelloWork } from '../../lib/tasks/trello-work'
import { color } from '../money/tokens'

export function WorkRefresh({ work }: { work: TrelloWork }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel="Sync with Trello"
    disabled={work.syncing}
    onPress={work.refresh}
    hitSlop={6}
    className="h-11 w-9 items-center justify-center"
  >
    {work.syncing ? <ActivityIndicator color={color.textMuted} size="small" /> : <RefreshCw color={color.textMuted} size={17} />}
  </Pressable>
}

export function WorkProblem({ text }: { text: string }): React.ReactElement {
  return <View className="flex-row items-start px-3.5 pb-1.5">
    <TriangleAlert color="#fca5a5" size={12} style={{ marginTop: 2, marginRight: 4 }} />
    <Text className="flex-1 text-[12px] leading-4 text-red-300">{text}</Text>
  </View>
}
