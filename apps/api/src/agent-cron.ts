import { expireProposals } from './agent-chat'
import type { Env } from './auth'
import { failStaleRuns, fireRoutine, queueDueGoals } from './goals'
import { query } from './reads'

/**
 * The 15-minute check: drop proposals nobody answered, fail runs that died, queue the goals that
 * are due, and wake the routine once for everything queued.
 */
export async function runScheduledAgent(env: Env, now: Date): Promise<void> {
  const at = now.toISOString()
  await expireProposals(env, at)
  await failStaleRuns(env.DB, at)
  await queueDueGoals(env.DB, at)
  const datasets = await query<{ dataset_id: string }>(env.DB, `SELECT DISTINCT dataset_id FROM agent_runs WHERE status = 'queued'`)
  for (const row of datasets) await fireRoutine(env, row.dataset_id, at)
}
