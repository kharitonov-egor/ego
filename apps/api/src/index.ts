import type { Env } from './auth'
import { runScheduledAgent } from './agent-cron'
import { BACKUP_CRON, runScheduledBackup } from './backup'
import { runScheduledCalendarSync } from './calendar'
import { runScheduledHealthSync } from './health'
import { handle } from './router'
import { preflight, withCors } from './web'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const asked = preflight(request, env)
    if (asked) return asked
    try {
      return withCors(request, env, await handle(request, env, ctx))
    } catch {
      return withCors(request, env, new Response(
        JSON.stringify({ ok: false, error: { code: 'SERVER_ERROR', message: 'The request could not be completed' } }),
        { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } }
      ))
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date(controller.scheduledTime)
    if (controller.cron === BACKUP_CRON) ctx.waitUntil(runScheduledBackup(env, now))
    else ctx.waitUntil(Promise.all([runScheduledHealthSync(env, now), runScheduledCalendarSync(env, now), runScheduledAgent(env, now)]))
  }
}
