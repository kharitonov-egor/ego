import React, { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Bookmark, Folder, Heart, Inbox, Trash2, Plus, Search, LayoutGrid, List, Link2, ExternalLink, Pencil, RotateCcw, Download, SlidersHorizontal, RefreshCw, Play, FileText, Image as ImageIcon, Menu } from 'lucide-react'
import type { ContentCollectionRecord, ContentItemRecord } from '@ego/api-contracts'
import { contentDomain, emptyContentItem, filterContent, type ContentItemInput, type ContentKind } from '@ego/core'
import { saveContent, saveCollection, deleteCollection } from '@ego/local/content/actions'
import { useContent } from '../../lib/content'
import { Blurred } from '../../lib/blur'
import { Sheet, ConfirmDialog } from '../../components/ui/dialog'
import { Button } from '../../components/ui/button'
import { cn } from '../../lib/utils'
import { ExtensionSettings } from './ExtensionSettings'
import './content.css'

const KINDS: ContentKind[] = ['link', 'article', 'video', 'image', 'document']
const ICONS = { link: Link2, article: FileText, video: Play, image: ImageIcon, document: FileText }

function Cover({ item }: { item: ContentItemInput }): React.ReactElement {
  const [failed, setFailed] = useState(false)
  const Icon = ICONS[item.kind]
  return <div className="content-cover">{item.coverUrl && !failed
    ? <img src={item.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <div className="content-cover-fallback"><Icon size={32} strokeWidth={1.3} /><span>{contentDomain(item.url)}</span></div>}
    {item.kind === 'video' && <span className="content-video"><Play size={14} fill="currentColor" /></span>}
  </div>
}

function Editor({ current, collections, onClose, onSave, busy }: {
  current: ContentItemRecord | null; collections: ContentCollectionRecord[]; onClose: () => void
  onSave: (input: ContentItemInput) => Promise<boolean>; busy: boolean
}): React.ReactElement {
  const [input, setInput] = useState<ContentItemInput>(current ?? emptyContentItem())
  const [tags, setTags] = useState(input.tags.join(', '))
  const [error, setError] = useState('')
  const patch = (values: Partial<ContentItemInput>): void => setInput(previous => ({ ...previous, ...values }))
  return <Sheet visible title={current ? 'Edit bookmark' : 'New bookmark'} onClose={onClose}>
    <form className="content-form" onSubmit={event => { event.preventDefault(); setError(''); void onSave({ ...input, tags: tags.split(',').map(tag => tag.trim()).filter(Boolean) }).then(saved => { if (!saved) setError('Could not save. Check the URL and field lengths, then try again.') }) }}>
      <label>Title<input autoFocus required maxLength={500} value={input.title} onChange={event => patch({ title: event.target.value })} placeholder="What are you saving?" /></label>
      <label>URL<input required type="url" maxLength={4096} value={input.url} onChange={event => patch({ url: event.target.value })} placeholder="https://" /></label>
      <label>Description<textarea maxLength={4000} rows={2} value={input.description} onChange={event => patch({ description: event.target.value })} /></label>
      <label>Note<textarea maxLength={20000} rows={4} value={input.notes} onChange={event => patch({ notes: event.target.value })} placeholder="What do you want to remember?" /></label>
      <label>Collection<select value={collections.some(collection => collection.id === input.collectionId) ? input.collectionId ?? '' : ''} onChange={event => patch({ collectionId: event.target.value || null })}>
        <option value="">Unsorted</option>{collections.map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
      </select></label>
      <label>Tags<input value={tags} onChange={event => setTags(event.target.value)} placeholder="Separate tags with commas" /></label>
      <div className="content-form-pair"><label>Type<select value={input.kind} onChange={event => patch({ kind: event.target.value as ContentKind })}>{KINDS.map(kind => <option key={kind}>{kind}</option>)}</select></label>
        <button type="button" className="content-favorite" aria-pressed={input.favorite} onClick={() => patch({ favorite: !input.favorite })}><Heart size={18} fill={input.favorite ? 'currentColor' : 'none'} /> Favorite</button></div>
      <label>Cover image URL<input type="url" maxLength={4096} value={input.coverUrl ?? ''} onChange={event => patch({ coverUrl: event.target.value || null })} placeholder="https://" /></label>
      {error && <p role="alert" className="text-sm text-surface-300">{error}</p>}
      <Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save bookmark'}</Button>
    </form>
  </Sheet>
}

export default function Content(): React.ReactElement {
  const { items, collections, ledger, error, loading } = useContent()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState('')
  const [kind, setKind] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [sort, setSort] = useState('newest')
  const [navigation, setNavigation] = useState(false)
  const [editor, setEditor] = useState<{ item: ContentItemRecord | null } | null>(null)
  const [collectionEditor, setCollectionEditor] = useState<{ current: ContentCollectionRecord | null; name: string } | null>(null)
  const [removing, setRemoving] = useState<ContentCollectionRecord | null>(null)
  const [settings, setSettings] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const liveItems = items.filter(item => !item.trashedAt)
  const tags = [...new Set(liveItems.flatMap(item => item.tags))].sort()
  const shown = useMemo(() => filterContent(items, collections, filter, search, tag, kind).sort((a, b) =>
    sort === 'title' ? a.title.localeCompare(b.title) : sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)),
  [items, collections, filter, search, tag, kind, sort])
  const currentCollection = collections.find(collection => collection.id === filter)
  const title = currentCollection?.name ?? ({ all: 'All bookmarks', unsorted: 'Unsorted', favorites: 'Favorites', trash: 'Trash' }[filter] ?? 'All bookmarks')
  const choose = (next: string): void => { setFilter(next); setNavigation(false) }
  const update = async (input: ContentItemInput, current: ContentItemRecord | null): Promise<boolean> => {
    setNotice(null)
    const result = await ledger.write((db, now) => saveContent(db, input, current, now), 'content')
    if (!result) setNotice('Could not save this bookmark. Check the URL and field lengths, then try again.')
    return result
  }
  const exportItems = (): void => {
    const blob = new Blob([JSON.stringify(shown, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'ego-content.json'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  if (!ledger.enabled) return <div className="p-8 text-surface-400">Sign in to Ego from Home to save and sync Content.</div>
  return <div className="content-app">
    <aside className={cn('content-nav', navigation && 'is-open')}>
      <div className="content-nav-title"><Bookmark size={20} /><strong>Content</strong><button aria-label="Add collection" onClick={() => setCollectionEditor({ current: null, name: '' })}><Plus size={19} /></button></div>
      <nav aria-label="Content library">
        {[["all", "All bookmarks", Bookmark], ["unsorted", "Unsorted", Inbox], ["favorites", "Favorites", Heart], ["trash", "Trash", Trash2]].map(([id, label, Icon]) => {
          const NavIcon = Icon as typeof Bookmark; const key = String(id)
          return <button key={key} aria-label={`${String(label)}, ${filterContent(items, collections, key, '').length}`} className={filter === key ? 'selected' : ''} onClick={() => choose(key)}><NavIcon size={17} /><span>{String(label)}</span><small>{filterContent(items, collections, key, '').length}</small></button>
        })}
        <div className="content-nav-label">Collections</div>
        {collections.map(collection => <button key={collection.id} className={filter === collection.id ? 'selected' : ''} onClick={() => choose(collection.id)}><Folder size={17} /><span>{collection.name}</span><small>{liveItems.filter(item => item.collectionId === collection.id).length}</small></button>)}
        <button className="content-muted" onClick={() => setCollectionEditor({ current: null, name: '' })}><Plus size={17} /><span>New collection</span></button>
        <div className="content-nav-label">Filters</div>
        {KINDS.map(type => { const Icon = ICONS[type]; return <button key={type} className={kind === type ? 'selected' : ''} onClick={() => setKind(kind === type ? '' : type)}><Icon size={17} /><span className="capitalize">{type}s</span><small>{liveItems.filter(item => item.kind === type).length}</small></button> })}
        {tags.length > 0 && <div className="content-nav-label">Tags</div>}
        {tags.map(value => <button key={value} className={tag === value ? 'selected' : ''} onClick={() => setTag(tag === value ? '' : value)}><span className="content-hash">#</span><span>{value}</span><small>{liveItems.filter(item => item.tags.includes(value)).length}</small></button>)}
      </nav>
      <button className="content-extension" onClick={() => setSettings(true)}><SlidersHorizontal size={16} /> Chrome extension</button>
    </aside>
    <section className="content-main">
      <header className="content-top"><Link to="/" className="content-home" aria-label="Ego Home">E</Link><button className="content-menu" aria-label="Toggle collections" onClick={() => setNavigation(!navigation)}><Menu size={20} /></button>
        <label className="content-search"><Search size={17} /><input aria-label="Search bookmarks" placeholder="Search bookmarks" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <button className="content-icon-button" aria-label="Sync Content" disabled={ledger.syncing} onClick={() => void ledger.sync()}><RefreshCw size={17} className={ledger.syncing ? 'animate-spin' : ''} /></button>
        <Button onClick={() => setEditor({ item: null })} disabled={!ledger.ready}><Plus size={17} /> Add</Button>
      </header>
      <div className="content-toolbar"><div className="content-heading"><h1><Blurred><span>{title}</span></Blurred></h1><span>{shown.length}</span>
        {currentCollection && <><button aria-label="Rename collection" onClick={() => setCollectionEditor({ current: currentCollection, name: currentCollection.name })}><Pencil size={15} /></button><button aria-label="Delete collection" onClick={() => setRemoving(currentCollection)}><Trash2 size={15} /></button></>}
      </div><div className="content-tools"><select aria-label="Sort bookmarks" value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">By title</option></select>
        <button aria-label="Card view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={17} /></button><button aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={18} /></button><button aria-label="Export visible bookmarks" onClick={exportItems}><Download size={17} /></button>
      </div></div>
      {(tag || kind) && <div className="content-active-filters"><span>{[kind, tag && `#${tag}`].filter(Boolean).join(' / ')}</span><button onClick={() => { setTag(''); setKind('') }}>Clear filters</button></div>}
      {(error || notice || ledger.error || ledger.syncError) && <p role="alert" className="px-5 py-3 text-sm">{error ?? notice ?? ledger.error ?? ledger.syncError}</p>}
      <div className="content-scroll">
        {!ledger.ready || loading ? <div className="content-empty">Loading your library...</div> : shown.length === 0 ? <div className="content-empty"><Bookmark size={36} strokeWidth={1.2} /><h2>{items.length ? 'No bookmarks here' : 'Keep what you want to come back to'}</h2><p>{search || tag || kind ? 'Try another search or clear your filters.' : filter === 'trash' ? 'Bookmarks you move to Trash appear here.' : 'Save a link or capture a page with the Chrome extension.'}</p>{filter !== 'trash' && <Button onClick={() => setEditor({ item: null })}>Add a bookmark</Button>}</div>
        : <div className={cn('content-items', view === 'list' && 'content-list')}>{shown.map(item => <article key={item.id} className="content-card">
          <button className="content-cover-button" aria-label={`Edit ${item.title}`} onClick={() => setEditor({ item })}><Cover key={item.coverUrl} item={item} /></button>
          <div className="content-card-body"><button className="content-card-title" onClick={() => setEditor({ item })}><Blurred><span>{item.title}</span></Blurred></button>
            {view === 'list' && item.description && <p className="content-description"><Blurred><span>{item.description}</span></Blurred></p>}
            <div className="content-meta"><Inbox size={13} /><span>{collections.find(collection => collection.id === item.collectionId)?.name ?? 'Unsorted'}</span><span>&middot;</span><span>{contentDomain(item.url)}</span><span>&middot;</span><time>{new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></div>
            {item.tags.length > 0 && <div className="content-tags">{item.tags.map(value => <button key={value} onClick={() => setTag(value)}>#{value}</button>)}</div>}
            <div className="content-card-actions"><button aria-label={item.favorite ? 'Remove favorite' : 'Favorite'} disabled={ledger.writing} onClick={() => void update({ ...item, favorite: !item.favorite }, item)}><Heart size={16} fill={item.favorite ? 'currentColor' : 'none'} /></button>
              <button aria-label="Open original page" onClick={() => void window.api.openExternalUrl(item.url)}><ExternalLink size={16} /></button>
              <button aria-label={item.trashedAt ? 'Restore bookmark' : 'Move to Trash'} disabled={ledger.writing} onClick={() => void update({ ...item, trashedAt: item.trashedAt ? null : new Date().toISOString() }, item)}>{item.trashedAt ? <RotateCcw size={16} /> : <Trash2 size={16} />}</button>
            </div>
          </div>
        </article>)}</div>}
      </div>
    </section>
    {editor && <Editor current={editor.item} collections={collections} busy={ledger.writing} onClose={() => setEditor(null)} onSave={async input => { const saved = await update(input, editor.item); if (saved) setEditor(null); return saved }} />}
    {collectionEditor && <Sheet visible title={collectionEditor.current ? 'Rename collection' : 'New collection'} onClose={() => setCollectionEditor(null)}><form className="content-form" onSubmit={event => { event.preventDefault(); void ledger.write((db, now) => saveCollection(db, collectionEditor.name, collectionEditor.current, now), 'content').then(saved => { if (saved) setCollectionEditor(null) }) }}><label>Name<input autoFocus required maxLength={100} value={collectionEditor.name} onChange={event => setCollectionEditor({ ...collectionEditor, name: event.target.value })} /></label><Button type="submit" disabled={ledger.writing}>Save collection</Button></form></Sheet>}
    <ConfirmDialog visible={!!removing} title="Delete collection?" detail="Its bookmarks will appear in Unsorted." confirmLabel="Delete collection" onCancel={() => setRemoving(null)} onConfirm={() => { if (removing) void ledger.write((db, now) => deleteCollection(db, removing, now), 'content').then(saved => { if (saved) { setRemoving(null); setFilter('all') } }) }} />
    {settings && <ExtensionSettings onClose={() => setSettings(false)} />}
  </div>
}
