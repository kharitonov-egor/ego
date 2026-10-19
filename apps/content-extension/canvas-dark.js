const LIGHT = 'data-ego-canvas-light'
const MAX_SHEET_BYTES = 3000000
const COLOR_PROPS = {
  'background-color': 'background', 'color': 'text', 'fill': 'text', 'stroke': 'text', 'caret-color': 'text', '-webkit-text-fill-color': 'text', 'text-decoration-color': 'text',
  'border-top-color': 'border', 'border-right-color': 'border', 'border-bottom-color': 'border', 'border-left-color': 'border', 'outline-color': 'border', 'column-rule-color': 'border'
}
const state = { wanted: true, allowed: !framedByAnotherHost(), styles: [], cursors: new WeakMap(), fetched: new Set(), added: new Set() }
const probe = document.createElement('span')

function framedByAnotherHost() {
  if (window === window.top) return false
  try { return window.top.location.host !== location.host } catch { return true }
}
function looksLikeCanvas() {
  return Boolean(document.querySelector('#application, #content, .ic-Login, .mce-content-body'))
}
function syncDarkReaderLock(on) {
  const existing = document.querySelector('meta[name="darkreader-lock"]')
  if (on && !existing) {
    const meta = document.createElement('meta')
    meta.name = 'darkreader-lock'
    meta.dataset.ego = ''
    ;(document.head || document.documentElement).append(meta)
  } else if (!on && existing && 'ego' in existing.dataset) {
    existing.remove()
  }
}
function render() {
  const on = state.wanted && state.allowed
  document.documentElement.toggleAttribute(LIGHT, !on)
  for (const style of state.styles) style.disabled = !on
  syncDarkReaderLock(on)
}

function parseColor(text) {
  if (!text || /var\(|currentcolor|inherit|initial|unset|transparent/i.test(text)) return null
  probe.style.color = ''
  probe.style.color = text
  const match = probe.style.color.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/)
  if (!match) return null
  const [r, g, b] = [+match[1] / 255, +match[2] / 255, +match[3] / 255]
  const a = match[4] === undefined ? 1 : +match[4]
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h *= 60
  }
  return { h, s, l, a }
}
function hsla({ h, s, l, a }) {
  const round = (value) => Math.round(value * 1000) / 1000
  return a >= 1 ? `hsl(${Math.round(h)}, ${round(s * 100)}%, ${round(l * 100)}%)` : `hsla(${Math.round(h)}, ${round(s * 100)}%, ${round(l * 100)}%, ${round(a)})`
}
function mapBackground(c) {
  if (c.a < 0.05) return null
  if (c.l < 0.45 && c.s < 0.4) return null
  if (c.s >= 0.35 && c.l <= 0.65) return null
  return { h: c.h, s: c.s > 0.05 ? Math.min(c.s, 0.22) : 0, l: c.l >= 0.995 ? 0.1 : 0.1 + (1 - c.l) * 0.5, a: c.a }
}
function mapText(c) {
  if (c.a < 0.05 || c.l >= 0.6) return null
  if (c.s >= 0.3) return { h: c.h, s: Math.max(c.s, 0.55), l: Math.max(c.l, 0.7), a: c.a }
  return { h: c.h, s: Math.min(c.s, 0.1), l: Math.min(0.9, Math.max(0.6, 0.9 - c.l * 0.5)), a: c.a }
}
function mapBorder(c) {
  if (c.a < 0.05 || c.l <= 0.55 || c.s >= 0.35) return null
  return { h: c.h, s: Math.min(c.s, 0.15), l: 0.16 + (1 - c.l) * 0.5, a: c.a }
}
const MAPPERS = { background: mapBackground, text: mapText, border: mapBorder }
function keepsColoredBackground(style) {
  const background = parseColor(style.getPropertyValue('background-color'))
  return Boolean(background) && background.a >= 0.5 && background.s >= 0.35 && background.l > 0.3 && !mapBackground(background)
}
function mapValue(property, value, skipText = false) {
  const role = COLOR_PROPS[property]
  if (!role || (skipText && role === 'text')) return null
  const parsed = parseColor(value)
  const mapped = parsed && MAPPERS[role](parsed)
  return mapped ? hsla(mapped) : null
}

function rewriteRules(rules, out, wrap = []) {
  for (const rule of rules) {
    if (rule.type === CSSRule.STYLE_RULE) {
      const declarations = []
      const skipText = keepsColoredBackground(rule.style)
      for (let i = 0; i < rule.style.length; i++) {
        const property = rule.style[i]
        const mapped = mapValue(property, rule.style.getPropertyValue(property), skipText)
        if (mapped) declarations.push(`${property}:${mapped} !important`)
      }
      if (declarations.length) out.push(...wrap.map(w => w + '{'), `${rule.selectorText}{${declarations.join(';')}}`, ...wrap.map(() => '}'))
    } else if (rule.type === CSSRule.MEDIA_RULE || rule.type === CSSRule.SUPPORTS_RULE) {
      rewriteRules(rule.cssRules, out, [...wrap, (rule.type === CSSRule.MEDIA_RULE ? '@media ' : '@supports ') + rule.conditionText])
    }
  }
}
function inject(text, key) {
  const style = document.createElement('style')
  style.dataset.egoCanvasDark = key
  style.textContent = text
  state.styles.push(style)
  ;(document.head || document.documentElement).append(style)
  style.disabled = !(state.wanted && state.allowed)
}

