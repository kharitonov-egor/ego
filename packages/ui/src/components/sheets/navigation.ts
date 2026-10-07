export interface CellRef {
  rowId: string
  columnId: string
}

export type GridMove = 'up' | 'down' | 'left' | 'right' | 'rowStart' | 'rowEnd' | 'top' | 'bottom' | 'pageUp' | 'pageDown'

/** The move a key asks for, the way spreadsheets read arrows, Home, End, and Page keys. */
export function gridMove(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>): GridMove | null {
  const jump = event.ctrlKey || event.metaKey
  switch (event.key) {
    case 'ArrowUp': return jump ? 'top' : 'up'
    case 'ArrowDown': return jump ? 'bottom' : 'down'
    case 'ArrowLeft': return jump ? 'rowStart' : 'left'
    case 'ArrowRight': return jump ? 'rowEnd' : 'right'
    case 'Home': return jump ? 'top' : 'rowStart'
    case 'End': return jump ? 'bottom' : 'rowEnd'
    case 'PageUp': return 'pageUp'
    case 'PageDown': return 'pageDown'
    default: return null
  }
}

/**
 * The cell a move lands on, stopping at the edges. With nothing selected, or a selection whose
 * row or column has gone, any move starts at the first cell after the name.
 */
export function moveSelection(
  rowIds: readonly string[], columnIds: readonly string[], from: CellRef | null, move: GridMove, page: number
): CellRef | null {
  if (rowIds.length === 0 || columnIds.length === 0) return null
  const row = from ? rowIds.indexOf(from.rowId) : -1
  const column = from ? columnIds.indexOf(from.columnId) : -1
  if (row < 0 || column < 0) return { rowId: rowIds[0], columnId: columnIds[Math.min(1, columnIds.length - 1)] }
  const lastRow = rowIds.length - 1
  const lastColumn = columnIds.length - 1
  const clamp = (value: number, max: number): number => Math.max(0, Math.min(max, value))
  const [nextRow, nextColumn] = ((): [number, number] => {
    switch (move) {
      case 'up': return [row - 1, column]
      case 'down': return [row + 1, column]
      case 'left': return [row, column - 1]
      case 'right': return [row, column + 1]
      case 'rowStart': return [row, 0]
      case 'rowEnd': return [row, lastColumn]
      case 'top': return [0, column]
      case 'bottom': return [lastRow, column]
      case 'pageUp': return [row - page, column]
      case 'pageDown': return [row + page, column]
    }
  })()
  return { rowId: rowIds[clamp(nextRow, lastRow)], columnId: columnIds[clamp(nextColumn, lastColumn)] }
}

/**
 * A key that types a character, so a spreadsheet starts editing the cell with it. Windows reports
 * AltGr as Ctrl+Alt, so a character typed with AltGr counts too.
 */
export function typedKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'getModifierState'>): string | null {
  const altGraph = event.getModifierState('AltGraph')
  if (!altGraph && (event.ctrlKey || event.metaKey || event.altKey)) return null
  return [...event.key].length === 1 && event.key !== ' ' ? event.key : null
}
