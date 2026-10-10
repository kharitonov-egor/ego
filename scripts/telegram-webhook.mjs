#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_WORKER = 'https://ego-money.ega-khar.workers.dev'

function usage() {
  console.log(`Usage:
  node scripts/telegram-webhook.mjs owner          Clears the webhook, waits for one message to the bot, prints the sender's ID
  node scripts/telegram-webhook.mjs set [worker]   Points the bot at <worker>/v1/telegram/webhook (default ${DEFAULT_WORKER})
  node scripts/telegram-webhook.mjs info           Shows where the bot delivers and the last delivery error

TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET come from the environment or apps/api/.env.local.`)
}

function localEnv() {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api', '.env.local')
  if (!existsSync(file)) return {}
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
    .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line))
    .filter(Boolean)
    .map((match) => [match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]))
}

const saved = localEnv()
const setting = (name) => process.env[name]?.trim() || saved[name]?.trim() || ''

async function call(token, method, body = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })
  const payload = await response.json()
  if (!payload.ok) throw new Error(`${method}: ${payload.description ?? response.status}`)
  return payload.result
}

async function owner(token) {
  await call(token, 'deleteWebhook')
  const me = await call(token, 'getMe')
  console.log(`Send any message to @${me.username} from your own account. Waiting...`)
  let offset = 0
  for (;;) {
    const updates = await call(token, 'getUpdates', { offset, timeout: 50, allowed_updates: ['message'] })
    for (const update of updates) {
      offset = update.update_id + 1
      const message = update.message
      if (message?.chat?.type !== 'private' || !message.from) continue
      await call(token, 'getUpdates', { offset, timeout: 0 })
      console.log(`TELEGRAM_OWNER_ID=${message.from.id}  (${[message.from.first_name, message.from.last_name].filter(Boolean).join(' ')})`)
      return
    }
  }
}

async function main() {
  const [command, worker = DEFAULT_WORKER] = process.argv.slice(2)
  const token = setting('TELEGRAM_BOT_TOKEN')
  if (!command || !['owner', 'set', 'info'].includes(command)) return usage()
  if (!token) throw new Error('Set TELEGRAM_BOT_TOKEN first')
  if (command === 'owner') return owner(token)
  if (command === 'set') {
    const secret = setting('TELEGRAM_WEBHOOK_SECRET')
    if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) throw new Error('Set TELEGRAM_WEBHOOK_SECRET to 16 to 256 letters, digits, - or _')
    const url = `${worker.replace(/\/+$/, '')}/v1/telegram/webhook`
    // One delivery at a time, so the photos of an album reach the same card in order.
    await call(token, 'setWebhook', { url, secret_token: secret, allowed_updates: ['message'], max_connections: 1 })
    console.log(`The bot now delivers to ${url}`)
  }
  const info = await call(token, 'getWebhookInfo')
  console.log(JSON.stringify({
    url: info.url || null, pending: info.pending_update_count, maxConnections: info.max_connections ?? null,
    lastError: info.last_error_message ?? null,
    lastErrorAt: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
