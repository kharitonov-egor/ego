const API = 'https://ego-money.ega-khar.workers.dev'
const KIND_ICONS = { link: '#i-link', article: '#i-file', video: '#i-play', image: '#i-image', document: '#i-file' }
const $ = id => document.getElementById(id)
let key = ''
let item = null
let favorite = false
let submission = null
let library = null

function show(view) {
  for (const id of ['capture', 'connect', 'done', 'blocked']) $(id).hidden = id !== view
  status('')
}
function status(message, tone = '') {
  const target = $('connect').hidden ? $('status') : $('connect-status')
  target.textContent = message
  target.dataset.tone = tone
}
function webUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null } catch { return null }
}
async function api(path, options = {}) {
  const response = await fetch(API + '/v1/content/' + path, {
    ...options, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(20000)
  })
  const result = await response.json().catch(() => null)
  if (response.ok && result?.ok) return result.data
  const error = new Error(result?.error?.message || `Ego answered ${response.status}. Try again.`)
  error.code = result?.error?.code
  throw error
}
function settings(rejected = false) {
  show('connect')
  $('back').hidden = !item
  $('connected').hidden = !key || rejected
  $('key').value = ''
}
function setFavorite(value) {
  favorite = value
  $('favorite').setAttribute('aria-pressed', String(favorite))
}
function setKind(kind) {
  $('kind').value = kind
  $('cover-icon').setAttribute('href', KIND_ICONS[kind] || '#i-link')
  $('video').hidden = kind !== 'video'
}
function pageMetadata() {
  const meta = (name) => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute('content') || ''
  const absolute = (value) => { try { return value ? new URL(value, location.href).href : null } catch { return null } }
  const type = meta('og:type')
  const video = type.startsWith('video') || /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)vimeo\.com$/.test(location.hostname)
  return {
    title: (meta('og:title') || document.title).slice(0, 500),
    description: (meta('og:description') || meta('description')).slice(0, 4000),
    coverUrl: absolute(meta('og:image') || meta('twitter:image')) || (document.contentType.startsWith('image/') ? location.href : null),
    kind: video ? 'video' : type === 'article' ? 'article' : document.contentType.startsWith('image/') ? 'image' : /\.pdf$/i.test(location.pathname) ? 'document' : 'link'
  }
}
function kindFromUrl(url) {
  const path = new URL(url).pathname
  return /\.pdf$/i.test(path) ? 'document' : /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(path) ? 'image' : 'link'
}
async function loadPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = webUrl(tab?.url)
  if (!url) return false
  let metadata = { title: tab.title || url, description: '', coverUrl: null, kind: kindFromUrl(url) }
  $('title').value = metadata.title; $('url').value = url
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageMetadata })
    if (results[0]?.result) metadata = results[0].result
  } catch { /* Restricted viewers still allow saving the tab URL and title. */ }
  item = { ...metadata, url, coverUrl: webUrl(metadata.coverUrl), notes: '', tags: [], collectionId: null, favorite: false, trashedAt: null }
  $('title').value = item.title; $('description').value = item.description
  setKind(item.kind)
  if (item.coverUrl) {
    $('cover').referrerPolicy = 'no-referrer'
    $('cover').onerror = () => { $('cover').hidden = true; $('cover-fallback').hidden = false }
    $('cover').src = item.coverUrl; $('cover').hidden = false; $('cover-fallback').hidden = true
  }
  return true
}
function currentTags() {
  return [...new Set($('tags').value.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean))]
}
function suggestTags() {
  const known = library ? [...new Set(library.contentItems.filter(saved => !saved.trashedAt).flatMap(saved => saved.tags))].sort() : []
  const parts = $('tags').value.split(',')
  const typing = parts[parts.length - 1].trim().toLowerCase()
  const chosen = new Set(parts.slice(0, -1).map(tag => tag.trim().toLowerCase()))
  const matches = known.filter(tag => !chosen.has(tag) && tag !== typing && tag.startsWith(typing)).slice(0, 8)
  $('tag-options').replaceChildren(...matches.map(tag => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = '#' + tag
    button.onclick = () => {
      $('tags').value = [...parts.slice(0, -1).map(part => part.trim()).filter(Boolean), tag].join(', ') + ', '
      $('tags').focus()
      suggestTags()
    }
    return button
  }))
  $('tag-options').hidden = matches.length === 0
}
async function loadLibrary() {
  library = await api('library')
  $('collection').replaceChildren(new Option('Unsorted', ''))
  for (const collection of library.contentCollections) $('collection').add(new Option(collection.name, collection.id))
  suggestTags()
}
function ready() {
  $('save').disabled = false
  if (submission?.item.url === item.url) {
    const pending = submission.item
    $('title').value = pending.title; $('description').value = pending.description; $('notes').value = pending.notes
    $('tags').value = pending.tags.join(', '); $('collection').value = pending.collectionId || ''
    setFavorite(pending.favorite); setKind(pending.kind)
    item = pending
    status('A previous save was interrupted. Press Save bookmark to retry it.', 'notice')
    return
  }
  if (library?.contentItems.some(saved => !saved.trashedAt && saved.url === item.url)) {
    status('Already saved. Saving again adds a second bookmark.', 'notice')
  }
}
async function openCapture() {
  show('capture')
  if (!item && !await loadPage()) return show('blocked')
  if (!library) try { await loadLibrary() } catch (error) {
    if (error.code === 'AUTH_REQUIRED') { settings(true); return status(error.message || 'Reconnect to Ego.', 'error') }
    ready()
    return status(`${error.message || 'Could not load your collections.'} You can still save to Unsorted.`, 'error')
  }
  ready()
}
function finish(draft) {
  show('done')
  $('done-title').textContent = draft.title
  const collection = library?.contentCollections.find(saved => saved.id === draft.collectionId)?.name ?? 'Unsorted'
  $('done-detail').textContent = `In ${collection}. It shows up in Content on your other devices after they sync.`
  $('done-close').focus()
}

