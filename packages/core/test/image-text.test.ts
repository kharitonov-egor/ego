import { describe, expect, it, vi } from 'vitest'
import { cleanImageText, readImageText, type ReadImageTextInput } from '../src'

const input: ReadImageTextInput = { base64: 'aGVsbG8=', mimeType: 'image/png', apiKey: 'or-key', model: 'test/model', effort: 'none' }

function answer(content: unknown, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })
}

describe('cleanImageText', () => {
  it('keeps line breaks and every script', () => {
    expect(cleanImageText('Привет, мир\n你好\r\nمرحبا\n')).toBe('Привет, мир\n你好\nمرحبا')
  })

  it('unwraps a code fence', () => {
    expect(cleanImageText('```text\nline one\nline two\n```')).toBe('line one\nline two')
  })

  it('turns the no-text marker into an empty string', () => {
    expect(cleanImageText(' [[NO TEXT]] ')).toBe('')
  })
})

describe('readImageText', () => {
  it('sends the image with the model and effort and returns the text', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body)) as {
        model: string
        reasoning: { effort: string }
        messages: Array<{ role: string; content: unknown }>
      }
      expect(sent.model).toBe('test/model')
      expect(sent.reasoning.effort).toBe('none')
      expect(JSON.stringify(sent.messages[1].content)).toContain('data:image/png;base64,aGVsbG8=')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer or-key')
      return answer('Total\t$4.20')
    })
    expect(await readImageText(input, fetcher)).toEqual({ ok: true, text: 'Total\t$4.20' })
  })

  it('refuses a type the models cannot read without calling out', async () => {
    const fetcher = vi.fn()
    expect(await readImageText({ ...input, mimeType: 'image/tiff' }, fetcher)).toMatchObject({ ok: false })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reports a rejected key', async () => {
    const result = await readImageText(input, async () => new Response(JSON.stringify({ error: { message: 'no' } }), { status: 401 }))
    expect(result).toEqual({ ok: false, message: 'OpenRouter rejected the Worker key.' })
  })

  it('treats a missing answer as a failure, not as an image without text', async () => {
    expect(await readImageText(input, async () => answer(null))).toMatchObject({ ok: false })
    expect(await readImageText(input, async () => answer('[[NO TEXT]]'))).toEqual({ ok: true, text: '' })
  })
})
