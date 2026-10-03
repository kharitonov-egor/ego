import type { Env } from './auth'
import { BACKUP_CRON, runScheduledBackup } from './backup'
import { runScheduledHealthSync } from './health'
import { handle } from './router'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handle(request, env, ctx)
    } catch {
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'SERVER_ERROR', message: 'The request could not be completed' } }),
        { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } }
      )
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date(controller.scheduledTime)
    if (controller.cron === BACKUP_CRON) ctx.waitUntil(runScheduledBackup(env, now))
    else ctx.waitUntil(runScheduledHealthSync(env, now))
  }
}
