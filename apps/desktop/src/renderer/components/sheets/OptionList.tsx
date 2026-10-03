import React, { useState } from 'react'
import { Check, ExternalLink, Mail, MessageCircle, Phone, Plus } from 'lucide-react'
import { SHEET_OPTION_NAME_LIMIT, type SheetColumn } from '@ego/core'
import { linkUrl, phoneDigits } from '@ego/local/sheets/view'
import { inputClass } from '../ui/input'
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
  return <div>
    <input
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || wanted === '') return
        event.preventDefault()
        const only = shown.length === 1 ? shown[0] : column.options.find((option) => option.name.trim().toLowerCase() === wanted)
        if (only) {
          setQuery('')
          onToggle(only.id)
        } else create()
      }}
      placeholder={column.options.length > 0 ? 'Find or add an option' : 'Add the first option'}
      aria-label="Find or add an option"
      maxLength={SHEET_OPTION_NAME_LIMIT}
      className={inputClass}
    />
    <div className="mt-3">
      {wanted !== '' && !exact && <button
        type="button"
        onClick={create}
        className="flex min-h-12 w-full items-center border-b border-surface-900 text-left hover:bg-surface-900 active:bg-surface-900"
      >
        <Plus color="#fafafa" size={18} />
        <span className="ml-3 flex-1 text-[16px] text-white">Add <span className="font-semibold">“{query.trim()}”</span></span>
      </button>}
      {shown.map((option) => {
        const on = selected.includes(option.id)
        return <button
          key={option.id}
          type="button"
          role={column.type === 'tags' ? 'checkbox' : 'radio'}
          aria-checked={on}
          aria-label={option.name}
          onClick={() => onToggle(option.id)}
          className="flex min-h-12 w-full items-center border-b border-surface-900 text-left hover:bg-surface-900 active:bg-surface-900"
        >
          <span className="flex min-w-0 flex-1"><OptionPill option={option} large /></span>
          {on && <Check color="#fafafa" size={20} strokeWidth={2.5} />}
        </button>
      })}
      {shown.length === 0 && wanted === '' && <p className="py-3 text-[15px] text-surface-500">No options yet. Type one above.</p>}
    </div>
  </div>
}

function Action({ Icon, label, onPress }: { Icon: typeof Phone; label: string; onPress: () => void }): React.ReactElement {
  return <button
    type="button"
    onClick={onPress}
    className="flex min-h-11 items-center rounded-xl border border-surface-700 px-3.5 hover:bg-surface-800 active:bg-surface-800"
  >
    <Icon color="#e5e5e5" size={16} />
    <span className="ml-2 text-[15px] font-semibold text-surface-100">{label}</span>
  </button>
}

/** Call, text, WhatsApp, mail, or open, for the column types that point somewhere. */
export function ContactActions({ type, value }: { type: SheetColumn['type']; value: string }): React.ReactElement | null {
  const text = value.trim()
  if (text === '') return null
  const open = (url: string): void => { void window.api.openExternalUrl(url).catch(() => undefined) }
  if (type === 'phone') {
    const digits = phoneDigits(text)
    return <div className="flex flex-wrap gap-2">
      <Action Icon={Phone} label="Call" onPress={() => open(`tel:${text.replace(/\s/g, '')}`)} />
      <Action Icon={MessageCircle} label="Text" onPress={() => open(`sms:${text.replace(/\s/g, '')}`)} />
      {digits.length >= 7 && <Action Icon={MessageCircle} label="WhatsApp" onPress={() => open(`https://wa.me/${digits}`)} />}
    </div>
  }
  if (type === 'email') return <div className="flex"><Action Icon={Mail} label="Email" onPress={() => open(`mailto:${text}`)} /></div>
  if (type === 'link') return <div className="flex"><Action Icon={ExternalLink} label="Open" onPress={() => open(linkUrl(text))} /></div>
  return null
}
