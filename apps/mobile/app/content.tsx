import React, { useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Stack } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Bookmark, ChevronDown, ExternalLink, Heart, LayoutGrid, List, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react-native'
import type { ContentItemRecord, ContentCollectionRecord } from '@ego/api-contracts'
import { contentDomain, emptyContentItem, filterContent, type ContentItemInput, type ContentKind } from '@ego/core'
import { saveContent, saveCollection, deleteCollection } from '@ego/local/content/actions'
import { useContent } from '../lib/content'
import { Blurred } from '../lib/blur'
import { KeyboardScrollView } from '../components/ui/keyboard'

const KINDS: ContentKind[] = ['link', 'article', 'video', 'image', 'document']
function Action({ label, onPress, children, disabled = false }: { label: string; onPress: () => void; children: React.ReactNode; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[s.icon, disabled && { opacity: .4 }]}>{children}</Pressable>
}
function Cover({ item }: { item: ContentItemInput }) {
  const [failed, setFailed] = useState(false)
  return item.coverUrl && !failed ? <Image source={{ uri: item.coverUrl }} style={s.cover} onError={() => setFailed(true)} />
    : <View style={[s.cover, s.placeholder]}><Bookmark color="#737373" size={28} /><Text numberOfLines={1} style={s.meta}>{contentDomain(item.url)}</Text></View>
}
function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets()
  return <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet"><View style={{ flex: 1, backgroundColor: '#0a0a0a', paddingTop: insets.top, paddingBottom: insets.bottom }}><View style={s.header}><Text style={s.heading}>{title}</Text><Action label="Close" onPress={onClose}><X color="white" size={22} /></Action></View>{children}</View></Modal>
}
function Editor({ item, collections, busy, onClose, onSave }: { item: ContentItemRecord | null; collections: ContentCollectionRecord[]; busy: boolean; onClose: () => void; onSave: (input: ContentItemInput) => Promise<void> }) {
  const [input, setInput] = useState(item ?? emptyContentItem())
  const [tags, setTags] = useState(input.tags.join(', '))
  const patch = (value: Partial<ContentItemInput>) => setInput(current => ({ ...current, ...value }))
  const field = (label: string, key: 'title' | 'url' | 'description' | 'notes' | 'coverUrl', maxLength: number, multiline = false) => <View style={s.field}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} style={[s.input, multiline && { minHeight: 88, textAlignVertical: 'top' }]} value={input[key] ?? ''} maxLength={maxLength} multiline={multiline} autoCapitalize={key === 'url' || key === 'coverUrl' ? 'none' : 'sentences'} keyboardType={key === 'url' || key === 'coverUrl' ? 'url' : 'default'} onChangeText={text => patch({ [key]: key === 'coverUrl' ? text || null : text })} placeholderTextColor="#737373" /></View>
  return <Overlay title={item ? 'Edit bookmark' : 'New bookmark'} onClose={onClose}><KeyboardScrollView contentContainerStyle={{ padding: 20, gap: 20 }} keyboardShouldPersistTaps="handled">
    {field('Title', 'title', 500)}{field('URL', 'url', 4096)}{field('Description', 'description', 4000, true)}{field('Note', 'notes', 20000, true)}
    <View style={s.field}><Text style={s.label}>Collection</Text><View style={s.chips}>{[{ id: '', name: 'Unsorted' }, ...collections].map(collection => <Pressable key={collection.id} style={[s.chip, (input.collectionId ?? '') === collection.id && s.selected]} onPress={() => patch({ collectionId: collection.id || null })}><Text style={s.text}>{collection.name}</Text></Pressable>)}</View></View>
    <View style={s.field}><Text style={s.label}>Tags</Text><TextInput accessibilityLabel="Tags" placeholder="Separate with commas" placeholderTextColor="#737373" value={tags} onChangeText={setTags} style={s.input} /></View>
    <View style={s.field}><Text style={s.label}>Type</Text><View style={s.chips}>{KINDS.map(kind => <Pressable key={kind} style={[s.chip, input.kind === kind && s.selected]} onPress={() => patch({ kind })}><Text style={s.text}>{kind}</Text></Pressable>)}</View></View>
    {field('Cover image URL', 'coverUrl', 4096)}
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: input.favorite }} onPress={() => patch({ favorite: !input.favorite })} style={s.row}><Heart color="white" fill={input.favorite ? 'white' : 'none'} size={20} /><Text style={s.text}>Favorite</Text></Pressable>
    <Pressable disabled={busy} style={s.primary} onPress={() => void onSave({ ...input, tags: tags.split(',').map(tag => tag.trim()).filter(Boolean) })}><Text style={s.primaryText}>{busy ? 'Saving...' : 'Save bookmark'}</Text></Pressable>
  </KeyboardScrollView></Overlay>
}
export default function ContentScreen() {
  const { ledger, items, collections, loading, error } = useContent()
  const insets = useSafeAreaInsets()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState('')
  const [kind, setKind] = useState('')
  const [grid, setGrid] = useState(false)
  const [oldest, setOldest] = useState(false)
  const [navigation, setNavigation] = useState(false)
  const [editor, setEditor] = useState<{ item: ContentItemRecord | null } | null>(null)
  const [collectionEditor, setCollectionEditor] = useState<{ current: ContentCollectionRecord | null; name: string } | null>(null)
  const title = collections.find(collection => collection.id === filter)?.name ?? ({ all: 'All bookmarks', favorites: 'Favorites', unsorted: 'Unsorted', trash: 'Trash' }[filter] ?? 'All bookmarks')
  const shown = useMemo(() => filterContent(items, collections, filter, search, tag, kind).sort((a, b) => oldest ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)), [items, collections, filter, search, tag, kind, oldest])
  const update = async (input: ContentItemInput, current: ContentItemRecord | null) => {
    const saved = await ledger.write((db, now) => saveContent(db, input, current, now), 'content')
    if (!saved) Alert.alert('Could not save bookmark', 'Check the title, URL, and field lengths, then try again.')
    return saved
  }
  const removeCollection = (collection: ContentCollectionRecord) => Alert.alert('Delete collection?', 'Its bookmarks will appear in Unsorted.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { void ledger.write((db, now) => deleteCollection(db, collection, now), 'content').then(saved => { if (saved) setFilter('all') }) } }])
  return <View style={{ flex: 1, backgroundColor: '#0a0a0a', paddingBottom: insets.bottom }}>
    <Stack.Screen options={{ title: 'Content', headerRight: () => <Action label="Add bookmark" disabled={!ledger.ready} onPress={() => setEditor({ item: null })}><Plus color="white" size={24} /></Action> }} />
    {!ledger.enabled ? <Text style={[s.label, { padding: 24 }]}>Sign in from Home to save and sync Content.</Text> : <>
      <View style={s.search}><Search color="#737373" size={18} /><TextInput accessibilityLabel="Search bookmarks" style={{ flex: 1, color: 'white', minHeight: 44 }} value={search} onChangeText={setSearch} placeholder="Search bookmarks" placeholderTextColor="#737373" /></View>
      <View style={s.toolbar}><Pressable style={[s.row, { flex: 1 }]} onPress={() => setNavigation(true)}><Text style={s.heading} numberOfLines={1}>{title}</Text><ChevronDown color="#a3a3a3" size={18} /></Pressable><Action label={oldest ? 'Show newest first' : 'Show oldest first'} onPress={() => setOldest(!oldest)}><Text style={s.meta}>{oldest ? 'Oldest' : 'Newest'}</Text></Action><Action label={grid ? 'List view' : 'Card view'} onPress={() => setGrid(!grid)}>{grid ? <List color="white" size={20} /> : <LayoutGrid color="white" size={20} />}</Action></View>
      {(tag || kind) && <Pressable onPress={() => { setTag(''); setKind('') }} style={{ padding: 16 }}><Text style={s.label}>{[kind, tag && `#${tag}`].filter(Boolean).join(' / ')} {'\u00b7'} Clear filters</Text></Pressable>}
      {(error || ledger.error) && <Text accessibilityRole="alert" style={[s.label, { padding: 16 }]}>{error ?? ledger.error}</Text>}
      {loading || !ledger.ready ? <ActivityIndicator color="white" style={{ margin: 40 }} /> : <FlatList key={grid ? 'grid' : 'list'} data={shown} keyExtractor={item => item.id} numColumns={grid ? 2 : 1} contentContainerStyle={{ padding: 12, paddingBottom: 80, flexGrow: 1 }} columnWrapperStyle={grid ? { gap: 12 } : undefined} refreshing={ledger.syncing} onRefresh={() => void ledger.sync()}
        ListEmptyComponent={<View style={s.empty}><Bookmark color="#737373" size={36} /><Text style={s.heading}>{items.length ? 'No bookmarks here' : 'Save something worth keeping'}</Text><Text style={[s.label, { textAlign: 'center' }]}>Add a link with + or save a page from Chrome.</Text></View>}
        renderItem={({ item }) => <View style={[s.card, grid ? { flex: 1, maxWidth: '50%' } : s.listCard]}><Pressable style={grid ? undefined : { width: 100 }} onPress={() => setEditor({ item })}><Cover key={item.coverUrl} item={item} /></Pressable><View style={{ padding: 12, flex: 1 }}><Pressable onPress={() => setEditor({ item })}><Blurred><Text style={s.title} numberOfLines={grid ? 3 : 2}>{item.title}</Text></Blurred></Pressable><Text numberOfLines={1} style={s.meta}>{contentDomain(item.url)}</Text><Text numberOfLines={1} style={s.meta}>{collections.find(collection => collection.id === item.collectionId)?.name ?? 'Unsorted'} {'\u00b7'} {new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>{item.tags.length > 0 && <Text numberOfLines={1} style={s.meta}>{item.tags.map(value => `#${value}`).join(' ')}</Text>}<View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}><Action label="Toggle favorite" disabled={ledger.writing} onPress={() => void update({ ...item, favorite: !item.favorite }, item)}><Heart size={17} color="white" fill={item.favorite ? 'white' : 'none'} /></Action><Action label="Open page" onPress={() => { void Linking.openURL(item.url).catch(() => Alert.alert('Could not open this link')) }}><ExternalLink size={17} color="#a3a3a3" /></Action><Action label={item.trashedAt ? 'Restore bookmark' : 'Move to Trash'} disabled={ledger.writing} onPress={() => void update({ ...item, trashedAt: item.trashedAt ? null : new Date().toISOString() }, item)}>{item.trashedAt ? <RotateCcw size={17} color="#a3a3a3" /> : <Trash2 size={17} color="#a3a3a3" />}</Action></View></View></View>} />}
    </>}
    {navigation && <Overlay title="Library" onClose={() => setNavigation(false)}><ScrollView contentContainerStyle={{ padding: 20, gap: 8 }}>{[['all', 'All bookmarks'], ['unsorted', 'Unsorted'], ['favorites', 'Favorites'], ['trash', 'Trash'], ...collections.map(collection => [collection.id, collection.name])].map(([id, label]) => <View key={id} style={s.row}><Pressable style={[s.chip, { flex: 1 }, filter === id && s.selected]} onPress={() => { setFilter(id); setNavigation(false) }}><Text style={s.text}>{label}   {filterContent(items, collections, id, '').length}</Text></Pressable>{collections.some(collection => collection.id === id) && <Action label={`Edit ${label}`} onPress={() => { setNavigation(false); setCollectionEditor({ current: collections.find(collection => collection.id === id)!, name: label }) }}><Text style={s.label}>Edit</Text></Action>}</View>)}<Pressable style={s.chip} onPress={() => { setNavigation(false); setCollectionEditor({ current: null, name: '' }) }}><Text style={s.text}>+ New collection</Text></Pressable><Text style={[s.label, { marginTop: 24 }]}>Type</Text><View style={s.chips}>{KINDS.map(value => <Pressable key={value} style={[s.chip, kind === value && s.selected]} onPress={() => { setKind(kind === value ? '' : value); setNavigation(false) }}><Text style={s.text}>{value}</Text></Pressable>)}</View><Text style={[s.label, { marginTop: 24 }]}>Tags</Text><View style={s.chips}>{[...new Set(items.filter(item => !item.trashedAt).flatMap(item => item.tags))].sort().map(value => <Pressable key={value} style={[s.chip, tag === value && s.selected]} onPress={() => { setTag(tag === value ? '' : value); setNavigation(false) }}><Text style={s.text}>#{value}</Text></Pressable>)}</View></ScrollView></Overlay>}
    {editor && <Editor item={editor.item} collections={collections} busy={ledger.writing} onClose={() => setEditor(null)} onSave={async input => { if (await update(input, editor.item)) setEditor(null) }} />}
    {collectionEditor && <Overlay title="Collection" onClose={() => setCollectionEditor(null)}><KeyboardScrollView contentContainerStyle={{ padding: 20, gap: 20 }}><TextInput accessibilityLabel="Collection name" autoFocus value={collectionEditor.name} maxLength={100} onChangeText={name => setCollectionEditor({ ...collectionEditor, name })} style={s.input} /><Pressable disabled={ledger.writing} style={s.primary} onPress={() => { void ledger.write((db, now) => saveCollection(db, collectionEditor.name, collectionEditor.current, now), 'content').then(saved => { if (saved) setCollectionEditor(null); else Alert.alert('Enter a collection name') }) }}><Text style={s.primaryText}>Save collection</Text></Pressable>{collectionEditor.current && <Pressable style={s.chip} onPress={() => { removeCollection(collectionEditor.current!); setCollectionEditor(null) }}><Text style={s.text}>Delete collection</Text></Pressable>}</KeyboardScrollView></Overlay>}
  </View>
}
const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderColor: '#262626' },
  heading: { fontSize: 18, fontWeight: '600', color: '#fafafa', flexShrink: 1 }, text: { color: '#fafafa', fontSize: 14 }, label: { color: '#a3a3a3', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 }, icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, margin: 16, marginBottom: 4, borderRadius: 12, backgroundColor: '#171717' },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 56 },
  card: { borderRadius: 12, backgroundColor: '#141414', borderWidth: 1, borderColor: '#262626', marginBottom: 12, overflow: 'hidden' }, listCard: { flexDirection: 'row', alignItems: 'center' },
  cover: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#1c1c1c' }, placeholder: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '600', color: '#fafafa', lineHeight: 20 }, meta: { fontSize: 12, color: '#737373', marginTop: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  field: { gap: 8 }, input: { borderWidth: 1, borderColor: '#333333', borderRadius: 12, padding: 12, minHeight: 48, color: '#fafafa', fontSize: 14, backgroundColor: '#171717' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { padding: 12, minHeight: 44, borderWidth: 1, borderColor: '#262626', borderRadius: 12, justifyContent: 'center' }, selected: { backgroundColor: '#262626', borderColor: '#737373' },
  primary: { backgroundColor: '#fafafa', padding: 16, borderRadius: 12, alignItems: 'center', minHeight: 48 }, primaryText: { color: '#0a0a0a', fontSize: 14, fontWeight: '600' }
})
