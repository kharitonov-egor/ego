import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { Moon } from 'lucide-react-native'
import { formatSleepMinutes } from '@ego/core'
import { HEAT } from '../habits/MonthCalendar'
import { Ring } from '../habits/Ring'
import { useBlur } from '../../lib/blur'
import type { Glance } from '../../lib/launcher/use-glance'
import { cn } from '../../lib/utils'
import {
  APPS, AskBar, Private, SettingsButton, count, daysBetween, longDate, monthName, statusOf, usd, useOpen, type AppKey
} from './shared'

const WEEK_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const TABULAR = { fontVariant: ['tabular-nums' as const] }

function Tile({ app, className, children, right }: {
  app: AppKey
  className?: string
  children: React.ReactNode
  right?: React.ReactNode
}): React.ReactElement {
  const open = useOpen()
  const { label, Icon, href } = APPS[app]
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={() => open(href)}
    className={cn('rounded-[26px] border border-[#1c1c1c] bg-[#0f0f0f] p-4 active:bg-[#181818]', className)}
  >
    <View className="flex-row items-center">
      <Icon color="#8a8a8a" size={15} strokeWidth={2.25} />
      <Text className="ml-1.5 flex-1 text-[13px] font-semibold text-[#8a8a8a]">{label}</Text>
      {right}
    </View>
    {children}
  </Pressable>
}

function Big({ children, personal = true, size = 34 }: { children: React.ReactNode; personal?: boolean; size?: number }): React.ReactElement {
  return <Private
    personal={personal}
    numberOfLines={1}
    adjustsFontSizeToFit
    className="font-bold tracking-tighter text-white"
    style={[{ fontSize: size, lineHeight: size * 1.15 }, TABULAR]}
  >{children}</Private>
}

function Small({ children, className }: { children: React.ReactNode; className?: string }): React.ReactElement {
  return <Text numberOfLines={1} className={cn('text-[13px] text-surface-500', className)}>{children}</Text>
}

function SpendBars({ days }: { days: readonly number[] }): React.ReactElement {
  const { blurred } = useBlur()
  const peak = Math.max(1, ...days)
  return <View className="h-12 flex-row items-end gap-[5px]">
    {days.map((cents, index) => <View
      key={index}
      className="flex-1 rounded-[3px]"
      style={{
        height: blurred ? 6 : Math.max(3, Math.round((cents / peak) * 48)),
        backgroundColor: index === days.length - 1 ? '#fafafa' : '#333333'
      }}
    />)}
  </View>
}

function FinanceTile({ glance }: { glance: Glance }): React.ReactElement {
  const money = glance.local?.money
  return <Tile app="finance" right={<Small>{monthName(glance.now, 'long')}</Small>}>
    <View className="mt-3">
      <Big size={40}>{money ? usd(money.monthCents) : '–'}</Big>
      <Private className="mt-0.5 text-[13px] text-surface-500">{money ? `${usd(money.todayCents)} today` : ' '}</Private>
    </View>
    <View className="mt-4">
      <SpendBars days={money?.days ?? []} />
    </View>
  </Tile>
}

function HabitsTile({ glance }: { glance: Glance }): React.ReactElement {
  const habits = glance.local?.habits
  const share = habits && habits.total > 0 ? habits.done / habits.total : 0
  return <Tile app="habits" className="flex-1">
    <View className="mt-4 h-[84px] w-[84px] items-center justify-center self-center">
      <Ring size={84} stroke={6} share={share} track="#222222" fill="#fafafa" />
      <Big size={22}>{habits ? `${habits.done}/${habits.total}` : '–'}</Big>
    </View>
    <View className="mt-4 flex-row justify-between">
      {(habits?.week ?? Array.from({ length: 7 }, () => 0 as const)).map((level, index) => <View
        key={index}
        className="h-3.5 w-3.5 rounded-[4px]"
        style={{ backgroundColor: HEAT[level] }}
      />)}
    </View>
    {habits && habits.streak.current > 0 && <Small className="mt-2 text-center">
      {habits.streak.current}-{habits.streak.unit} streak
    </Small>}
  </Tile>
}

function TasksTile({ glance }: { glance: Glance }): React.ReactElement {
  const tasks = glance.tasks
  const due = tasks ? tasks.today + tasks.overdue : null
  return <Tile app="tasks" className="flex-1">
    <View className="mt-3">
      <Big size={48}>{due === null ? '–' : String(due)}</Big>
      <Small>due today</Small>
    </View>
    {tasks && tasks.overdue > 0 && <View className="mt-2 flex-row items-center">
      <View className="h-1.5 w-1.5 rounded-full bg-white" />
      <Text className="ml-1.5 text-[13px] font-semibold text-white">{count(tasks.overdue)} overdue</Text>
    </View>}
    <View className="flex-1" />
    {tasks?.next && <Private numberOfLines={2} className="mt-3 text-[14px] leading-5 text-[#bdbdbd]">{tasks.next}</Private>}
  </Tile>
}

