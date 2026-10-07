import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HELP, MAX_BYTES, parseTarget, run, table, type Io } from '../src/cli.ts'
import { configPath, resolveConnection } from '../src/config.ts'
import { gitInfo, repositoryFromRemote, type RunGit } from '../src/git.ts'

const KEY = 'egodk_test-key-that-is-long-enough-for-the-worker'
const API = 'https://worker.example'
const ID = 'k3x9qa7m2p'
const PLAN = '<html><head><title>Plan</title></head><body>Plan</body></html>'

const SUMMARY = {
  id: ID, title: 'Plan', description: 'Steps', public: false, repository: 'kharitonov-egor/ego',
  latestVersion: 2, versionCount: 2, createdAt: '2026-10-06T19:02:00.000Z', updatedAt: '2026-10-07T19:02:00.000Z',
  url: `https://ego.kharitonovegor.com/docket/${ID}`
}
const DETAIL = {
  ...SUMMARY,
  versions: [
    { version: 2, size: 2048, commit: 'abcdef1234567', ref: 'main', createdAt: SUMMARY.updatedAt, url: `${SUMMARY.url}/v/2` },
    { version: 1, size: 100, commit: null, ref: null, createdAt: SUMMARY.createdAt, url: `${SUMMARY.url}/v/1` }
  ]
}

interface Harness {
  io: Io
  requests: Request[]
  out: () => string
  err: () => string
  opened: string[]
  written: Map<string, Uint8Array>
}

type Answer = (request: Request) => Response | Promise<Response>

function ok(data: unknown): Response {
  return Response.json({ ok: true, data })
}

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'docket-test-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function harness(answer: Answer, overrides: Partial<Io> = {}, env: Record<string, string> = {}): Harness {
  const requests: Request[] = []
  let stdout = ''
  let stderr = ''
  const opened: string[] = []
  const written = new Map<string, Uint8Array>()
  const files = new Map<string, Uint8Array>([['plan.html', new TextEncoder().encode(PLAN)]])
  const fullEnv = { DOCKET_CONFIG_DIR: dir, DOCKET_API_URL: API, ...env }
  const io: Io = {
    env: fullEnv,
    cwd: dir,
    configPath: configPath(fullEnv),
    fetch: async (input, init) => {
      const request = new Request(input, init)
      requests.push(request.clone())
      return answer(request)
    },
    stdout: (text) => {
      stdout += typeof text === 'string' ? text : new TextDecoder().decode(text)
    },
    stderr: (text) => {
      stderr += text
    },
    stdinIsTty: false,
    readStdin: async () => new TextEncoder().encode(''),
    promptHidden: async () => '',
    confirm: async () => false,
    openUrl: (url) => {
      opened.push(url)
    },
    readFile: async (path) => {
      const file = files.get(path)
      if (!file) throw new Error('missing')
      return file
    },
    writeFile: async (path, data) => {
      written.set(path, data)
    },
    git: () => ({ repository: 'kharitonov-egor/ego', commit: 'abcdef1234567', ref: 'main' }),
    hostname: () => 'JARVIS',
    ...overrides
  }
  return { io, requests, out: () => stdout, err: () => stderr, opened, written }
}

function withKey(answer: Answer, overrides: Partial<Io> = {}): Harness {
  return harness(answer, overrides, { DOCKET_API_KEY: KEY })
}

describe('arguments', () => {
  it('takes an ID or any docket link', () => {
    expect(parseTarget(ID)).toEqual({ id: ID, version: null })
    expect(parseTarget(`https://ego.kharitonovegor.com/docket/${ID}`)).toEqual({ id: ID, version: null })
    expect(parseTarget(`https://ego.kharitonovegor.com/docket/${ID}/v/3`)).toEqual({ id: ID, version: 3 })
    expect(parseTarget(`https://ego.kharitonovegor.com/dockets/${ID}`)).toEqual({ id: ID, version: null })
    expect(() => parseTarget('K3X9QA7M2P')).toThrow('is not a docket ID or link')
    expect(() => parseTarget('')).toThrow('Name a docket')
  })

  it('pads columns to the widest cell', () => {
    expect(table([['ID', 'TITLE'], ['abc', 'One'], ['a', 'Two']])).toBe('ID   TITLE\nabc  One\na    Two')
  })

  it('prints the help with no command and refuses flags meant for another command', async () => {
    const plain = harness(() => ok(null))
    expect(await run([], plain.io)).toBe(0)
    expect(plain.out()).toBe(HELP)
    const wrong = harness(() => ok(null))
    expect(await run(['list', '--yes'], wrong.io)).toBe(2)
    expect(wrong.err()).toContain('--yes does not apply to list')
    expect(wrong.requests).toHaveLength(0)
  })
})

