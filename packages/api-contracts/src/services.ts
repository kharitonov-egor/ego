export interface TrelloCardRequest {
  title: string
  description: string
  listId: string
}

export interface TrelloCardResponse {
  id: string
  shortUrl: string
}

export const MAX_TRELLO_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** One sync of the Work list. `problem` is the first change Trello refused; everything else still synced. */
export interface TrelloWorkSyncResult {
  changed: boolean
  problem: string | null
  /** Cards that sync with Trello. Every other card in the Work list lives only in Ego. */
  linked?: string[]
}

/** Settings every device shares. Each key has its own shape, checked by the Worker. */
export const SHARED_SETTING_KEYS = ['hotkeys'] as const
export type SharedSettingKey = typeof SHARED_SETTING_KEYS[number]

export function isSharedSettingKey(value: unknown): value is SharedSettingKey {
  return (SHARED_SETTING_KEYS as readonly unknown[]).includes(value)
}

/** The newest save wins, by the time the device saved it. */
export interface SharedSetting {
  value: unknown
  updatedAt: string
}
