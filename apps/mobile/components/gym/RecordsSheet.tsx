import React from 'react'
import { View } from 'react-native'
import {
  fieldsFor, formatDistance, formatSetDuration, formatWeight,
  type DistanceUnit, type ExerciseRecords, type ExerciseType, type RecordValue, type WeightUnit
} from '@ego/core'
import { formatIso } from '../../lib/dates'
import { BottomSheet } from '../money/Common'
import { tabular } from '../money/tokens'
import { Text } from '../ui/text'
import { SectionLabel } from './ui'

function Stat({ label, record, format }: {
  label: string
  record: RecordValue | null
  format: (value: number) => string
}): React.ReactElement | null {
  if (!record) return null
  return <View className="min-h-14 flex-row items-center border-b border-surface-900 py-2">
    <View className="flex-1">
      <Text className="text-[16px]">{label}</Text>
      <Text className="text-[14px] text-muted-foreground">{formatIso(record.date)}</Text>
    </View>
    <Text className="text-[18px] font-bold" style={tabular}>{format(record.value)}</Text>
  </View>
}

export function RecordsSheet({ visible, name, type, records, weightUnit, distanceUnit, onClose }: {
  visible: boolean
  name: string
  type: ExerciseType
  records: ExerciseRecords
  weightUnit: WeightUnit
  distanceUnit: DistanceUnit
  onClose: () => void
}): React.ReactElement {
  const fields = fieldsFor(type)
  const weight = (value: number): string => `${formatWeight(value)} ${weightUnit}`
  const empty = !records.heaviestWeight && !records.mostReps && !records.longestDistance && !records.longestTime
  return <BottomSheet visible={visible} title="Personal records" onClose={onClose} dismissOnBackdrop>
    <Text className="-mt-1 mb-3 text-[15px] text-muted-foreground">{name}</Text>
    {empty && <Text className="text-[16px] leading-6 text-muted-foreground">Log a set and your records show up here.</Text>}
    {records.repMaxes.length > 0 && <View className="mb-6">
      <SectionLabel>BEST WEIGHT FOR REPS</SectionLabel>
      <View className="mt-1 flex-row py-2">
        <Text className="w-16 text-[13px] font-bold text-muted-foreground">REPS</Text>
        <Text className="flex-1 text-[13px] font-bold text-muted-foreground">DATE</Text>
        <Text className="text-[13px] font-bold text-muted-foreground">WEIGHT</Text>
      </View>
      {records.repMaxes.map((record) => <View key={record.reps} className="min-h-12 flex-row items-center border-b border-surface-900">
        <Text className="w-16 text-[17px] font-bold" style={tabular}>{record.reps}</Text>
        <Text className="flex-1 text-[15px] text-muted-foreground">{formatIso(record.date)}</Text>
        <Text className="text-[17px] font-bold" style={tabular}>{weight(record.weight)}</Text>
      </View>)}
    </View>}
    {!empty && <SectionLabel>ALL TIME</SectionLabel>}
    {fields.includes('weight') && fields.includes('reps') && <Stat label="Estimated one-rep max" record={records.estimatedOneRepMax} format={weight} />}
    {fields.includes('weight') && <Stat label="Heaviest weight" record={records.heaviestWeight} format={weight} />}
    {fields.includes('reps') && <Stat label="Most reps in a set" record={records.mostReps} format={(value) => `${value} reps`} />}
    {fields.includes('weight') && fields.includes('reps') && <>
      <Stat label="Best set volume" record={records.bestSetVolume} format={(value) => `${Math.round(value).toLocaleString('en-US')} ${weightUnit}`} />
      <Stat label="Best workout volume" record={records.bestWorkoutVolume} format={(value) => `${Math.round(value).toLocaleString('en-US')} ${weightUnit}`} />
    </>}
    {fields.includes('distance') && <Stat label="Longest distance" record={records.longestDistance} format={(value) => `${formatDistance(value)} ${distanceUnit}`} />}
    {fields.includes('time') && <Stat label="Longest time" record={records.longestTime} format={formatSetDuration} />}
    <Text className="mt-4 text-[14px] leading-5 text-muted-foreground">Estimated one-rep max uses the Epley formula. A trophy marks the set that holds each record.</Text>
  </BottomSheet>
}
