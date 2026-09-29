import type { Env } from './auth'
import { runScheduledHealthSync } from './health'
import { handle } from './router'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env)
    } catch {
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'SERVER_ERROR', message: 'The request could not be completed' } }),
        { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } }
      )
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledHealthSync(env, new Date(controller.scheduledTime)))
  }
}
