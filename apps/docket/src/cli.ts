import { basename } from 'node:path'
import { parseArgs } from 'node:util'
import {
  DocketError, VERSION, createClient, readDetail, readKey, readList, readUploaded, uploadForm,
  type Client, type DocketDetail, type DocketSummary, type DocketUpdate, type KeySummary, type UploadMeta
} from './api.ts'
import {
  DEFAULT_API_URL, KEY_PREFIX, clearLogin, normalizeUrl, readLogin, resolveConnection, saveLogin, webUrl,
  type Connection, type Env
} from './config.ts'
import type { GitInfo } from './git.ts'

export const MAX_BYTES = 10 * 1024 * 1024

export interface Io {
  env: Env
  cwd: string
  configPath: string
  fetch: typeof fetch
  stdout: (text: string | Uint8Array) => void
  stderr: (text: string) => void
  stdinIsTty: boolean
  readStdin: () => Promise<Uint8Array>
  promptHidden: (question: string) => Promise<string>
  confirm: (question: string) => Promise<boolean>
  openUrl: (url: string) => void
  readFile: (path: string) => Promise<Uint8Array>
  writeFile: (path: string, data: Uint8Array) => Promise<void>
  git: (cwd: string) => GitInfo
  hostname: () => string
}

export const HELP = `docket ${VERSION}: publish self-contained HTML pages to Ego, at https://ego.kharitonovegor.com/docket/<id>

Usage
  docket upload <file.html> [options]   Upload a new docket, or the next version of one with --id
  docket list                           Every docket, newest first
  docket show <id>                      One docket and its versions
  docket pull <id> [--version <n>] [--output <file>]
                                        Download the HTML, the latest version unless --version
  docket edit <id> [--title <text>] [--description <text>] [--public | --private]
  docket publish <id>                   Anyone with the link can open it
  docket unpublish <id>                 Only browsers signed in to Ego can open it
  docket open <id> [--version <n>]      Open it in the browser
  docket delete <id> --yes              Delete it and every version
  docket auth login [--key <key>]       Save an API key from Ego > Docket > CLI setup
  docket auth status                    Check the saved key
  docket auth logout                    Forget the saved key

Upload options
  --id <id>              Upload as the next version of that docket. Its link stays the same.
  --public               Make it public. A new docket starts private.
  --private              Make it private.
  --title <text>         Defaults to the file's <title>.
  --description <text>   Defaults to the file's <meta name="description">.
  --no-git               Leave out the repository, commit, and branch.
  --open                 Open the docket in the browser afterwards.

Every command
  --json                 Print the result as JSON on stdout. Errors print {"ok":false,"error":{...}}.
  -h, --help             Show this help.
  -v, --version          Print the docket version (alone, with no command).

Install on another computer (Node 18 or newer), and run it again to update:
  npm install -g https://ego.kharitonovegor.com/cli/docket.tgz
  docket auth login

Notes
  One self-contained HTML file per upload, up to 10 MB. Put CSS, scripts, and images inline (data:
  URLs) or link them over https. Relative links to other local files will not load.
  Pages run sandboxed: scripts run, but localStorage and cookies throw.
  <id> is the 10-character ID or the docket's link. Pass - as the file to read the HTML from stdin.
  Inside a git repository, upload records the repository, commit, and branch for My dockets.
  DOCKET_API_KEY and DOCKET_API_URL override the saved login.

Exit codes: 0 done, 1 failed, 2 bad arguments.
`

const OPTIONS = {
  id: { type: 'string' },
  public: { type: 'boolean' },
  private: { type: 'boolean' },
  title: { type: 'string' },
  description: { type: 'string' },
  'no-git': { type: 'boolean' },
  open: { type: 'boolean' },
  version: { type: 'string' },
  output: { type: 'string', short: 'o' },
  yes: { type: 'boolean', short: 'y' },
  key: { type: 'string' },
  'api-url': { type: 'string' },
  'no-browser': { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' }
} as const

type Flag = keyof typeof OPTIONS
type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true; strict: true }>>['values']

