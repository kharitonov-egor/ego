// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const root = resolve(import.meta.dirname, '../../../../../apps/content-extension')
const source = readFileSync(resolve(root, 'canvas-dark.js'), 'utf8')
const LIGHT = 'data-ego-canvas-light'

// A document only parses <style> elements when it has a window, so parsing and each booted page live in their own iframe.
function frameWindow() {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  return frame.contentWindow as Window & typeof globalThis
}
const parser = frameWindow()

class ParsedSheet {
  cssRules: CSSRuleList = [] as unknown as CSSRuleList
  replaceSync(text: string) {
    const style = parser.document.createElement('style')
    style.textContent = text
    parser.document.head.append(style)
    this.cssRules = style.sheet?.cssRules ?? ([] as unknown as CSSRuleList)
  }
}

type Boot = { on?: boolean; sheets?: Record<string, string>; sheetStore?: Map<string, { css: string; imports: string[] }>; framedHost?: string; head?: string; body?: string }

// The content script does all storage through the service worker, so the mock answers runtime messages instead of chrome.storage.
function boot(options: Boot = {}) {
  const win = frameWindow()
  const doc = win.document
  doc.head.innerHTML = options.head ?? ''
  doc.body.innerHTML = options.body ?? '<div id="application"></div>'
  const sheetStore = options.sheetStore ?? new Map<string, { css: string; imports: string[] }>()
  const messageListeners: Array<(message: { type: string; on?: boolean }) => void> = []
  const sendMessage = vi.fn(async (message: { type: string; href?: string; entry?: { css: string; imports: string[] } }) => {
    if (message.type === 'canvasDark') return { on: options.on !== false }
    if (message.type === 'getSheet') {
      const href = message.href as string
      if (sheetStore.has(href)) return { cached: sheetStore.get(href) }
      if (options.sheets?.[href] !== undefined) return { text: options.sheets[href] }
      return { error: `no sheet at ${href}` }
    }
    if (message.type === 'putSheet') { sheetStore.set(message.href as string, message.entry as { css: string; imports: string[] }); return { ok: true } }
    return {}
  })
  const chrome = { runtime: { sendMessage, onMessage: { addListener: (listener: (typeof messageListeners)[number]) => messageListeners.push(listener) } } }
  const top: { top?: unknown } = {}
  top.top = top
  const context = createContext({
    document: doc, window: options.framedHost ? { top: { location: { host: options.framedHost } } } : top, location: { host: 'usflearn.instructure.com' },
    chrome, console, performance, URL, CSSRule: win.CSSRule, CSSStyleSheet: ParsedSheet, HTMLLinkElement: win.HTMLLinkElement, Node: win.Node, MutationObserver: win.MutationObserver,
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0), setInterval: () => 0
  })
  runInContext(source, context)
  const flush = () => new Promise(resolve => setTimeout(resolve, 20))
  const overrides = () => [...doc.querySelectorAll('style[data-ego-canvas-dark]')].map(style => style.textContent).join('\n')
  const loaded = async () => { doc.dispatchEvent(new win.Event('DOMContentLoaded')); await flush() }
  return { doc, sheetStore, sendMessage, flush, overrides, loaded, light: () => doc.documentElement.hasAttribute(LIGHT), change: (on: boolean) => { for (const listener of messageListeners) listener({ type: 'canvasDarkChanged', on }) } }
}

