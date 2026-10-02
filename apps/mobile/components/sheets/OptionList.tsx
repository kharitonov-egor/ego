import React, { useState } from 'react'
import { Linking, Pressable, Text, TextInput, View } from 'react-native'
import { Check, ExternalLink, Mail, MessageCircle, Phone, Plus } from 'lucide-react-native'
import { SHEET_OPTION_NAME_LIMIT, type SheetColumn } from '@ego/core'
import { linkUrl, phoneDigits } from '../../lib/sheets/view'
import { inputClass } from '../money/Common'
import { OptionPill } from './ui'

/** Picks one option, or several for tags, and adds a new option from what was typed. */
export function OptionList({ column, selected, onToggle, onCreate }: {
  column: SheetColumn
  selected: readonly string[]
  onToggle: (optionId: string) => void
  onCreate: (name: string) => void
}): React.ReactElement {
  const [query, setQuery] = useState('')
  const wanted = query.trim().toLowerCase()
  const shown = wanted === '' ? column.options : column.options.filter((option) => option.name.toLowerCase().includes(wanted))
  const exact = column.options.some((option) => option.name.trim().toLowerCase() === wanted)
  const create = (): void => {
    const name = query.trim()
    if (name === '' || exact) return
    setQuery('')
    onCreate(name)
  }
  return <View>
    <TextInput
      value={query}
      onChangeText={setQuery}
      onSubmitEditing={create}
      placeholder={column.options.length > 0 ? 'Find or add an option' : 'Add the first option'}
      placeholderTextColor="#737373"
      accessibilityLabel="Find or add an option"
      returnKeyType="done"
      maxLength={SHEET_OPTION_NAME_LIMIT}
      className={inputClass}
    />
    <View className="mt-3">
      {wanted !== '' && !exact && <Pressable
        accessibilityRole="button"
        onPress={create}
        className="min-h-12 flex-row items-center border-b border-surface-900 active:bg-surface-900"
      >
        <Plus color="#fafafa" size={18} />
        <Text className="ml-3 flex-1 text-[16px] text-white">Add <Text className="font-semibold">“{query.trim()}”</Text></Text>
      </Pressable>}
      {shown.map((option) => {
        const on = selected.includes(option.id)
        return <Pressable
          key={option.id}
          accessibilityRole={column.type === 'tags' ? 'checkbox' : 'radio'}
          accessibilityState={{ checked: on }}
          accessibilityLabel={option.name}
          onPress={() => onToggle(option.id)}
          className="min-h-12 flex-row items-center border-b border-surface-900 active:bg-surface-900"
        >
          <View className="flex-1 flex-row"><OptionPill option={option} large /></View>
          {on && <Check color="#fafafa" size={20} strokeWidth={2.5} />}
        </Pressable>
      })}
      {shown.length === 0 && wanted === '' && <Text className="py-3 text-[15px] text-surface-500">No options yet. Type one above.</Text>}
    </View>
  </View>
}

function Action({ Icon, label, onPress }: { Icon: typeof Phone; label: string; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    onPress={onPress}
    className="min-h-11 flex-row items-center rounded-xl border border-surface-700 px-3.5 active:bg-surface-800"
  >
    <Icon color="#e5e5e5" size={16} />
    <Text className="ml-2 text-[15px] font-semibold text-surface-100">{label}</Text>
  </Pressable>
}

/** Call, text, WhatsApp, mail, or open, for the column types that point somewhere. */
export function ContactActions({ type, value }: { type: SheetColumn['type']; value: string }): React.ReactElement | null {
  const text = value.trim()
  if (text === '') return null
  const open = (url: string): void => { void Linking.openURL(url).catch(() => undefined) }
  if (type === 'phone') {
    const digits = phoneDigits(text)
    return <View className="flex-row flex-wrap gap-2">
      <Action Icon={Phone} label="Call" onPress={() => open(`tel:${text.replace(/\s/g, '')}`)} />
      <Action Icon={MessageCircle} label="Text" onPress={() => open(`sms:${text.replace(/\s/g, '')}`)} />
      {digits.length >= 7 && <Action Icon={MessageCircle} label="WhatsApp" onPress={() => open(`https://wa.me/${digits}`)} />}
    </View>
  }
  if (type === 'email') return <View className="flex-row"><Action Icon={Mail} label="Email" onPress={() => open(`mailto:${text}`)} /></View>
  if (type === 'link') return <View className="flex-row"><Action Icon={ExternalLink} label="Open" onPress={() => open(linkUrl(text))} /></View>
  return null
}