describe('git details', () => {
  it('reads owner/name from SSH, HTTPS, and ssh:// remotes', () => {
    expect(repositoryFromRemote('git@github.com:kharitonov-egor/ego.git')).toBe('kharitonov-egor/ego')
    expect(repositoryFromRemote('https://github.com/kharitonov-egor/ego')).toBe('kharitonov-egor/ego')
    expect(repositoryFromRemote('ssh://git@github.com/kharitonov-egor/ego.git/')).toBe('kharitonov-egor/ego')
    expect(repositoryFromRemote('not a remote')).toBeNull()
  })

  it('falls back to another remote or the folder name, and drops a detached HEAD', () => {
    const answers: Record<string, string | null> = {
      'rev-parse --show-toplevel': 'C:/work/scratch',
      'remote get-url origin': null,
      remote: 'upstream',
      'remote get-url upstream': 'git@github.com:someone/scratch.git',
      'rev-parse --abbrev-ref HEAD': 'HEAD',
      'rev-parse HEAD': 'feed123'
    }
    const git: RunGit = (args) => answers[args.join(' ')] ?? null
    expect(gitInfo('.', git)).toEqual({ repository: 'someone/scratch', commit: 'feed123', ref: undefined })
    expect(gitInfo('.', (args) => (args.join(' ') === 'rev-parse --show-toplevel' ? 'C:/work/notes' : null)))
      .toEqual({ repository: 'notes', commit: undefined, ref: undefined })
    expect(gitInfo('.', () => null)).toEqual({})
  })
})

describe('upload', () => {
  it('sends the file with its git details and prints the link', async () => {
    const h = withKey(() => ok({ docket: { ...SUMMARY, latestVersion: 1, versionCount: 1 }, version: 1, versionUrl: `${SUMMARY.url}/v/1` }))
    expect(await run(['upload', 'plan.html', '--public', '--title', 'Custom'], h.io)).toBe(0)
    const [request] = h.requests
    expect(request.url).toBe(`${API}/v1/dockets`)
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe(`Bearer ${KEY}`)
    const form = await request.formData()
    const file = form.get('file')
    expect(file instanceof Blob ? await file.text() : null).toBe(PLAN)
    expect(JSON.parse(String(form.get('meta')))).toEqual({
      repository: 'kharitonov-egor/ego', commit: 'abcdef1234567', ref: 'main', fileName: 'plan.html', title: 'Custom', public: true
    })
    expect(h.out()).toContain(`Uploaded v1 of "Plan" (private)\n${SUMMARY.url}\n`)
    expect(h.out()).toContain(`--id ${ID}`)
  })

  it('adds a version with --id, accepting the docket link, and leaves git out on request', async () => {
    const h = withKey(() => ok({ docket: SUMMARY, version: 2, versionUrl: `${SUMMARY.url}/v/2` }))
    expect(await run(['upload', 'plan.html', '--id', SUMMARY.url, '--no-git', '--open', '--json'], h.io)).toBe(0)
    expect(h.requests[0].url).toBe(`${API}/v1/dockets/${ID}/versions`)
    expect(JSON.parse(String((await h.requests[0].formData()).get('meta')))).toEqual({ fileName: 'plan.html' })
    expect(JSON.parse(h.out())).toMatchObject({ version: 2, docket: { id: ID } })
    expect(h.opened).toEqual([SUMMARY.url])
  })

  it('stops before sending a file that is too big, empty, missing, or flagged both ways', async () => {
    const big = withKey(() => ok(null), { readFile: async () => new Uint8Array(MAX_BYTES + 1) })
    expect(await run(['upload', 'plan.html'], big.io)).toBe(2)
    expect(big.err()).toContain('up to 10 MB')
    const empty = withKey(() => ok(null), { readFile: async () => new Uint8Array() })
    expect(await run(['upload', 'plan.html'], empty.io)).toBe(2)
    const missing = withKey(() => ok(null))
    expect(await run(['upload', 'nope.html'], missing.io)).toBe(2)
    const both = withKey(() => ok(null))
    expect(await run(['upload', 'plan.html', '--public', '--private'], both.io)).toBe(2)
    expect([big, empty, missing, both].every((h) => h.requests.length === 0)).toBe(true)
  })

  it('reads the HTML from stdin with -', async () => {
    const h = withKey(() => ok({ docket: SUMMARY, version: 1, versionUrl: `${SUMMARY.url}/v/1` }), {
      readStdin: async () => new TextEncoder().encode(PLAN)
    })
    expect(await run(['upload', '-'], h.io)).toBe(0)
    expect(JSON.parse(String((await h.requests[0].formData()).get('meta'))).fileName).toBeUndefined()
  })
})