function GymTile({ glance }: { glance: Glance }): React.ReactElement {
  const gym = glance.local?.gym
  const today = glance.local?.today
  const since = gym?.lastDate && today ? daysBetween(gym.lastDate, today) : null
  return <Tile app="gym" className="flex-1">
    <View className="mt-3">
      {gym && gym.setsToday > 0
        ? <><Big>{count(gym.setsToday)}</Big><Small>sets today</Small></>
        : since !== null
          ? <><Big>{since === 1 ? '1 day' : `${since} days`}</Big><Small>since you trained</Small></>
          : <><Big personal={false}>–</Big><Small>no workouts yet</Small></>}
    </View>
    <View className="mt-3 flex-row justify-between">
      {WEEK_LETTERS.map((letter, index) => {
        const trained = gym?.week[index] ?? false
        return <View key={index} className="items-center">
          <View className={cn('h-2 w-2 rounded-full', trained ? 'bg-white' : 'bg-[#2a2a2a]')} />
          <Text className="mt-1 text-[10px] font-semibold text-[#5c5c5c]">{letter}</Text>
        </View>
      })}
    </View>
  </Tile>
}

function HealthTile({ glance }: { glance: Glance }): React.ReactElement {
  const health = glance.local?.health
  return <Tile app="health" className="flex-1">
    {health && !health.connected
      ? <View className="mt-3"><Big personal={false} size={22}>Connect</Big><Small>Google Health</Small></View>
      : <>
        <View className="mt-3">
          <Big>{health?.steps != null ? count(health.steps) : '–'}</Big>
          <Small>steps today</Small>
        </View>
        <View className="mt-3 flex-row items-center">
          <Moon color="#8a8a8a" size={13} />
          <Private className="ml-1.5 text-[13px] font-semibold text-[#bdbdbd]">
            {health?.sleepMinutes != null ? formatSleepMinutes(health.sleepMinutes) : 'No sleep logged'}
          </Private>
        </View>
      </>}
  </Tile>
}

function StudyTile({ glance }: { glance: Glance }): React.ReactElement {
  const study = glance.local?.study
  const right = study && (study.overdue > 0 || study.week > 0)
    ? <Text className="text-[13px] font-semibold text-white">
      {study.overdue > 0 ? `${count(study.overdue)} overdue` : `${count(study.week)} this week`}
    </Text>
    : null
  return <Tile app="study" right={right}>
    {study?.next
      ? <View className="mt-3">
        <Private numberOfLines={2} className="text-[18px] font-semibold leading-6 text-white">{study.next.title}</Private>
        <Small className="mt-1">{study.next.due}</Small>
      </View>
      : <Small className="mt-3">Nothing coming up</Small>}
  </Tile>
}

function SmallTile({ app, glance }: { app: AppKey; glance: Glance }): React.ReactElement {
  const open = useOpen()
  const { label, Icon, href } = APPS[app]
  const status = statusOf(app, glance)
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={() => open(href)}
    className="flex-1 flex-row items-center rounded-[22px] border border-[#1c1c1c] bg-[#0f0f0f] p-3 active:bg-[#181818]"
  >
    <View className="h-10 w-10 items-center justify-center rounded-full bg-[#1f1f1f]">
      <Icon color="#fafafa" size={18} />
    </View>
    <View className="ml-3 flex-1">
      <Text className="text-[15px] font-semibold text-white">{label}</Text>
      <Text numberOfLines={1} className="text-[12px] text-surface-500">{status?.text ?? ' '}</Text>
    </View>
  </Pressable>
}

/** Widgets of different sizes, each showing the one number that app is about. */
export function BentoLauncher({ glance }: { glance: Glance }): React.ReactElement {
  return <View className="gap-3">
    <View className="mb-2 flex-row items-start justify-between">
      <View className="flex-1 pt-1">
        <Text accessibilityRole="header" className="text-[34px] font-bold tracking-tight text-white">Today</Text>
        <Text className="text-[15px] text-surface-500">{longDate(glance.now)}</Text>
      </View>
      <SettingsButton className="-mr-2" />
    </View>
    <AskBar className="mb-1" />
    <FinanceTile glance={glance} />
    <View className="flex-row gap-3">
      <HabitsTile glance={glance} />
      <TasksTile glance={glance} />
    </View>
    <View className="flex-row gap-3">
      <GymTile glance={glance} />
      <HealthTile glance={glance} />
    </View>
    <StudyTile glance={glance} />
    <View className="flex-row gap-3">
      <SmallTile app="mood" glance={glance} />
      <SmallTile app="diary" glance={glance} />
    </View>
  </View>
}
