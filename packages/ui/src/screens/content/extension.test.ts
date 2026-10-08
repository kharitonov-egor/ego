// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const root = resolve(import.meta.dirname, '../../../../../apps/content-extension')
const source = readFileSync(resolve(root, 'popup.js'), 'utf8').replace(/start\(\)\.catch[\s\S]*$/, '')
afterEach(() => { document.body.innerHTML = '' })

function setup(options: { failOnce?: boolean; restricted?: boolean; pageUrl?: string } = {}) {
  document.body.innerHTML = readFileSync(resolve(root, 'popup.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '')
  let attempts = 0
  const captureBodies: Array<{ id: string; item: { title: string; notes: string; coverUrl: string | null; tags: string[] } }> = []
  const session: Record<string, unknown> = {}
  const chrome = {
    storage: {
      local: { setAccessLevel: vi.fn(async () => {}), get: vi.fn(async () => ({ contentKey: 'egoct_' + 'a'.repeat(64) })), set: vi.fn(async () => {}) },
      session: { get: vi.fn(async () => session), set: vi.fn(async (value: Record<string, unknown>) => Object.assign(session, value)), remove: vi.fn(async (key: string) => { delete session[key] }) }
    },
    tabs: { query: vi.fn(async () => [{ id: 7, url: options.pageUrl ?? 'https://example.com/article', title: 'Fallback title' }]) },
    scripting: { executeScript: vi.fn(async () => {
      if (options.restricted) throw new Error('Restricted')
      return [{ result: { title: '<b>Page title</b>', description: 'Description', coverUrl: 'javascript:void(0)', kind: 'article' } }]
    }) }
  }
  const fetch = vi.fn(async (url: string, init: { body?: string }) => {
    if (url.endsWith('/capture')) {
      captureBodies.push(JSON.parse(init.body ?? '{}'))
      if (options.failOnce && attempts++ === 0) throw new Error('Network interrupted')
      return { ok: true, json: async () => ({ ok: true, data: { id: 'saved' } }) }
    }
    return { ok: true, json: async () => ({ ok: true, data: { contentItems: [], contentCollections: [{ id: 'reading', name: 'Reading' }] } }) }
  })
  const context = createContext({ document, URL, Option: window.Option, AbortSignal, crypto: { randomUUID: () => 'capture-test-' + Math.random().toString(16).slice(2) }, chrome, fetch })
  runInContext(source, context)
  const start = () => runInContext('start()', context) as Promise<void>
  const save = () => runInContext("$('capture').onsubmit({ preventDefault() {} })", context) as Promise<void>
  return { start, save, chrome, captureBodies }
}

describe('Chrome popup', () => {
  it('captures metadata as text, drops executable cover URLs, and retries the same operation', async () => {
    const popup = setup({ failOnce: true }); await popup.start()
    expect((document.getElementById('title') as HTMLInputElement).value).toBe('<b>Page title</b>')
    expect(document.querySelector('b')).toBeNull()
    ;(document.getElementById('notes') as HTMLTextAreaElement).value = 'Read later'
    ;(document.getElementById('tags') as HTMLInputElement).value = 'Read, read'
    await popup.save()
    expect(document.getElementById('status')?.textContent).toBe('Network interrupted')
    await popup.save()
    expect(popup.captureBodies).toHaveLength(2)
    expect(popup.captureBodies[0].id).toBe(popup.captureBodies[1].id)
    expect(popup.captureBodies[1].item).toMatchObject({ coverUrl: null, notes: 'Read later', tags: ['read'] })
    expect(document.getElementById('heading')?.textContent).toBe('Saved to Ego')
  })
  it('still saves a URL when Chrome refuses access to the page DOM', async () => {
    const popup = setup({ restricted: true }); await popup.start(); await popup.save()
    expect(popup.captureBodies[0].item.title).toBe('Fallback title')
  })
  it('does not capture internal browser pages', async () => {
    const popup = setup({ pageUrl: 'chrome://extensions/' })
    await expect(popup.start()).rejects.toThrow('Open an http or https page')
    expect(popup.chrome.scripting.executeScript).not.toHaveBeenCalled()
  })
})