const COMMAND_FLAGS: Readonly<Record<string, readonly Flag[]>> = {
  upload: ['id', 'public', 'private', 'title', 'description', 'no-git', 'open'],
  list: [],
  show: [],
  pull: ['version', 'output'],
  edit: ['title', 'description', 'public', 'private'],
  publish: [],
  unpublish: [],
  open: ['version'],
  delete: ['yes'],
  'auth login': ['key', 'api-url', 'no-browser'],
  'auth status': [],
  'auth logout': []
}

class UsageError extends DocketError {
  constructor(message: string) {
    super(message, 'USAGE')
  }
}

interface Context {
  io: Io
  values: Values
  args: string[]
  json: boolean
}

interface Target {
  id: string
  version: number | null
}

export function parseTarget(value: string | undefined): Target {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) throw new UsageError('Name a docket: its 10-character ID or its link')
  if (/^[a-z0-9]{10}$/.test(trimmed)) return { id: trimmed, version: null }
  const match = /\/dockets?\/([a-z0-9]{10})(?:\/v\/([1-9][0-9]*))?\/?(?:[?#].*)?$/.exec(trimmed)
  if (match) return { id: match[1], version: match[2] ? Number(match[2]) : null }
  throw new UsageError(`"${trimmed}" is not a docket ID or link`)
}

function versionFlag(value: string | undefined): number | null {
  if (value === undefined) return null
  const version = Number(value)
  if (!Number.isSafeInteger(version) || version < 1) throw new UsageError('--version takes a version number, like 2')
  return version
}

function visibilityFlag(values: Values): boolean | undefined {
  if (values.public && values.private) throw new UsageError('Pass --public or --private, not both')
  return values.public ? true : values.private ? false : undefined
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function stamp(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function visibility(docket: Pick<DocketSummary, 'public'>): string {
  return docket.public ? 'public' : 'private'
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** Columns padded to the widest cell, the way `git` and `gh` print lists. */
export function table(rows: readonly (readonly string[])[]): string {
  const widths = rows[0]?.map((_, column) => Math.max(...rows.map((row) => row[column]?.length ?? 0))) ?? []
  return rows.map((row) => row.map((cell, column) => column === row.length - 1 ? cell : cell.padEnd(widths[column])).join('  ').trimEnd())
    .join('\n')
}

function print(context: Context, data: unknown, text: string): void {
  context.io.stdout(context.json ? `${JSON.stringify(data, null, 2)}\n` : `${text}\n`)
}

async function connect(context: Context): Promise<{ client: Client; connection: Connection }> {
  const connection = resolveConnection(context.io.env, await readLogin(context.io.configPath))
  if (!connection) throw new DocketError('Not signed in. Run docket auth login first, or set DOCKET_API_KEY.', 'AUTH_REQUIRED')
  return { client: createClient(connection, context.io.fetch), connection }
}

async function readHtml(context: Context, file: string): Promise<{ bytes: Uint8Array; fileName: string | undefined }> {
  let bytes: Uint8Array
  try {
    bytes = file === '-' ? await context.io.readStdin() : await context.io.readFile(file)
  } catch {
    throw new UsageError(`Could not read ${file}`)
  }
  const name = file === '-' ? 'stdin' : file
  if (bytes.byteLength === 0) throw new UsageError(`${name} is empty`)
  if (bytes.byteLength > MAX_BYTES) {
    throw new UsageError(`${name} is ${size(bytes.byteLength)}. A docket can be up to 10 MB: inline smaller images or link them over https.`)
  }
  return { bytes, fileName: file === '-' ? undefined : basename(file) }
}

async function upload(context: Context): Promise<void> {
  const [file, ...extra] = context.args
  if (!file) throw new UsageError('Name the HTML file to upload, or - for stdin')
  if (extra.length > 0) throw new UsageError('Upload one file at a time')
  const target = context.values.id === undefined ? null : parseTarget(context.values.id)
  const isPublic = visibilityFlag(context.values)
  const { bytes, fileName } = await readHtml(context, file)
  const git = context.values['no-git'] ? {} : context.io.git(context.io.cwd)
  const meta: UploadMeta = {
    ...git,
    ...(fileName ? { fileName } : {}),
    ...(context.values.title !== undefined ? { title: context.values.title } : {}),
    ...(context.values.description !== undefined ? { description: context.values.description } : {}),
    ...(isPublic !== undefined ? { public: isPublic } : {})
  }
  const { client } = await connect(context)
  const path = target ? `/v1/dockets/${target.id}/versions` : '/v1/dockets'
  const result = await client.json(path, readUploaded, { method: 'POST', body: uploadForm(bytes, meta) })
  const { docket } = result
  const lines = [
    `Uploaded v${result.version} of "${docket.title}" (${visibility(docket)})`,
    docket.url,
    ...(result.version > 1 ? [`This version alone: ${result.versionUrl}`] : []),
    `ID ${docket.id}. Next version: docket upload <file> --id ${docket.id}`
  ]
  print(context, result, lines.join('\n'))
  if (context.values.open) context.io.openUrl(docket.url)
}

async function list(context: Context): Promise<void> {
  if (context.args.length > 0) throw new UsageError('list takes no arguments')
  const { client } = await connect(context)
  const dockets = await client.json('/v1/dockets', readList)
  const text = dockets.length === 0
    ? 'No dockets yet. Upload one with docket upload <file.html>.'
    : table([
      ['ID', 'VISIBILITY', 'VERSION', 'UPDATED', 'TITLE'],
      ...dockets.map((docket) => [
        docket.id, visibility(docket), `v${docket.latestVersion}`, stamp(docket.updatedAt),
        docket.repository ? `${docket.title}  [${docket.repository}]` : docket.title
      ])
    ])
  print(context, dockets, text)
}

function describeDetail(docket: DocketDetail): string {
  return [
    docket.title,
    ...(docket.description ? [docket.description] : []),
    docket.url,
    `ID ${docket.id} · ${visibility(docket)} · ${plural(docket.versionCount, 'version')}${docket.repository ? ` · ${docket.repository}` : ''}`,
    '',
    table([
      ['VERSION', 'COMMIT', 'REF', 'PUBLISHED', 'SIZE'],
      ...docket.versions.map((version) => [
        `v${version.version}`, version.commit?.slice(0, 7) ?? '', version.ref ?? '', stamp(version.createdAt), size(version.size)
      ])
    ])
  ].join('\n')
}

function oneTarget(context: Context, command: string): Target {
  if (context.args.length > 1) throw new UsageError(`${command} takes one docket`)
  return parseTarget(context.args[0])
}

async function show(context: Context): Promise<void> {
  const target = oneTarget(context, 'show')
  const { client } = await connect(context)
  const docket = await client.json(`/v1/dockets/${target.id}`, readDetail)
  print(context, docket, describeDetail(docket))
}

async function pull(context: Context): Promise<void> {
  const target = oneTarget(context, 'pull')
  const version = versionFlag(context.values.version) ?? target.version
  const { client } = await connect(context)
  const html = await client.html(`/v1/dockets/${target.id}/html${version ? `?version=${version}` : ''}`)
  const output = context.values.output
  if (output) {
    await context.io.writeFile(output, html.bytes)
    print(context, { id: target.id, version: html.version, output, size: html.bytes.byteLength },
      `Saved v${html.version ?? version ?? '?'} of ${target.id} to ${output}`)
    return
  }
  if (context.json) print(context, { id: target.id, version: html.version, html: new TextDecoder().decode(html.bytes) }, '')
  else context.io.stdout(html.bytes)
}

async function update(context: Context, target: Target, change: DocketUpdate): Promise<DocketDetail> {
  const { client } = await connect(context)
  return client.json(`/v1/dockets/${target.id}`, readDetail, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(change)
  })
}

async function edit(context: Context): Promise<void> {
  const target = oneTarget(context, 'edit')
  const isPublic = visibilityFlag(context.values)
  const change: DocketUpdate = {
    ...(context.values.title !== undefined ? { title: context.values.title } : {}),
    ...(context.values.description !== undefined ? { description: context.values.description } : {}),
    ...(isPublic !== undefined ? { public: isPublic } : {})
  }
  if (Object.keys(change).length === 0) throw new UsageError('Pass --title, --description, --public, or --private. To change the HTML, docket upload <file> --id <id>.')
  const docket = await update(context, target, change)
  print(context, docket, `Updated "${docket.title}" (${visibility(docket)})\n${docket.url}`)
}

async function setVisibility(context: Context, visible: boolean): Promise<void> {
  const target = oneTarget(context, visible ? 'publish' : 'unpublish')
  const docket = await update(context, target, { public: visible })
  const who = visible ? 'anyone with the link can open it' : 'only browsers signed in to Ego can open it'
  print(context, docket, `"${docket.title}" is ${visibility(docket)}: ${who}.\n${docket.url}`)
}

async function open(context: Context): Promise<void> {
  const target = oneTarget(context, 'open')
  const version = versionFlag(context.values.version) ?? target.version
  const { client } = await connect(context)
  const docket = await client.json(`/v1/dockets/${target.id}`, readDetail)
  const chosen = version === null ? null : docket.versions.find((entry) => entry.version === version)
  if (version !== null && !chosen) throw new DocketError(`This docket has no version ${version}`, 'NOT_FOUND')
  const url = chosen?.url ?? docket.url
  context.io.openUrl(url)
  print(context, { id: docket.id, version: chosen?.version ?? docket.latestVersion, url }, url)
}

async function remove(context: Context): Promise<void> {
  const target = oneTarget(context, 'delete')
  const { client } = await connect(context)
  const docket = await client.json(`/v1/dockets/${target.id}`, readDetail)
  if (!context.values.yes) {
    if (!context.io.stdinIsTty) throw new UsageError('Pass --yes to delete without a prompt')
    const sure = await context.io.confirm(`Delete "${docket.title}" and all ${plural(docket.versionCount, 'version')}?`)
    if (!sure) {
      print(context, { id: docket.id, deleted: false }, 'Kept it.')
      return
    }
  }
  await client.json(`/v1/dockets/${target.id}`, () => true, { method: 'DELETE' })
  print(context, { id: docket.id, deleted: true }, `Deleted "${docket.title}" and its ${plural(docket.versionCount, 'version')}.`)
}

const DEFAULT_KEY_NAME = /^CLI · \d{4}-\d{2}-\d{2}$/

/** A key still under its default name takes this computer's, so CLI setup in Ego shows where each key lives. */
async function nameAfterComputer(client: Client, current: KeySummary, hostname: string): Promise<KeySummary> {
  const name = hostname.trim().slice(0, 70)
  if (!DEFAULT_KEY_NAME.test(current.name) || !name) return current
  try {
    return await client.json('/v1/docket-keys/current', readKey, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `CLI · ${name}` })
    })
  } catch {
    return current
  }
}

