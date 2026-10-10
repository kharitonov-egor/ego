import React, { useEffect, useState } from 'react'
import { ListPlus } from 'lucide-react'
import { inboxList } from '@ego/local/tasks/board'
import HotkeyInput from '../HotkeyInput'
import { FieldLabel, Section, SectionNote } from '../Section'
import { Badge } from '../ui/badge'
import { isWeb } from '../../lib/platform'
import { useTasks } from '../../lib/tasks/context'

/** Alt+N, or the desktop's own hotkey anywhere in Windows, adds a card to the bottom of the Inbox. */
export function QuickAddSettings(): React.ReactElement {
  const web = isWeb()
  const tasks = useTasks()
  const [quickAddHotkey, setQuickAddHotkey] = useState('')
  const inbox = tasks.data ? inboxList(tasks.data) : null
  const board = inbox ? tasks.data?.boards.find((item) => item.id === inbox.boardId) : undefined
  const ready = inbox !== null && (web || Boolean(quickAddHotkey))

  useEffect(() => {
    if (!web) void window.api.getQuickAddHotkey().then(setQuickAddHotkey)
  }, [web])

  const changeHotkey = async (hotkey: string): Promise<void> => {
    setQuickAddHotkey(hotkey)
    await window.api.setQuickAddHotkey(hotkey)
  }

  return <Section Icon={ListPlus} title="Quick add" right={<Badge variant={ready ? 'positive' : 'secondary'}>{ready ? 'Ready' : 'Needs setup'}</Badge>}>
    <SectionNote>
      {web ? 'Press Alt+N in an Ego tab' : 'Press the hotkey anywhere in Windows'} to type a title and a description and paste
      screenshots. The card lands at the bottom of {inbox ? `${board?.name ?? 'your board'}'s ${inbox.name}` : 'the Inbox'}.
    </SectionNote>
    {tasks.data && !inbox && <p className="mt-2 text-[14px] leading-5 text-attention">
      No board has an Inbox yet. In Tasks, open a list's menu and choose Make this the Inbox.
    </p>}
    {!web && <>
      <FieldLabel>Global hotkey</FieldLabel>
      <HotkeyInput value={quickAddHotkey} onChange={(hotkey) => void changeHotkey(hotkey)} />
    </>}
  </Section>
}
