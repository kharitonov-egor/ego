import React, { useState } from 'react'
import { useNavigate } from 'react-router'
import { Archive, ChevronRight, Plus, RotateCcw, Trash2, Users } from 'lucide-react'
import type { SheetRecord } from '@ego/api-contracts'
import { sheetSummary } from '@ego/local/sheets/view'
import { Screen, ScreenBody, ScreenHeader } from '../../components/screen'
import { BoardSheet } from '../../components/tasks/sheets'
import { ReorderList } from '../../components/tasks/ReorderList'
import { SheetIcon, SheetsError, SheetsGate } from '../../components/sheets/ui'
import { Button, IconButton } from '../../components/ui/button'
import { ConfirmDialog, Sheet } from '../../components/ui/dialog'
import { useSheets } from '../../lib/sheets/context'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'

function SheetRow({ sheet, lifted }: { sheet: SheetRecord; lifted: boolean }): React.ReactElement {
  const { data } = useSheets()
  return <span className={cn('flex min-h-[76px] items-center rounded-3xl px-4 py-3 transition-colors hover:bg-surface-900', lifted ? 'bg-surface-900 opacity-60' : 'bg-black')}>
    <SheetIcon icon={sheet.icon} size={44} />
    <span className="ml-3 flex min-w-0 flex-1 flex-col">
      <span className="truncate text-[18px] font-semibold text-white">{sheet.name}</span>
      <span className="mt-0.5 text-[14px] text-surface-400">{sheetSummary(sheet, data?.rows ?? [])}</span>
    </span>
    <ChevronRight color="#737373" size={20} />
  </span>
}

function ArchivedSheets({ visible, onClose }: { visible: boolean; onClose: () => void }): React.ReactElement {
  const sheets = useSheets()
  const [deleting, setDeleting] = useState<SheetRecord | null>(null)
  const archived = (sheets.data?.sheets ?? []).filter((sheet) => sheet.archivedAt !== null)
  return <Sheet visible={visible} title="Archived sheets" onClose={onClose}>
    {archived.length === 0 && <p className="text-[15px] text-muted-foreground">No archived sheets.</p>}
    {archived.map((sheet) => <div key={sheet.id} className="flex min-h-16 items-center border-b border-surface-900">
      <SheetIcon icon={sheet.icon} size={36} />
      <span className="ml-3 flex-1 truncate text-[17px] text-foreground">{sheet.name}</span>
      <IconButton label={`Restore ${sheet.name}`} onClick={() => void sheets.updateSheet(sheet.id, (input) => ({ ...input, archivedAt: null }))} className="h-11 w-11">
        <RotateCcw color={color.textSecondary} size={19} />
      </IconButton>
      <IconButton label={`Delete ${sheet.name}`} onClick={() => setDeleting(sheet)} className="h-11 w-11">
        <Trash2 color={color.destructive} size={19} />
      </IconButton>
    </div>)}
    <ConfirmDialog
      visible={deleting !== null}
      title="Delete this sheet?"
      detail="Its rows go with it, on every device. This cannot be undone."
      confirmLabel="Delete"
      destructive
      onCancel={() => setDeleting(null)}
      onConfirm={() => {
        if (deleting) void sheets.deleteSheet(deleting.id)
        setDeleting(null)
      }}
    />
  </Sheet>
}

function Sheets(): React.ReactElement {
  const sheets = useSheets()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [archive, setArchive] = useState(false)

  const all = sheets.data?.sheets ?? []
  const live = all.filter((sheet) => sheet.archivedAt === null).sort((a, b) => a.position - b.position)
  const archivedCount = all.length - live.length
  const open = (id: string): void => { void navigate(`/sheets/${id}`) }
  const start = (template: 'blank' | 'connections', name?: string, icon?: string): void => {
    void sheets.createSheet(template, name, icon).then((id) => { if (id) open(id) })
  }

  return <Screen>
    <ScreenHeader title="Sheets" right={<IconButton label="New sheet" onClick={() => setCreating(true)}><Plus size={22} /></IconButton>} />
    <SheetsError />
    {live.length === 0
      ? <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-8">
        <div className="flex w-full max-w-sm flex-col items-center">
          <h2 className="text-center text-[20px] font-semibold text-surface-100">No sheets yet</h2>
          <p className="mt-2 text-center text-[16px] leading-6 text-surface-400">
            A sheet is a table you shape yourself: add columns of text, numbers, dates, dropdowns, or tags.
          </p>
          <Button className="mt-5 w-full" size="lg" onClick={() => start('connections')}>
            <Users color="#0a0a0a" size={18} />Start Connections
          </Button>
          <p className="mt-2 text-center text-[14px] text-surface-500">A Name column, with Person and Company as row types.</p>
          <Button className="mt-4 w-full" variant="outline" size="lg" onClick={() => setCreating(true)}>
            <Plus color="#fafafa" size={18} />Blank sheet
          </Button>
          {archivedCount > 0 && <Button variant="ghost" className="mt-2" onClick={() => setArchive(true)}>Archived sheets</Button>}
        </div>
      </div>
      : <ScreenBody width="narrow">
        <ReorderList
          items={live}
          label={(sheet) => sheet.name}
          onPress={(sheet) => open(sheet.id)}
          onMove={(id, index) => void sheets.moveSheet(id, index)}
          renderItem={(sheet, lifted) => <SheetRow sheet={sheet} lifted={lifted} />}
          footer={<div className="mt-4 flex flex-col gap-3">
            <button type="button" onClick={() => setCreating(true)} className="flex min-h-14 items-center justify-center rounded-3xl border border-dashed border-surface-600 hover:bg-surface-900 active:bg-surface-900">
              <Plus color={color.textMuted} size={20} />
              <span className="ml-2 text-[16px] font-semibold text-surface-300">New sheet</span>
            </button>
            {archivedCount > 0 && <button type="button" onClick={() => setArchive(true)} className="flex min-h-12 items-center justify-center rounded-2xl hover:bg-surface-900 active:opacity-70">
              <Archive color={color.textFaint} size={17} />
              <span className="ml-2 text-[15px] text-surface-500">{archivedCount === 1 ? '1 archived sheet' : `${archivedCount} archived sheets`}</span>
            </button>}
          </div>}
        />
      </ScreenBody>}
    <BoardSheet
      visible={creating}
      title="New sheet"
      name=""
      icon="📄"
      confirm="Create"
      placeholder="Sheet name"
      onClose={() => setCreating(false)}
      onSave={(name, icon) => {
        setCreating(false)
        start('blank', name, icon)
      }}
    />
    <ArchivedSheets visible={archive} onClose={() => setArchive(false)} />
  </Screen>
}

export default function SheetsScreen(): React.ReactElement {
  return <SheetsGate header={<ScreenHeader title="Sheets" />}><Sheets /></SheetsGate>
}