describe('Canvas dark mode content script', () => {
  it('rewrites light backgrounds, dark text, and pale borders but keeps brand colors', async () => {
    const page = boot()
    const style = page.doc.createElement('style')
    style.textContent = '.card{background-color:#ffffff;color:#273540;border-top-color:#e8eaec}.button{background-color:#006747;color:#ffffff}.banner{background-color:#9ccb3b;color:#000000}'
    page.doc.head.append(style)
    await page.flush()
    const css = page.overrides()
    expect(css).toMatch(/\.card\{background-color:hsl\(0, 0%, 10%\) !important;color:hsl\(\d+, [\d.]+%, (7\d|8\d)[\d.]*%\) !important;border-top-color:hsl\(\d+, [\d.]+%, (1\d|2\d)[\d.]*%\) !important\}/)
    expect(css).not.toContain('.button')
    expect(css).not.toContain('.banner')
    expect(page.light()).toBe(false)
  })

  it('follows the stored toggle and reacts when it changes', async () => {
    const page = boot({ on: false })
    await page.flush()
    expect(page.light()).toBe(true)
    const style = page.doc.createElement('style')
    style.textContent = 'body{background-color:#ffffff}'
    page.doc.head.append(style)
    await page.flush()
    const injected = page.doc.querySelector('style[data-ego-canvas-dark]') as HTMLStyleElement
    expect(injected.disabled).toBe(true)
    page.change(true)
    expect(page.light()).toBe(false)
    expect(injected.disabled).toBe(false)
  })

  it('maps linked stylesheets through the service worker, follows live imports, and reuses the cache', async () => {
    const sheets = {
      'https://cdn.example/common.css': 'body{background-color:#ffffff}\n@import url("https://cdn.example/theme.css");\n/* @import url(https://cdn.example/skipped.css); */',
      'https://cdn.example/theme.css': '.panel{color:#273540}'
    }
    const sheetStore = new Map<string, { css: string; imports: string[] }>()
    const first = boot({ sheets, sheetStore, head: '<link rel="stylesheet" href="https://cdn.example/common.css">' })
    await first.flush()
    const getCalls = first.sendMessage.mock.calls.map(([message]) => message).filter(message => message.type === 'getSheet').map(message => message.href)
    expect(getCalls).toEqual(['https://cdn.example/common.css', 'https://cdn.example/theme.css'])
    expect(first.overrides()).toContain('body{background-color:hsl(0, 0%, 10%) !important}')
    expect(first.overrides()).toMatch(/\.panel\{color:hsl/)
    expect(sheetStore.get('https://cdn.example/common.css')?.imports).toEqual(['https://cdn.example/theme.css'])

    const second = boot({ sheets, sheetStore, head: '<link rel="stylesheet" href="https://cdn.example/common.css">' })
    await second.flush()
    const secondPuts = second.sendMessage.mock.calls.map(([message]) => message).filter(message => message.type === 'putSheet')
    expect(secondPuts).toHaveLength(0)
    expect(second.overrides()).toContain('body{background-color:hsl(0, 0%, 10%) !important}')
  })

  it('locks out Dark Reader while active and releases it when switched off or off-Canvas', async () => {
    const page = boot()
    await page.flush()
    const lock = () => page.doc.querySelector('meta[name="darkreader-lock"]')
    expect(lock()).not.toBeNull()
    page.change(false)
    expect(lock()).toBeNull()
    page.change(true)
    expect(lock()).not.toBeNull()
    const off = boot({ body: '<main>Marketing</main>' })
    await off.loaded()
    expect(off.doc.querySelector('meta[name="darkreader-lock"]')).toBeNull()
  })

  it('stays light inside frames from other hosts and on pages that are not Canvas', async () => {
    const framed = boot({ framedHost: 'usf.quiz-lti-iad-prod.instructure.com' })
    expect(framed.light()).toBe(true)
    const other = boot({ body: '<main>Marketing</main>' })
    expect(other.light()).toBe(false)
    await other.loaded()
    expect(other.light()).toBe(true)
  })

  it('rewrites inline styles and bgcolor attributes but keeps text on colored backgrounds', async () => {
    const page = boot({ body: '<div id="application"><p id="plain" style="background-color:#ffffff;color:#273540">a</p><div id="legacy" bgcolor="#ffffff">b</div><span id="colored" style="background-color:#9ccb3b;color:#000000">c</span></div>' })
    await page.loaded()
    const plain = page.doc.getElementById('plain') as HTMLElement
    expect(plain.style.getPropertyValue('background-color')).toMatch(/hsl\(0, 0%, 10%\)|rgb\(26, 26, 26\)/)
    expect(plain.style.getPropertyValue('color')).not.toBe('#273540')
    expect(page.doc.getElementById('legacy')?.getAttribute('style')).toMatch(/background-color/)
    const colored = page.doc.getElementById('colored') as HTMLElement
    expect(colored.style.getPropertyValue('color')).toMatch(/#000000|rgb\(0, 0, 0\)/)
    expect(colored.style.getPropertyValue('background-color')).toMatch(/#9ccb3b|rgb\(156, 203, 59\)/)
  })
})
