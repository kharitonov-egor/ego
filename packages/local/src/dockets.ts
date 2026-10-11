import type { DocketSummary } from '@ego/api-contracts'

export type DocketOrder = 'newest' | 'oldest' | 'updated' | 'project'

export const DOCKET_ORDERS: ReadonlyArray<{ value: DocketOrder; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'project', label: 'By project' }
]

/** Where every device keeps the list's order. */
export const DOCKET_ORDER_KEY = 'ego.dockets.order'

export function isDocketOrder(value: unknown): value is DocketOrder {
  return DOCKET_ORDERS.some((order) => order.value === value)
}

/** Newest and oldest go by the first upload. Updated goes by the latest version, as the Worker lists them. */
export function sortDockets(dockets: readonly DocketSummary[], order: Exclude<DocketOrder, 'project'>): DocketSummary[] {
  const field = order === 'updated' ? 'updatedAt' : 'createdAt'
  const sorted = [...dockets].sort((a, b) => a[field].localeCompare(b[field]) || a.id.localeCompare(b.id))
  return order === 'oldest' ? sorted : sorted.reverse()
}

/** The date a row shows: the one its order sorts by. */
export function docketDate(docket: DocketSummary, order: DocketOrder): string {
  return order === 'newest' || order === 'oldest' ? docket.createdAt : docket.updatedAt
}

export interface DocketGroup {
  repository: string | null
  dockets: DocketSummary[]
}

/** Keeps the list's order: a repository sits where its first docket would. */
export function groupByRepository(dockets: readonly DocketSummary[]): DocketGroup[] {
  const groups = new Map<string | null, DocketSummary[]>()
  for (const docket of dockets) {
    const group = groups.get(docket.repository)
    if (group) group.push(docket)
    else groups.set(docket.repository, [docket])
  }
  return [...groups].map(([repository, members]) => ({ repository, dockets: members }))
}
