import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { DocketError } from './api.ts'

/**
 * Reads a pasted key without echoing it. Escape sequences are dropped, so a terminal that wraps
 * pastes in bracketed-paste markers still yields the bare key.
 */
export function promptHidden(question: string): Promise<string> {
  const input = process.stdin
  const output = process.stderr
  return new Promise((resolve, reject) => {
    let value = ''
    let escaping = false
    output.write(question)
    input.setRawMode(true)
    input.setEncoding('utf8')
    input.resume()
    const finish = (error: DocketError | null): void => {
      input.setRawMode(false)
      input.pause()
      input.removeListener('data', onData)
      output.write('\n')
      if (error) reject(error)
      else resolve(value.trim())
    }
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (escaping) {
          if (/[A-Za-z~]/.test(char)) escaping = false
        } else if (char === '\u001b') {
          escaping = true
        } else if (char === '\r' || char === '\n') {
          finish(null)
          return
        } else if (char === '\u0003') {
          finish(new DocketError('Cancelled', 'CANCELLED'))
          return
        } else if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1)
        } else if (char >= ' ') {
          value += char
        }
      }
    }
    input.on('data', onData)
  })
}

export async function confirm(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return /^y(es)?$/i.test((await prompt.question(`${question} [y/N] `)).trim())
  } finally {
    prompt.close()
  }
}

export async function readStdin(): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  return new Uint8Array(Buffer.concat(chunks))
}

/** Best effort: a headless machine has no browser, and the URL is printed anyway. */
export function openUrl(url: string): void {
  const [command, args] = process.platform === 'win32'
    ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => undefined)
    child.unref()
  } catch {
    // Nothing to open with.
  }
}
