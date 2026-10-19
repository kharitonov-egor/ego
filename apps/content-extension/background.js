const CACHE_PREFIX = 'canvasDarkSheet:'
const CACHE_INDEX = 'canvasDarkSheets'
const CACHE_DAYS = 45

async function fetchText(href) {
  const response = await fetch(href, { credentials: 'omit' })
  if (!response.ok) throw new Error(`${response.status} for ${href}`)
  return response.text()
}
async function getSheet(href) {
  const key = CACHE_PREFIX + href
  const stored = (await chrome.storage.local.get(key))[key]
  if (stored && typeof stored.css === 'string') return { cached: stored }
  return { text: await fetchText(href) }
}
async function putSheet(href, entry) {
  const index = (await chrome.storage.local.get(CACHE_INDEX))[CACHE_INDEX] || {}
  index[href] = Date.now()
  await chrome.storage.local.set({ [CACHE_PREFIX + href]: entry, [CACHE_INDEX]: index })
}
async function pruneCache() {
  const index = (await chrome.storage.local.get(CACHE_INDEX))[CACHE_INDEX] || {}
  const stale = Object.keys(index).filter(href => index[href] < Date.now() - CACHE_DAYS * 86400000)
  if (!stale.length) return
  for (const href of stale) delete index[href]
  await chrome.storage.local.remove(stale.map(href => CACHE_PREFIX + href))
  await chrome.storage.local.set({ [CACHE_INDEX]: index })
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'canvasDark') {
    chrome.storage.local.get('canvasDark').then(stored => sendResponse({ on: stored.canvasDark !== false }))
    return true
  }
  if (message?.type === 'getSheet' && typeof message.href === 'string') {
    getSheet(message.href).then(sendResponse).catch(error => sendResponse({ error: error.message || String(error) }))
    return true
  }
  if (message?.type === 'putSheet' && typeof message.href === 'string') {
    putSheet(message.href, message.entry).then(() => sendResponse({ ok: true })).catch(error => sendResponse({ error: error.message || String(error) }))
    return true
  }
  return false
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.canvasDark) return
  const on = changes.canvasDark.newValue !== false
  chrome.tabs.query({ url: 'https://*.instructure.com/*' }).then(tabs => {
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'canvasDarkChanged', on }).catch(() => undefined)
  })
})

chrome.runtime.onInstalled.addListener(() => pruneCache().catch(() => undefined))
chrome.runtime.onStartup.addListener(() => pruneCache().catch(() => undefined))
