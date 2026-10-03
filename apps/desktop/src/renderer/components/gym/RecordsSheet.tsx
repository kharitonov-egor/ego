import React from 'react'
import {
  fieldsFor, formatDistance, formatSetDuration, formatWeight,
  type DistanceUnit, type ExerciseRecords, type ExerciseType, type RecordValue, type WeightUnit
} from '@ego/core'
import { formatIso } from '@ego/local/dates'
import { Sheet } from '../ui/dialog'
import { SectionLabel } from './ui'

function Stat({ label, record, format }: {
  label: string
  record: RecordValue | null
  format: (value: number) => string
}): React.ReactElement | null {
  if (!record) return null
  return <div className="flex min-h-14 items-center border-b border-surface-900 py-2">
    <div className="flex flex-1 flex-col">
      <span className="text-[16px]">{label}</span>
      <span className="text-[14px] text-muted-foreground">{formatIso(record.date)}</span>
    </div>
    <span className="tabular text-[18px] font-bold">{format(record.value)}</span>
  </div>
}

export function RecordsSheet({ visible, name, type, records, weightUnit, distanceUnit, onClose }: {
  visible: boolean
  name: string
  type: ExerciseType
  records: ExerciseRecords
  weightUnit: WeightUnit
  distanceUnit: DistanceUnit
  onClose: () => void
}): React.ReactElement | null {
  const fields = fieldsFor(type)
  const weight = (value: number): string => `${formatWeight(value)} ${weightUnit}`
  const empty = !records.heaviestWeight && !records.mostReps && !records.longestDistance && !records.longestTime
  return <Sheet visible={visible} title="Personal records" onClose={onClose} dismissOnBackdrop>
    <p className="-mt-1 mb-3 text-[15px] text-muted-foreground">{name}</p>
    {empty && <p className="text-[16px] leading-6 text-muted-foreground">Log a set and your records show up here.</p>}
    {records.repMaxes.length > 0 && <div className="mb-6">
      <SectionLabel>BEST WEIGHT FOR REPS</SectionLabel>
      <div className="mt-1 flex py-2">
        <span className="w-16 text-[13px] font-bold text-muted-foreground">REPS</span>
        <span className="flex-1 text-[13px] font-bold text-muted-foreground">DATE</span>
        <span className="text-[13px] font-bold text-muted-foreground">WEIGHT</span>
      </div>
      {records.repMaxes.map((record) => <div key={record.reps} className="flex min-h-12 items-center border-b border-surface-900">
        <span className="tabular w-16 text-[17px] font-bold">{record.reps}</span>
        <span className="flex-1 text-[15px] text-muted-foreground">{formatIso(record.date)}</span>
        <span className="tabular text-[17px] font-bold">{weight(record.weight)}</span>
      </div>)}
    </div>}
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
    <p className="mt-4 text-[14px] leading-5 text-muted-foreground">Estimated one-rep max uses the Epley formula. A trophy marks the set that holds each record.</p>
  </Sheet>
}