function scanInlineSheets() {
  const out = []
  for (const sheet of document.styleSheets) {
    const node = sheet.ownerNode
    if (!node || node.tagName !== 'STYLE' || node.dataset.egoCanvasDark) continue
    let rules
    try { rules = sheet.cssRules } catch { continue }
    const cursor = state.cursors.get(sheet) || 0
    if (rules.length <= cursor) continue
    state.cursors.set(sheet, rules.length)
    rewriteRules([...rules].slice(cursor), out)
  }
  if (out.length) inject(out.join('\n'), 'inline')
}

function importedSheets(text, base) {
  const hrefs = []
  for (const match of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@import\s+(?:url\(\s*)?["']?([^"'()\s;]+)/g)) {
    try { hrefs.push(new URL(match[1], base).href) } catch { /* skip a malformed import */ }
  }
  return hrefs
}
async function cachedOverrides(href) {
  const reply = await chrome.runtime.sendMessage({ type: 'getSheet', href })
  if (!reply || reply.error) throw new Error(reply?.error || 'No reply from the extension')
  if (reply.cached) return reply.cached
  if (typeof reply.text !== 'string') throw new Error(`No stylesheet for ${href}`)
  if (reply.text.length > MAX_SHEET_BYTES) throw new Error(`${href} is too large`)
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(reply.text)
  const out = []
  rewriteRules(sheet.cssRules, out)
  const entry = { css: out.join('\n'), imports: importedSheets(reply.text, href) }
  chrome.runtime.sendMessage({ type: 'putSheet', href, entry }).catch(() => undefined)
  return entry
}
function remoteSheet(href) {
  let url
  try { url = new URL(href) } catch { return }
  if (!/^https?:$/.test(url.protocol) || state.fetched.has(url.href)) return
  state.fetched.add(url.href)
  cachedOverrides(url.href).then(entry => {
    if (entry.css) inject(entry.css, url.href)
    for (const imported of entry.imports) remoteSheet(imported)
  }).catch(error => console.warn('Ego could not map', url.href, error))
}
function linkedSheet(link) {
  if (link instanceof HTMLLinkElement && /stylesheet/i.test(link.rel) && link.href) remoteSheet(link.href)
}

function mapInlineStyle(element) {
  const style = element.style
  if (!style) return
  if (element.hasAttribute('bgcolor') && !style.backgroundColor) style.backgroundColor = element.getAttribute('bgcolor')
  const skipText = keepsColoredBackground(style)
  for (let i = style.length - 1; i >= 0; i--) {
    const property = style[i]
    const value = style.getPropertyValue(property)
    const mapped = mapValue(property, value, skipText)
    if (mapped && mapped !== value) style.setProperty(property, mapped, style.getPropertyPriority(property))
  }
}
function scanInlineStyles(root) {
  if (root.hasAttribute?.('style') || root.hasAttribute?.('bgcolor')) mapInlineStyle(root)
  for (const element of root.querySelectorAll('[style*="color"], [style*="background"], [bgcolor]')) mapInlineStyle(element)
}

function scan() {
  const added = [...state.added]
  state.added.clear()
  scanInlineSheets()
  for (const node of added) if (node.isConnected) scanInlineStyles(node)
}
function schedule(node) {
  if (!state.added.size) requestAnimationFrame(scan)
  state.added.add(node)
}

render()
chrome.runtime.sendMessage({ type: 'canvasDark' }).then(reply => { state.wanted = reply?.on !== false; render() }).catch(() => undefined)
chrome.runtime.onMessage.addListener(message => {
  if (message?.type !== 'canvasDarkChanged') return
  state.wanted = message.on !== false
  render()
})
new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'attributes') { mapInlineStyle(record.target); continue }
    for (const node of record.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue
      linkedSheet(node)
      for (const link of node.querySelectorAll('link')) linkedSheet(link)
      schedule(node)
    }
  }
}).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'bgcolor'] })
for (const link of document.querySelectorAll('link')) linkedSheet(link)
document.addEventListener('DOMContentLoaded', () => {
  if (!looksLikeCanvas()) { state.allowed = false; render() }
  schedule(document.documentElement)
})
setInterval(() => { if (state.wanted && state.allowed) scanInlineSheets() }, 1500)
