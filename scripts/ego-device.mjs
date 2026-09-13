#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const DATABASE = 'ego-money'

function usage() {
  console.log(`Usage:
  node scripts/ego-device.mjs enroll <device-name> [--apply] [--remote]
  node scripts/ego-device.mjs revoke <device-id> [--apply] [--remote]
  node scripts/ego-device.mjs list [--remote]

Without --apply the command prints the SQL instead of running it.
The device token is shown once. Store it in the app, never in the repository.`)
}

function runWrangler(sql, remote) {
  const args = ['wrangler', 'd1', 'execute', DATABASE, remote ? '--remote' : '--local', '--command', sql]
  const result = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exitCode = result.status ?? 1
}

function emit(sql, options) {
  if (options.apply) {
    runWrangler(sql, options.remote)
    return
  }
  console.log(`\nRun this against ${options.remote ? 'the deployed' : 'the local'} database:\n${sql}`)
}

function quote(value) {
  return `'${value.replaceAll("'", "''")}'`
}

const [command, argument] = process.argv.slice(2).filter((value) => !value.startsWith('--'))
const options = {
  apply: process.argv.includes('--apply'),
  remote: process.argv.includes('--remote')
}

if (command === 'enroll') {
  if (!argument) {
    usage()
    process.exit(1)
  }
  const token = randomBytes(36).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const deviceId = `device-${randomBytes(6).toString('hex')}`
  const now = new Date().toISOString()
  console.log(`Device ID: ${deviceId}`)
  console.log(`Device token (shown once): ${token}`)
  emit(`INSERT INTO devices (id, name, token_hash, dataset_id, created_at) VALUES (${quote(deviceId)}, ${quote(argument)}, ${quote(tokenHash)}, ${quote(DATABASE)}, ${quote(now)});`, options)
} else if (command === 'revoke') {
  if (!argument) {
    usage()
    process.exit(1)
  }
  emit(`UPDATE devices SET revoked_at = ${quote(new Date().toISOString())} WHERE id = ${quote(argument)};`, options)
} else if (command === 'list') {
  runWrangler('SELECT id, name, created_at, last_seen_at, revoked_at FROM devices ORDER BY created_at;', options.remote)
} else {
  usage()
  process.exit(1)
}
