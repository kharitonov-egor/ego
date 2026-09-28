import React, { useCallback, useMemo, useState } from 'react'
import { BackHandler, FlatList, Pressable, TextInput, View } from 'react-native'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronDown, EllipsisVertical, Pencil, Plus, Search, Trash2, X } from 'lucide-react-native'
import { ConfirmDialog } from '../../components/money/Common'
import { color } from '../../components/money/tokens'
import { CategorySheet, PickerSheet } from '../../components/gym/sheets'
import { Dot, GymGate, HeaderIcon, MenuSheet } from '../../components/gym/ui'
import { Text } from '../../components/ui/text'
import { useGym } from '../../lib/gym-context'
import type { GymCategoryView, GymExerciseView } from '../../lib/repositories/gym'

const ALL = '__all__'

function matches(name: string, query: string): boolean {
  return name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
}

function Row({ title, detail, swatch, onPress, onMore }: {
  title: string
  detail?: string
  swatch?: string
  onPress: () => void
  onMore: () => void
}): React.ReactElement {
  return <Pressable accessibilityRole="button" onPress={onPress} className="min-h-[58px] flex-row items-center border-b border-border pl-4 active:bg-surface-900">
    {swatch && <View className="mr-3"><Dot color={swatch} size={10} /></View>}
    <View className="flex-1 py-2">
      <Text className="text-[17px]">{title}</Text>
      {detail && <Text className="text-[14px] text-muted-foreground">{detail}</Text>}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Options for ${title}`} onPress={onMore} hitSlop={4} className="h-12 w-12 items-center justify-center active:bg-surface-800">
      <EllipsisVertical color={color.textMuted} size={20} />
    </Pressable>
  </Pressable>
}

/**
 * FitNotes' exercise picker. Categories come first; a category lists its exercises; search looks
 * across all of them. Picking an exercise opens it for the day being logged.
 */
export default function Exercises(): React.ReactElement {
  const gym = useGym()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [choosingCategory, setChoosingCategory] = useState(false)
  const [categoryMenu, setCategoryMenu] = useState<GymCategoryView | null>(null)
  const [exerciseMenu, setExerciseMenu] = useState<GymExerciseView | null>(null)
  const [editingCategory, setEditingCategory] = useState<GymCategoryView | null>(null)
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [deletingExercise, setDeletingExercise] = useState<GymExerciseView | null>(null)
  const [deletingCategory, setDeletingCategory] = useState<GymCategoryView | null>(null)
  const category = gym.categories.find((item) => item.id === categoryId) ?? null
  const searching = query.trim().length > 0

  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (searching) {
        setQuery('')
        return true
      }
      if (categoryId) {
        setCategoryId(null)
        return true
      }
      return false
    })
    return () => subscription.remove()
  }, [categoryId, searching]))

  const exercises = useMemo(() => gym.exercises.filter((exercise) =>
    (!categoryId || exercise.categoryId === categoryId) && (!searching || matches(exercise.name, query.trim()))),
  [categoryId, gym.exercises, query, searching])

  const open = (exercise: GymExerciseView): void => {
    router.replace({ pathname: '/gym/track', params: { exerciseId: exercise.id } })
  }

  const removeExercise = async (): Promise<void> => {
    const target = deletingExercise
    setDeletingExercise(null)
    if (target) await gym.deleteExercise(target.id)
  }

  const removeCategory = async (): Promise<void> => {
    const target = deletingCategory
    setDeletingCategory(null)
    if (target && await gym.deleteCategory(target.id) && categoryId === target.id) setCategoryId(null)
  }

  const showCategories = !categoryId && !searching

  return <>
    <Stack.Screen options={{
      headerTitle: () => <Pressable
        accessibilityRole="button"
        accessibilityHint="Choose a category"
        onPress={() => setChoosingCategory(true)}
        className="min-h-11 flex-row items-center gap-1.5"
      >
        <Text numberOfLines={1} className="text-[17px] font-bold">{category?.name ?? 'All exercises'}</Text>
        <ChevronDown color={color.textSecondary} size={18} />
      </Pressable>,
      headerRight: () => <HeaderIcon label="New exercise" onPress={() => router.push({ pathname: '/gym/exercise-editor', params: categoryId ? { categoryId } : {} })}>
        <Plus color={color.text} size={23} />
      </HeaderIcon>
    }} />
    <GymGate>
      <View className="flex-row items-center border-b border-border px-4">
        <Search color={color.textFaint} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={category ? `Search ${category.name}` : 'Search exercises'}
          placeholderTextColor={color.textFaint}
          autoCorrect={false}
          className="ml-2 min-h-[52px] flex-1 text-[17px] text-foreground"
        />
        {searching && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} hitSlop={8}><X color={color.textMuted} size={18} /></Pressable>}
      </View>
      {showCategories
        ? <FlatList
          data={gym.categories}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          renderItem={({ item }) => <Row
            title={item.name}
            detail={`${item.exerciseCount} ${item.exerciseCount === 1 ? 'exercise' : 'exercises'}`}
            swatch={item.color}
            onPress={() => setCategoryId(item.id)}
            onMore={() => setCategoryMenu(item)}
          />}
          ListFooterComponent={<Pressable accessibilityRole="button" onPress={() => setCreatingCategory(true)} className="min-h-[58px] flex-row items-center px-4 active:bg-surface-900">
            <Plus color={color.textSecondary} size={19} />
            <Text className="ml-3 text-[16px] font-medium text-surface-200">New category</Text>
          </Pressable>}
        />
        : <FlatList
          data={exercises}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          renderItem={({ item }) => <Row
            title={item.name}
            detail={searching && !categoryId ? item.categoryName : undefined}
            onPress={() => open(item)}
            onMore={() => setExerciseMenu(item)}
          />}
          ListEmptyComponent={<View className="items-center px-8 py-10">
            <Text className="text-center text-[16px] leading-6 text-muted-foreground">
              {searching ? `Nothing called "${query.trim()}".` : 'No exercises in this category yet.'}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/gym/exercise-editor', params: { ...(categoryId ? { categoryId } : {}), ...(searching ? { name: query.trim() } : {}) } })} className="mt-4 min-h-12 flex-row items-center rounded-xl border border-input px-4 active:bg-surface-900">
              <Plus color={color.text} size={18} />
              <Text className="ml-2 text-[16px] font-semibold">Create exercise</Text>
            </Pressable>
          </View>}
        />}
    </GymGate>

    <PickerSheet
      visible={choosingCategory}
      title="Category"
      options={[{ value: ALL, label: 'All exercises' }, ...gym.categories.map((item) => ({ value: item.id, label: item.name, swatch: item.color }))]}
      value={categoryId ?? ALL}
      onPick={(value) => setCategoryId(value === ALL ? null : value)}
      onClose={() => setChoosingCategory(false)}
    />
    <MenuSheet visible={categoryMenu !== null} title={categoryMenu?.name ?? ''} onClose={() => setCategoryMenu(null)} items={categoryMenu ? [
      { label: 'Edit category', Icon: Pencil, onPress: () => setEditingCategory(categoryMenu) },
      { label: 'Delete category', Icon: Trash2, destructive: true, onPress: () => setDeletingCategory(categoryMenu) }
    ] : []} />
    <MenuSheet visible={exerciseMenu !== null} title={exerciseMenu?.name ?? ''} onClose={() => setExerciseMenu(null)} items={exerciseMenu ? [
      { label: 'Edit exercise', Icon: Pencil, onPress: () => router.push({ pathname: '/gym/exercise-editor', params: { id: exerciseMenu.id } }) },
      { label: 'Delete exercise', Icon: Trash2, destructive: true, onPress: () => setDeletingExercise(exerciseMenu) }
    ] : []} />
    <CategorySheet visible={creatingCategory || editingCategory !== null} category={editingCategory} onClose={() => {
      setCreatingCategory(false)
      setEditingCategory(null)
    }} />
    <ConfirmDialog
      visible={deletingExercise !== null}
      title={`Delete ${deletingExercise?.name ?? 'this exercise'}?`}
      detail={deletingExercise && deletingExercise.setCount > 0
        ? `Its ${deletingExercise.setCount} logged ${deletingExercise.setCount === 1 ? 'set disappears' : 'sets disappear'} from your history and graphs on every device.`
        : 'It leaves the list on every device.'}
      confirmLabel="Delete"
      destructive
      hideNavigation={false}
      onCancel={() => setDeletingExercise(null)}
      onConfirm={() => void removeExercise()}
    />
    <ConfirmDialog
      visible={deletingCategory !== null}
      title={deletingCategory && deletingCategory.exerciseCount > 0 ? 'This category has exercises' : `Delete ${deletingCategory?.name ?? 'this category'}?`}
      detail={deletingCategory && deletingCategory.exerciseCount > 0
        ? `Move or delete its ${deletingCategory.exerciseCount} ${deletingCategory.exerciseCount === 1 ? 'exercise' : 'exercises'} first.`
        : 'It leaves the list on every device.'}
      confirmLabel={deletingCategory && deletingCategory.exerciseCount > 0 ? 'OK' : 'Delete'}
      destructive={!deletingCategory || deletingCategory.exerciseCount === 0}
      hideNavigation={false}
      onCancel={() => setDeletingCategory(null)}
      onConfirm={() => deletingCategory && deletingCategory.exerciseCount > 0 ? setDeletingCategory(null) : void removeCategory()}
    />
  </>
}
