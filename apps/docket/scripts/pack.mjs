#!/usr/bin/env node
// Bundles the CLI into one JavaScript file and an npm tarball, so any computer with Node 18 can run
// `npm install -g https://ego.kharitonovegor.com/cli/docket.tgz` without a checkout of this repo.
// The web build runs this after `vite build` and writes into dist/cli. Usage: node pack.mjs <out-dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.argv[2] ?? join(root, 'dist'))
const source = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const bundled = await build({
  entryPoints: [join(root, 'src', 'docket.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  write: false,
  legalComments: 'none'
})
const script = bundled.outputFiles[0].contents

const manifest = {
  name: source.name,
  version: source.version,
  description: source.description,
  type: 'module',
  bin: { docket: 'docket.mjs' },
  engines: { node: '>=18.18' }
}

// npm packs with this date too, so the same source always makes the same tarball.
const MTIME = 499162500

function header(name, size, mode) {
  const block = Buffer.alloc(512)
  block.write(name, 0, 100, 'utf8')
  block.write(`${mode.toString(8).padStart(7, '0')}\0`, 100, 8)
  block.write('0000000\0', 108, 8)
  block.write('0000000\0', 116, 8)
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12)
  block.write(`${MTIME.toString(8).padStart(11, '0')}\0`, 136, 12)
  block.write('        ', 148, 8)
  block.write('0', 156, 1)
  block.write('ustar\0', 257, 6)
  block.write('00', 263, 2)
  const checksum = block.reduce((sum, byte) => sum + byte, 0)
  block.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8)
  return block
}

function tar(entries) {
  const blocks = []
  for (const { name, data, mode } of entries) {
    blocks.push(header(name, data.length, mode), data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return Buffer.concat(blocks)
}

const archive = gzipSync(tar([
  { name: 'package/package.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), mode: 0o644 },
  { name: 'package/docket.mjs', data: Buffer.from(script), mode: 0o755 }
]), { level: 9 })

mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'docket.mjs'), script)
writeFileSync(join(out, 'docket.tgz'), archive)
console.log(`docket ${source.version}: ${join(out, 'docket.tgz')} (${archive.length} bytes)`)
