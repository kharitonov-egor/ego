// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const root = resolve(import.meta.dirname, '../../../../../apps/content-extension')
const source = readFileSync(resolve(root, 'popup.js'), 'utf8').replace(/start\(\)\.catch[\s\S]*$/, '')
const KEY = 'egoct_' + 'a'.repeat(64)
const view = (id: string) => document.getElementById(id)?.hidden === false
afterEach(() => { document.body.innerHTML = '' })

function setup(options: { failOnce?: boolean; restricted?: boolean; pageUrl?: string; storedKey?: string; rejectKey?: boolean } = {}) {
  document.body.innerHTML = readFileSync(resolve(root, 'popup.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '')
  let attempts = 0
  const captureBodies: Array<{ id: string; item: { title: string; notes: string; coverUrl: string | null; tags: string[] } }> = []
  const session: Record<string, unknown> = {}
  const chrome = {
    storage: {
      local: { setAccessLevel: vi.fn(async () => {}), get: vi.fn(async () => ({ contentKey: options.storedKey ?? KEY })), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
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
    if (options.rejectKey) return { ok: false, status: 401, json: async () => ({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Reconnect the extension from Content settings' } }) }
    return { ok: true, json: async () => ({ ok: true, data: { contentItems: [{ url: 'https://example.com/other', tags: ['reading'], trashedAt: null }], contentCollections: [{ id: 'reading', name: 'Reading' }] } }) }
  })
  const context = createContext({ document, URL, Option: window.Option, AbortSignal, crypto: { randomUUID: () => 'capture-test-' + Math.random().toString(16).slice(2) }, chrome, fetch })
  runInContext(source, context)
  const start = () => runInContext('start()', context) as Promise<void>
  const save = () => runInContext("$('capture').onsubmit({ preventDefault() {} })", context) as Promise<void>
  const connect = () => runInContext("$('connect-button').onclick()", context) as Promise<void>
  return { start, save, connect, chrome, captureBodies }
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
    expect(view('done')).toBe(true)
    expect(document.getElementById('done-title')?.textContent).toBe('<b>Page title</b>')
    expect(document.getElementById('done-detail')?.textContent).toContain('In Unsorted')
  })
  it('still saves a URL when Chrome refuses access to the page DOM', async () => {
    const popup = setup({ restricted: true }); await popup.start(); await popup.save()
    expect(popup.captureBodies[0].item.title).toBe('Fallback title')
  })
  it('does not capture internal browser pages', async () => {
    const popup = setup({ pageUrl: 'chrome://extensions/' }); await popup.start()
    expect(view('blocked')).toBe(true)
    expect(popup.chrome.scripting.executeScript).not.toHaveBeenCalled()
  })
  it('sends a rejected key back to the connection screen', async () => {
    const popup = setup({ rejectKey: true }); await popup.start()
    expect(view('connect')).toBe(true)
    expect(document.getElementById('connect-status')?.textContent).toBe('Reconnect the extension from Content settings')
    expect(document.getElementById('back')?.hidden).toBe(false)
  })
  it('connects with a pasted key and suggests existing tags', async () => {
    const popup = setup({ storedKey: '' }); await popup.start()
    expect(view('connect')).toBe(true)
    ;(document.getElementById('key') as HTMLInputElement).value = ` ${KEY} `
    await popup.connect()
    expect(popup.chrome.storage.local.set).toHaveBeenCalledWith({ contentKey: KEY })
    expect(view('capture')).toBe(true)
    expect((document.getElementById('save') as HTMLButtonElement).disabled).toBe(false)
    expect([...document.querySelectorAll('#collection option')].map(option => option.textContent)).toEqual(['Unsorted', 'Reading'])
    expect(document.getElementById('tag-options')?.textContent).toBe('#reading')
  })
})
