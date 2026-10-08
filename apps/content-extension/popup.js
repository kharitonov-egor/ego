const API = 'https://ego-money.ega-khar.workers.dev'
const $ = id => document.getElementById(id)
let key = ''
let item = null
let favorite = false
let submission = null
let library = null
const status = message => { $('status').textContent = message }
function webUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null } catch { return null }
}
async function api(path, options = {}) {
  const response = await fetch(API + '/v1/content/' + path, {
    ...options, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(20000)
  })
  const result = await response.json()
  if (!response.ok || !result.ok) throw new Error(result.error?.message || 'Could not reach Ego. Try again.')
  return result.data
}
function settings() {
  $('capture').hidden = true; $('connect').hidden = false; $('heading').textContent = 'Content'
  $('back').hidden = !item || !library
  status('')
}
function pageMetadata() {
  const meta = (name) => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute('content') || ''
  const absolute = (value) => { try { return value ? new URL(value, location.href).href : null } catch { return null } }
  const type = meta('og:type')
  return {
    title: (meta('og:title') || document.title).slice(0, 500),
    description: (meta('og:description') || meta('description')).slice(0, 4000),
    coverUrl: absolute(meta('og:image') || meta('twitter:image')),
    kind: type.startsWith('video') || /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)vimeo\.com$/.test(location.hostname) ? 'video' : type === 'article' ? 'article' : /\.pdf$/i.test(location.pathname) ? 'document' : 'link'
  }
}
async function loadPage() {
  status('Loading page...')
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = webUrl(tab?.url)
  if (!url) throw new Error('Open an http or https page, then press the Ego button again.')
  let metadata = { title: tab.title || url, description: '', coverUrl: null, kind: /\.pdf(?:$|\?)/i.test(url) ? 'document' : 'link' }
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageMetadata })
    if (results[0]?.result) metadata = results[0].result
  } catch { /* Restricted viewers still allow saving the tab URL and title. */ }
  item = { ...metadata, url, coverUrl: webUrl(metadata.coverUrl), notes: '', tags: [], collectionId: null, favorite: false, trashedAt: null }
  $('title').value = item.title; $('url').value = item.url; $('description').value = item.description
  $('kind').textContent = item.kind[0].toUpperCase() + item.kind.slice(1)
  if (item.coverUrl) {
    $('cover').referrerPolicy = 'no-referrer'; $('cover').src = item.coverUrl; $('cover').hidden = false; $('cover-fallback').hidden = true
    $('cover').onerror = () => { $('cover').hidden = true; $('cover-fallback').hidden = false }
  }
  status('')
}
async function loadLibrary() {
  library = await api('library')
  $('collection').replaceChildren(new Option('Unsorted', ''))
  for (const collection of library.contentCollections) $('collection').add(new Option(collection.name, collection.id))
  $('tag-options').replaceChildren(...[...new Set(library.contentItems.flatMap(saved => saved.tags))].sort().map(tag => new Option(tag, tag)))
}
function ready() {
  const exists = library.contentItems.some(saved => !saved.trashedAt && saved.url === item.url)
  $('save').disabled = false
  if (submission?.item.url === item.url) {
    const pending = submission.item
    $('title').value = pending.title; $('description').value = pending.description; $('notes').value = pending.notes
    $('tags').value = pending.tags.join(', '); $('collection').value = pending.collectionId || ''
    favorite = pending.favorite
    $('favorite').setAttribute('aria-pressed', String(favorite))
    $('favorite').textContent = favorite ? '\u2665' : '\u2661'
    item = pending
    status('A previous save was interrupted. Press Save to retry it.')
    return
  }
  if (exists) status('Already in your library. Saving again creates another bookmark.')
}
$('settings').onclick = settings
$('back').onclick = () => { $('connect').hidden = true; $('capture').hidden = false; $('heading').textContent = 'New bookmark'; status('') }
$('favorite').onclick = () => { favorite = !favorite; $('favorite').setAttribute('aria-pressed', String(favorite)); $('favorite').textContent = favorite ? '\u2665' : '\u2661' }
$('connect-button').onclick = async () => {
  key = $('key').value.trim()
  if (!/^egoct_[a-f0-9]{64}$/.test(key)) return status('Paste the extension key from Ego Content.')
  $('connect-button').disabled = true
  try {
    await loadLibrary()
    await chrome.storage.local.set({ contentKey: key })
    $('key').value = ''; $('connect').hidden = true; $('capture').hidden = false; $('heading').textContent = 'New bookmark'
    if (!item) await loadPage()
    ready()
  } catch (error) { status(error.message || 'Could not connect.') }
  finally { $('connect-button').disabled = false }
}
$('capture').onsubmit = async event => {
  event.preventDefault()
  const url = webUrl($('url').value)
  const tags = [...new Set($('tags').value.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean))]
  if (!url || !$('title').value.trim() || tags.length > 30 || tags.some(tag => tag.length > 80)) return status('Enter a title, a valid URL, and up to 30 tags of 80 characters each.')
  const draft = { ...item, url, title: $('title').value.trim(), description: $('description').value, notes: $('notes').value, collectionId: $('collection').value || null, tags, favorite }
  const serialized = JSON.stringify(draft)
  if (!submission || submission.serialized !== serialized) submission = { id: crypto.randomUUID(), serialized, item: draft }
  $('save').disabled = true; $('save').textContent = 'Saving...'; status('')
  try {
    await chrome.storage.session.set({ pendingCapture: submission })
    await api('capture', { method: 'POST', body: JSON.stringify({ id: submission.id, item: submission.item }) })
    await chrome.storage.session.remove('pendingCapture').catch(() => undefined)
    $('heading').textContent = 'Saved to Ego'; $('save').textContent = 'Saved'; status('Your bookmark is saved. Open Content on any device and sync to see it.')
    for (const field of $('capture').querySelectorAll('input,textarea,select,button')) field.disabled = true
  } catch (error) { status(error.message || 'Save failed. Try again.'); $('save').disabled = false; $('save').textContent = 'Retry save' }
}
async function start() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  const stored = await chrome.storage.local.get('contentKey')
  key = stored.contentKey || ''
  const pending = await chrome.storage.session.get('pendingCapture')
  submission = pending.pendingCapture || null
  if (!key) return settings()
  await loadPage()
  try { await loadLibrary(); ready() } catch (error) { settings(); status(error.message || 'Reconnect to Ego.') }
}
start().catch(error => status(error.message || 'Could not load this page.'))