async function login(context: Context): Promise<void> {
  if (context.args.length > 0) throw new UsageError('Pass the key with --key, or paste it at the prompt')
  const { io, values } = context
  const saved = await readLogin(io.configPath)
  const apiUrl = normalizeUrl(values['api-url'] || io.env.DOCKET_API_URL || saved?.apiUrl || DEFAULT_API_URL)
  let key = values.key?.trim() ?? ''
  if (!key && !io.stdinIsTty) key = new TextDecoder().decode(await io.readStdin()).trim()
  if (!key) {
    const setup = `${webUrl(io.env)}/dockets/cli`
    io.stderr(`Open ${setup}, generate a key, and paste it here.\n`)
    if (!values['no-browser']) io.openUrl(setup)
    key = await io.promptHidden('API key: ')
  }
  if (!key.startsWith(KEY_PREFIX)) throw new UsageError(`That is not a docket API key. Keys start with ${KEY_PREFIX}.`)
  const client = createClient({ apiUrl, key, source: 'config' }, io.fetch)
  const current = await nameAfterComputer(client, await client.json('/v1/docket-keys/current', readKey), io.hostname())
  await saveLogin(io.configPath, { apiUrl, key, keyName: current.name })
  print(context, { signedIn: true, key: current, apiUrl, config: io.configPath },
    `Signed in with "${current.name}". Saved to ${io.configPath}.`)
}

