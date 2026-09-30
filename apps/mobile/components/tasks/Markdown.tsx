import React, { useMemo, useState } from 'react'
import { Linking, Platform, Pressable, ScrollView, Text, TextInput, View, type TextStyle } from 'react-native'
import {
  Bold, Code, Heading2, Italic, Link, List, ListChecks, ListOrdered, Strikethrough, type LucideIcon
} from 'lucide-react-native'
import { Blurred, useBlur } from '../../lib/blur'
import {
  insertLink, parseMarkdown, prefixLines, wrapSelection, type Block, type Edit, type Selection, type Span
} from '../../lib/tasks/markdown'
import { normalizeUrl } from '@ego/core'
import { color } from '../money/tokens'

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' })

function spanStyle(span: Span): TextStyle {
  return {
    fontWeight: span.bold ? '700' : undefined,
    fontStyle: span.italic ? 'italic' : undefined,
    textDecorationLine: span.link ? 'underline' : span.strike ? 'line-through' : undefined,
    fontFamily: span.code ? MONO : undefined,
    backgroundColor: span.code ? '#262626' : undefined,
    color: span.link ? '#ffffff' : undefined
  }
}

function Spans({ spans, style }: { spans: readonly Span[]; style: TextStyle }): React.ReactElement {
  return <Text style={style}>
    {spans.map((span, index) => <Text
      key={index}
      style={spanStyle(span)}
      onPress={span.link ? () => void Linking.openURL(normalizeUrl(span.link ?? '')).catch(() => undefined) : undefined}
      suppressHighlighting
    >{span.text}</Text>)}
  </Text>
}

const BODY: TextStyle = { color: color.textSecondary, fontSize: 16, lineHeight: 23 }
const HEADINGS: Record<number, TextStyle> = {
  1: { color: color.text, fontSize: 22, lineHeight: 28, fontWeight: '700' },
  2: { color: color.text, fontSize: 19, lineHeight: 25, fontWeight: '700' },
  3: { color: color.text, fontSize: 17, lineHeight: 23, fontWeight: '700' }
}

function BlockView({ block, onToggleTask }: { block: Block; onToggleTask?: (line: number) => void }): React.ReactElement {
  switch (block.type) {
    case 'heading':
      return <View className="mb-1 mt-2"><Spans spans={block.spans} style={HEADINGS[Math.min(block.level, 3)]} /></View>
    case 'paragraph':
      return <View className="mb-2"><Spans spans={block.spans} style={BODY} /></View>
    case 'quote':
      return <View className="mb-2 border-l-2 border-surface-600 pl-3"><Spans spans={block.spans} style={{ ...BODY, color: color.textMuted, fontStyle: 'italic' }} /></View>
    case 'code':
      return <ScrollView horizontal className="mb-2 rounded-lg bg-surface-900" contentContainerStyle={{ padding: 10 }}>
        <Text style={{ fontFamily: MONO, fontSize: 14, lineHeight: 20, color: color.textSecondary }}>{block.text}</Text>
      </ScrollView>
    case 'rule':
      return <View className="my-3 h-px bg-surface-700" />
    case 'item': {
      const marker = block.checked !== null
        ? <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: block.checked }}
          disabled={!onToggleTask}
          onPress={() => onToggleTask?.(block.line)}
          hitSlop={8}
          className={`mr-2 mt-0.5 h-[18px] w-[18px] items-center justify-center rounded border ${block.checked ? 'border-transparent bg-surface-300' : 'border-surface-500'}`}
        >{block.checked && <Text style={{ color: '#0a0a0a', fontSize: 12, fontWeight: '800' }}>✓</Text>}</Pressable>
        : <Text style={{ ...BODY, width: block.ordered ? 26 : 16 }}>{block.ordered ? `${block.number}.` : '•'}</Text>
      return <View className="mb-1 flex-row" style={{ paddingLeft: block.depth * 18 }}>
        {marker}
        <View className="flex-1"><Spans spans={block.spans} style={{ ...BODY, color: block.checked ? color.textFaint : BODY.color, textDecorationLine: block.checked ? 'line-through' : undefined }} /></View>
      </View>
    }
  }
}

/** A description as it reads. Tapping a checkbox ticks it in the source. */
export function MarkdownView({ source, onToggleTask }: { source: string; onToggleTask?: (line: number) => void }): React.ReactElement {
  const { blurred } = useBlur()
  const blocks = useMemo(() => parseMarkdown(source), [source])
  if (blurred) {
    return <Blurred tint="#d4d4d4"><Text style={BODY}>{blocks.map((block) => block.type === 'code' ? block.text : block.type === 'rule' ? '' : block.spans.map((span) => span.text).join('')).filter(Boolean).join('\n')}</Text></Blurred>
  }
  return <View>{blocks.map((block, index) => <BlockView key={index} block={block} onToggleTask={onToggleTask} />)}</View>
}

interface Tool {
  label: string
  Icon: LucideIcon
  apply: (text: string, selection: Selection) => Edit
}

const TOOLS: readonly Tool[] = [
  { label: 'Bold', Icon: Bold, apply: (text, selection) => wrapSelection(text, selection, '**') },
  { label: 'Italic', Icon: Italic, apply: (text, selection) => wrapSelection(text, selection, '_') },
  { label: 'Strikethrough', Icon: Strikethrough, apply: (text, selection) => wrapSelection(text, selection, '~~') },
  { label: 'Code', Icon: Code, apply: (text, selection) => wrapSelection(text, selection, '`') },
  { label: 'Link', Icon: Link, apply: insertLink },
  { label: 'Heading', Icon: Heading2, apply: (text, selection) => prefixLines(text, selection, () => '## ') },
  { label: 'Bulleted list', Icon: List, apply: (text, selection) => prefixLines(text, selection, () => '- ') },
  { label: 'Numbered list', Icon: ListOrdered, apply: (text, selection) => prefixLines(text, selection, (index) => `${index + 1}. `) },
  { label: 'Checklist', Icon: ListChecks, apply: (text, selection) => prefixLines(text, selection, () => '- [ ] ') }
]

/** A plain text box with a row of buttons that write the Markdown for you. */
export function MarkdownEditor({ value, onChange }: { value: string; onChange: (text: string) => void }): React.ReactElement {
  const [selection, setSelection] = useState<Selection>({ start: value.length, end: value.length })
  const [forced, setForced] = useState<Selection | undefined>(undefined)
  return <View className="overflow-hidden rounded-xl border border-input bg-surface-900">
    <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} className="border-b border-surface-800">
      {TOOLS.map((tool) => <Pressable
        key={tool.label}
        accessibilityRole="button"
        accessibilityLabel={tool.label}
        onPress={() => {
          const edit = tool.apply(value, selection)
          onChange(edit.text)
          setSelection(edit.selection)
          setForced(edit.selection)
        }}
        className="h-11 w-11 items-center justify-center active:bg-surface-800"
      ><tool.Icon color={color.textSecondary} size={18} /></Pressable>)}
    </ScrollView>
    <TextInput
      value={value}
      onChangeText={onChange}
      selection={forced}
      onSelectionChange={(event) => {
        setSelection(event.nativeEvent.selection)
        setForced(undefined)
      }}
      multiline
      autoFocus
      textAlignVertical="top"
      placeholder="Add a more detailed description..."
      placeholderTextColor="#737373"
      accessibilityLabel="Description"
      style={{ minHeight: 160, maxHeight: 360, padding: 12, fontSize: 16, lineHeight: 22, color: color.text }}
    />
  </View>
}