describe('reading and changing dockets', () => {
  it('lists with the repository beside the title', async () => {
    const h = withKey(() => ok({ dockets: [SUMMARY] }))
    expect(await run(['list'], h.io)).toBe(0)
    const [header, row] = h.out().trim().split('\n')
    expect(header).toMatch(/^ID\s+VISIBILITY\s+VERSION\s+UPDATED\s+TITLE$/)
    expect(row).toMatch(new RegExp(`^${ID}\\s+private\\s+v2\\s+\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}\\s+Plan  \\[kharitonov-egor/ego\\]$`))
  })

  it('shows versions with short commits and sizes', async () => {
    const h = withKey(() => ok(DETAIL))
    expect(await run(['show', ID], h.io)).toBe(0)
    expect(h.out()).toContain('ID k3x9qa7m2p · private · 2 versions · kharitonov-egor/ego')
    expect(h.out()).toMatch(/v2\s+abcdef1\s+main\s+\S+ \S+\s+2\.0 KB/)
  })

  it('publishes, unpublishes, and edits with PATCH', async () => {
    const h = withKey(async (request) => ok({ ...DETAIL, ...(await request.json() as object) }))
    expect(await run(['publish', ID], h.io)).toBe(0)
    expect(await run(['unpublish', ID], h.io)).toBe(0)
    expect(await run(['edit', ID, '--title', 'New', '--description', 'Words'], h.io)).toBe(0)
    expect(await Promise.all(h.requests.map(async (request) => [request.method, await request.json()]))).toEqual([
      ['PATCH', { public: true }], ['PATCH', { public: false }], ['PATCH', { title: 'New', description: 'Words' }]
    ])
    expect(h.out()).toContain('"Plan" is public: anyone with the link can open it.')
    const nothing = withKey(() => ok(DETAIL))
    expect(await run(['edit', ID], nothing.io)).toBe(2)
  })

  it('pulls the HTML to stdout or a file, at the version in the link', async () => {
    const answer: Answer = () => new Response(PLAN, { headers: { 'x-docket-version': '1' } })
    const toStdout = withKey(answer)
    expect(await run(['pull', `${SUMMARY.url}/v/1`], toStdout.io)).toBe(0)
    expect(toStdout.requests[0].url).toBe(`${API}/v1/dockets/${ID}/html?version=1`)
    expect(toStdout.out()).toBe(PLAN)
    const toFile = withKey(answer)
    expect(await run(['pull', ID, '--output', 'copy.html'], toFile.io)).toBe(0)
    expect(new TextDecoder().decode(toFile.written.get('copy.html'))).toBe(PLAN)
    expect(toFile.out()).toBe(`Saved v1 of ${ID} to copy.html\n`)
  })

  it('opens a pinned version that exists and refuses one that does not', async () => {
    const h = withKey(() => ok(DETAIL))
    expect(await run(['open', ID, '--version', '1'], h.io)).toBe(0)
    expect(h.opened).toEqual([`${SUMMARY.url}/v/1`])
    const missing = withKey(() => ok(DETAIL))
    expect(await run(['open', ID, '--version', '7'], missing.io)).toBe(1)
    expect(missing.err()).toContain('no version 7')
  })

  it('deletes only with --yes when nobody can answer a prompt', async () => {
    const asked = withKey(() => ok(DETAIL))
    expect(await run(['delete', ID], asked.io)).toBe(2)
    expect(asked.err()).toContain('Pass --yes')
    expect(asked.requests.map((request) => request.method)).toEqual(['GET'])

    const sure = withKey((request) => ok(request.method === 'DELETE' ? { deleted: true } : DETAIL))
    expect(await run(['delete', ID, '--yes'], sure.io)).toBe(0)
    expect(sure.requests.map((request) => request.method)).toEqual(['GET', 'DELETE'])
    expect(sure.out()).toBe('Deleted "Plan" and its 2 versions.\n')

    const declined = withKey(() => ok(DETAIL), { stdinIsTty: true, confirm: async () => false })
    expect(await run(['delete', ID], declined.io)).toBe(0)
    expect(declined.out()).toBe('Kept it.\n')
  })
})