async function status(context: Context): Promise<void> {
  const { client, connection } = await connect(context)
  const current = await client.json('/v1/docket-keys/current', readKey)
  const from = connection.source === 'config' ? context.io.configPath : 'DOCKET_API_KEY'
  print(context, { signedIn: true, key: current, apiUrl: connection.apiUrl, source: from },
    `Signed in with "${current.name}" from ${from}.\nServer: ${connection.apiUrl}`)
}

async function logout(context: Context): Promise<void> {
  const removed = await clearLogin(context.io.configPath)
  const text = removed
    ? 'Forgot the key on this computer. It still works elsewhere until you revoke it in Ego under Docket > CLI setup.'
    : 'No saved key here.'
  print(context, { signedOut: removed }, text)
}

const COMMANDS: Readonly<Record<string, (context: Context) => Promise<void>>> = {
  upload,
  list,
  show,
  pull,
  edit,
  publish: (context) => setVisibility(context, true),
  unpublish: (context) => setVisibility(context, false),
  open,
  delete: remove,
  'auth login': login,
  'auth status': status,
  'auth logout': logout
}

function commandOf(positionals: string[]): { name: string; args: string[] } {
  const [first, second, ...rest] = positionals
  if (first === 'auth') {
    if (!second) throw new UsageError('auth takes login, status, or logout')
    return { name: `auth ${second}`, args: rest }
  }
  return { name: first, args: positionals.slice(1) }
}

