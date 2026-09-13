#!/usr/bin/env node
import { writeFileSync } from 'node:fs'

/**
 * Reads both sides of the migration and reports whether they agree. It never writes to either
 * database. Credentials come from the environment so nothing lands in the repository:
 *
 *   CF_ACCOUNT_ID, CF_DATABASE_ID, CF_API_TOKEN   the legacy direct D1 connection
 *   EGO_API_URL, EGO_DEVICE_TOKEN                 the Worker
 *
 *   node scripts/ego-migrate.mjs backup ./ego-backup.json
 *   node scripts/ego-migrate.mjs compare
 */

const legacy = {
  accountId: process.env.CF_ACCOUNT_ID ?? '',
  databaseId: process.env.CF_DATABASE_ID ?? '',
  token: process.env.CF_API_TOKEN ?? ''
}
const worker = {
  url: (process.env.EGO_API_URL ?? '').replace(/\/+$/, ''),
  token: process.env.EGO_DEVICE_TOKEN ?? ''
}

function required(values, names) {
  const missing = names.filter((name) => !values[name])
  if (missing.length === 0) return
  console.error(`Set these environment variables first: ${missing.join(', ')}`)
  process.exit(1)
}

async function d1(sql) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${legacy.accountId}/d1/database/${legacy.databaseId}/query`
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${legacy.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql })
  })
  const payload = await response.json()
  if (!response.ok || !payload.success) {
    throw new Error(payload.errors?.[0]?.message ?? `D1 returned HTTP ${response.status}`)
  }
  return payload.result?.[0]?.results ?? []
}

async function api(path) {
  const response = await fetch(`${worker.url}${path}`, {
    headers: { authorization: `Bearer ${worker.token}` }
  })
  const payload = await response.json()
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.error?.message ?? `The Worker returned HTTP ${response.status}`)
  }
  return payload.data
}

const TABLES = ['accounts', 'categories', 'transactions', 'purchases', 'receipt_items', 'budgets', 'budget_allocations']

async function backup(target) {
  required(legacy, ['accountId', 'databaseId', 'token'])
  const tables = {}
  for (const table of TABLES) {
    tables[table] = await d1(`SELECT * FROM ${table}`)
    console.log(`${table}: ${tables[table].length} rows`)
  }
  writeFileSync(target, JSON.stringify({ exportedAt: new Date().toISOString(), tables }, null, 2))
  console.log(`\nWrote ${target}. This file contains your whole ledger. Keep it off the repository.`)
  console.log('Restore it into a disposable database and run compare against that before trusting it.')
}

function report(label, left, right) {
  const same = left === right
  console.log(`${same ? 'ok  ' : 'DIFF'}  ${label.padEnd(28)} legacy ${String(left).padStart(12)}   worker ${String(right).padStart(12)}`)
  return same
}

async function compare() {
  required(legacy, ['accountId', 'databaseId', 'token'])
  required(worker, ['url', 'token'])
  let agreed = true

  for (const table of ['accounts', 'categories', 'transactions', 'purchases', 'budgets']) {
    const rows = await d1(`SELECT COUNT(*) AS total FROM ${table}`)
    const snapshot = await api('/v1/legacy/snapshot')
    const remote = table === 'purchases'
      ? snapshot.purchases.length
      : table === 'budgets' ? snapshot.budgets.length : snapshot[table].length
    agreed = report(`${table} count`, rows[0].total, remote) && agreed
  }

  const legacyBalances = await d1(`
    SELECT a.id,
      a.opening_balance_cents
      + COALESCE((SELECT SUM(CASE t.kind WHEN 'income' THEN t.amount_cents ELSE -t.amount_cents END)
          FROM transactions t WHERE t.account_id = a.id), 0)
      + COALESCE((SELECT SUM(t.amount_cents) FROM transactions t
          WHERE t.kind = 'transfer' AND t.destination_account_id = a.id), 0) AS balance_cents
    FROM accounts a`)
  const remoteBalances = await api('/v1/balances')
  for (const row of legacyBalances) {
    const remote = remoteBalances.balances.find((balance) => balance.accountId === row.id)
    agreed = report(`balance ${row.id}`, row.balance_cents, remote?.balanceCents ?? 'missing') && agreed
  }

  const flows = await d1(`
    SELECT COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_cents ELSE 0 END), 0) AS income_cents,
      COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_cents ELSE 0 END), 0) AS expense_cents
    FROM transactions`)
  const summary = await api('/v1/summary')
  agreed = report('income total', flows[0].income_cents, summary.incomeCents) && agreed
  agreed = report('expense total', flows[0].expense_cents, summary.expenseCents) && agreed

  console.log(agreed
    ? '\nBoth sides agree. Counts and aggregates match.'
    : '\nThe two sides disagree. Do not remove the legacy credentials.')
  if (!agreed) process.exitCode = 1
}

const [command, target] = process.argv.slice(2)
if (command === 'backup') {
  await backup(target ?? `ego-backup-${new Date().toISOString().slice(0, 10)}.json`)
} else if (command === 'compare') {
  await compare()
} else {
  console.log(`Usage:
  node scripts/ego-migrate.mjs backup [file]   export the legacy database to a JSON file
  node scripts/ego-migrate.mjs compare         check counts, balances, and totals on both sides`)
  process.exit(1)
}