$('settings').onclick = () => settings()
$('back').onclick = () => { show('capture'); if (library) ready() }
$('favorite').onclick = () => setFavorite(!favorite)
$('kind').onchange = () => setKind($('kind').value)
$('tags').oninput = suggestTags
$('tags').onfocus = suggestTags
$('title').onkeydown = event => { if (event.key === 'Enter') event.preventDefault() }
$('capture').onkeydown = event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !$('save').disabled) $('capture').requestSubmit() }
$('done-close').onclick = () => window.close()
$('key').onkeydown = event => { if (event.key === 'Enter') $('connect-button').click() }
$('disconnect').onclick = async () => {
  await chrome.storage.local.remove('contentKey')
  key = ''; library = null
  settings()
  status('Disconnected. Revoke the key in Ego to stop it working anywhere else.')
}
$('connect-button').onclick = async () => {
  const pasted = $('key').value.trim()
  if (!/^egoct_[a-f0-9]{64}$/.test(pasted)) return status('Paste the extension key from Ego Content. It starts with egoct_.', 'error')
  const previous = key
  key = pasted
  $('connect-button').disabled = true; $('connect-button').textContent = 'Connecting...'
  try {
    await loadLibrary()
    await chrome.storage.local.set({ contentKey: key })
    await openCapture()
  } catch (error) {
    key = previous
    status(error.message || 'Could not connect.', 'error')
  } finally { $('connect-button').disabled = false; $('connect-button').textContent = 'Connect' }
}
$('capture').onsubmit = async event => {
  event.preventDefault()
  const url = webUrl($('url').value)
  const title = $('title').value.replace(/\s+/g, ' ').trim()
  const tags = currentTags()
  if (!url) return status('Enter a valid http or https URL.', 'error')
  if (!title) return status('Give the bookmark a title.', 'error')
  if (tags.length > 30 || tags.some(tag => tag.length > 80)) return status('Use up to 30 tags of 80 characters each.', 'error')
  const draft = { ...item, url, title, description: $('description').value, notes: $('notes').value, collectionId: $('collection').value || null, kind: $('kind').value, tags, favorite }
  const serialized = JSON.stringify(draft)
  if (!submission || submission.serialized !== serialized) submission = { id: crypto.randomUUID(), serialized, item: draft }
  $('save').disabled = true; $('save').textContent = 'Saving...'; status('')
  try {
    await chrome.storage.session.set({ pendingCapture: submission })
    await api('capture', { method: 'POST', body: JSON.stringify({ id: submission.id, item: submission.item }) })
    await chrome.storage.session.remove('pendingCapture').catch(() => undefined)
    submission = null
    finish(draft)
  } catch (error) {
    if (error.code === 'AUTH_REQUIRED') { settings(true); return status(error.message || 'Reconnect to Ego.', 'error') }
    status(error.message || 'Save failed. Try again.', 'error')
  } finally { $('save').disabled = false; $('save').textContent = 'Save bookmark' }
}
async function start() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  const stored = await chrome.storage.local.get('contentKey')
  key = stored.contentKey || ''
  const pending = await chrome.storage.session.get('pendingCapture')
  submission = pending.pendingCapture || null
  if (!key) return settings()
  await openCapture()
}
start().catch(error => { show('capture'); status(error.message || 'Could not load this page.', 'error') })
