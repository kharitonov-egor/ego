import React from 'react'
import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router'
import { SheetsProvider } from '../../lib/sheets/context'
import RowScreen from './RowPage'
import SheetsScreen from './SheetsList'
import SheetScreen from './SheetView'

function SheetRoute(): React.ReactElement {
  const { id = '' } = useParams()
  return <SheetScreen key={id} sheetId={id} />
}

/** `/sheets/row/new?sheetId=…&typeId=…` adds a row; any other ID opens that row. */
function RowRoute(): React.ReactElement {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  return <RowScreen key={id} rowId={id} sheetId={params.get('sheetId') ?? ''} typeId={params.get('typeId') || null} />
}

/** Every Sheets page, under one provider so a row waiting on Undo survives moving between them. */
export default function SheetsApp(): React.ReactElement {
  return <SheetsProvider>
    <Routes>
      <Route index element={<SheetsScreen />} />
      <Route path="row/:id" element={<RowRoute />} />
      <Route path=":id" element={<SheetRoute />} />
      <Route path="*" element={<Navigate to="/sheets" replace />} />
    </Routes>
  </SheetsProvider>
}