describe('errors', () => {
  it('turns a rejected key into the next step, and prints JSON errors with --json', async () => {
    const rejected = Response.json({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Connect this device again' } }, { status: 401 })
    const h = withKey(() => rejected.clone())
    expect(await run(['list'], h.io)).toBe(1)
    expect(h.err()).toContain('docket auth login')
    const json = withKey(() => rejected.clone())
    expect(await run(['list', '--json'], json.io)).toBe(1)
    expect(JSON.parse(json.out())).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  })

  it('says when the server cannot be reached', async () => {
    const h = withKey(() => {
      throw new TypeError('fetch failed')
    })
    expect(await run(['list'], h.io)).toBe(1)
    expect(h.err()).toContain(`Could not reach Ego at ${API}`)
  })
})

describe('auth', () => {
  it('checks a key, names it after the computer, saves it, reports it, and forgets it', async () => {
    let current = { id: 'key-1', name: 'CLI · 2026-10-07', createdAt: '2026-10-07T00:00:00.000Z', lastUsedAt: null }
    const h = harness(async (request) => {
      if (request.method === 'PATCH') current = { ...current, ...(await request.json() as { name: string }) }
      return ok(current)
    })
    expect(await run(['auth', 'login', '--key', KEY], h.io)).toBe(0)
    expect(h.requests.map((request) => [request.method, request.url])).toEqual([
      ['GET', `${API}/v1/docket-keys/current`], ['PATCH', `${API}/v1/docket-keys/current`]
    ])
    expect(h.requests[0].headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(await readFile(h.io.configPath, 'utf8'))).toEqual({ apiUrl: API, key: KEY, keyName: 'CLI · JARVIS' })

    expect(await run(['auth', 'status'], h.io)).toBe(0)
    expect(h.out()).toContain(`Signed in with "CLI · JARVIS" from ${h.io.configPath}.`)

    const named = harness(() => ok({ ...current, name: 'Work laptop' }))
    expect(await run(['auth', 'login', '--key', KEY], named.io)).toBe(0)
    expect(named.requests.map((request) => request.method)).toEqual(['GET'])

    expect(await run(['auth', 'logout'], h.io)).toBe(0)
    expect(await run(['auth', 'status'], h.io)).toBe(1)
    expect(h.err()).toContain('Not signed in')
  })

  it('reads a piped key and refuses anything that is not a docket key', async () => {
    const piped = harness(() => ok({ id: 'key-1', name: 'Piped', createdAt: '2026-10-07T00:00:00.000Z', lastUsedAt: null }), {
      readStdin: async () => new TextEncoder().encode(`${KEY}\n`)
    })
    expect(await run(['auth', 'login'], piped.io)).toBe(0)
    const wrong = harness(() => ok(null))
    expect(await run(['auth', 'login', '--key', 'device-token-of-some-sort'], wrong.io)).toBe(2)
    expect(wrong.requests).toHaveLength(0)
  })

  it('lets DOCKET_API_KEY win over a saved login', () => {
    const saved = { apiUrl: 'https://saved.example', key: 'egodk_saved', keyName: null }
    expect(resolveConnection({ DOCKET_API_KEY: 'egodk_env' }, saved)).toEqual({ apiUrl: 'https://saved.example', key: 'egodk_env', source: 'DOCKET_API_KEY' })
    expect(resolveConnection({}, saved)).toEqual({ apiUrl: 'https://saved.example', key: 'egodk_saved', source: 'config' })
    expect(resolveConnection({}, null)).toBeNull()
  })
})