function report(io: Io, json: boolean, error: unknown): number {
  const known = error instanceof DocketError
  const code = known ? error.code : 'FAILED'
  const message = error instanceof Error ? error.message : String(error)
  if (json) io.stdout(`${JSON.stringify({ ok: false, error: { code, message } }, null, 2)}\n`)
  else io.stderr(`docket: ${message}${code === 'USAGE' ? '\nRun docket --help for usage.' : ''}\n`)
  return code === 'USAGE' ? 2 : 1
}

export async function run(argv: string[], io: Io): Promise<number> {
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v')) {
    io.stdout(`${VERSION}\n`)
    return 0
  }
  const json = argv.includes('--json')
  let parsed: { values: Values; positionals: string[] }
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  } catch (error) {
    return report(io, json, new UsageError(error instanceof Error ? error.message : 'Check the arguments'))
  }
  const { values, positionals } = parsed
  if (values.help || positionals.length === 0) {
    io.stdout(HELP)
    return 0
  }
  try {
    const { name, args } = commandOf(positionals)
    const handler = COMMANDS[name]
    if (!handler) throw new UsageError(`Unknown command: ${name}`)
    const allowed = new Set<Flag>(['json', 'help', ...(COMMAND_FLAGS[name] ?? [])])
    for (const flag of Object.keys(values)) {
      if (!allowed.has(flag as Flag)) throw new UsageError(`--${flag} does not apply to ${name}`)
    }
    await handler({ io, values, args, json })
    return 0
  } catch (error) {
    return report(io, json, error)
  }
}
