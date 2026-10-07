import {
  AGENT_MEMORY_MAX_CHARS, AGENT_MEMORY_MAX_NOTES, type AgentMemory, type AgentMemorySource
} from '@ego/api-contracts'
import { query } from './reads'

interface MemoryRow {
  id: string
  dataset_id: string
  text: string
  source: AgentMemorySource
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export class MemoryError extends Error {}

function toMemory(row: MemoryRow): AgentMemory {
  return { id: row.id, text: row.text, source: row.source, createdAt: row.created_at, updatedAt: row.updated_at }
}

/** One line, trimmed, within the length a note may have. Null when nothing is left. */
export function cleanMemoryText(text: string): string | null {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length < 3) return null
  return cleaned.length > AGENT_MEMORY_MAX_CHARS ? cleaned.slice(0, AGENT_MEMORY_MAX_CHARS) : cleaned
}

async function rowFor(db: D1Database, datasetId: string, id: string): Promise<MemoryRow | null> {
  const rows = await query<MemoryRow>(db, 'SELECT * FROM agent_memories WHERE id = ? AND dataset_id = ? AND deleted_at IS NULL', [id, datasetId])
  return rows[0] ?? null
}

/** Newest first. */
export async function listMemories(db: D1Database, datasetId: string): Promise<AgentMemory[]> {
  const rows = await query<MemoryRow>(db, `SELECT * FROM agent_memories WHERE dataset_id = ? AND deleted_at IS NULL
    ORDER BY updated_at DESC, id LIMIT ?`, [datasetId, AGENT_MEMORY_MAX_NOTES])
  return rows.map(toMemory)
}

/**
 * Saves a note, or rewrites the one it `replaces`. The same text twice keeps one note. The list is
 * capped so the chat can read all of it on every turn.
 */
export async function addMemory(
  db: D1Database, datasetId: string, text: string, source: AgentMemorySource, now: string, replaces: string | null = null
): Promise<AgentMemory> {
  const cleaned = cleanMemoryText(text)
  if (!cleaned) throw new MemoryError('A note needs at least a few words')
  if (replaces) {
    const updated = await updateMemory(db, datasetId, replaces, cleaned, now, source)
    if (updated) return updated
  }
  const same = await query<MemoryRow>(db, `SELECT * FROM agent_memories WHERE dataset_id = ? AND deleted_at IS NULL
    AND lower(text) = lower(?) LIMIT 1`, [datasetId, cleaned])
  if (same[0]) {
    await db.prepare('UPDATE agent_memories SET updated_at = ? WHERE id = ?').bind(now, same[0].id).run()
    return toMemory({ ...same[0], updated_at: now })
  }
  const count = await query<{ count: number }>(db, 'SELECT COUNT(*) AS count FROM agent_memories WHERE dataset_id = ? AND deleted_at IS NULL', [datasetId])
  if ((count[0]?.count ?? 0) >= AGENT_MEMORY_MAX_NOTES) {
    throw new MemoryError(`Ego keeps up to ${AGENT_MEMORY_MAX_NOTES} notes. Forget an old one first.`)
  }
  const row: MemoryRow = {
    id: crypto.randomUUID(), dataset_id: datasetId, text: cleaned, source, created_at: now, updated_at: now, deleted_at: null
  }
  await db.prepare(`INSERT INTO agent_memories (id, dataset_id, text, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(row.id, datasetId, row.text, source, now, now).run()
  return toMemory(row)
}

export async function updateMemory(
  db: D1Database, datasetId: string, id: string, text: string, now: string, source: AgentMemorySource = 'user'
): Promise<AgentMemory | null> {
  const cleaned = cleanMemoryText(text)
  if (!cleaned) throw new MemoryError('A note needs at least a few words')
  const row = await rowFor(db, datasetId, id)
  if (!row) return null
  await db.prepare('UPDATE agent_memories SET text = ?, source = ?, updated_at = ? WHERE id = ?').bind(cleaned, source, now, id).run()
  return toMemory({ ...row, text: cleaned, source, updated_at: now })
}

/** The note that was forgotten, or null when there was none. */
export async function forgetMemory(db: D1Database, datasetId: string, id: string, now: string): Promise<AgentMemory | null> {
  const row = await rowFor(db, datasetId, id)
  if (!row) return null
  await db.prepare('UPDATE agent_memories SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(now, now, id).run()
  return toMemory(row)
}
