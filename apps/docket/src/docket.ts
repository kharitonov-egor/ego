#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { run, type Io } from './cli.ts'
import { configPath } from './config.ts'
import { gitInfo } from './git.ts'
import { confirm, openUrl, promptHidden, readStdin } from './terminal.ts'

const io: Io = {
  env: process.env,
  cwd: process.cwd(),
  configPath: configPath(process.env),
  fetch: globalThis.fetch,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  stdinIsTty: process.stdin.isTTY === true,
  readStdin,
  promptHidden,
  confirm,
  openUrl,
  readFile: async (path) => new Uint8Array(await readFile(path)),
  writeFile: (path, data) => writeFile(path, data),
  git: (cwd) => gitInfo(cwd),
  hostname
}

process.exitCode = await run(process.argv.slice(2), io)
