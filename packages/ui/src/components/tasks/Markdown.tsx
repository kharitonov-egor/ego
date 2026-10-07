import React, { useLayoutEffect, useMemo, useRef } from 'react'
import {
  Bold, Code, Heading2, Italic, Link, List, ListChecks, ListOrdered, Strikethrough, type LucideIcon
} from 'lucide-react'
import { normalizeUrl } from '@ego/core'
import {
  insertLink, parseMarkdown, prefixLines, wrapSelection, type Block, type Edit, type Selection, type Span
} from '@ego/local/tasks/markdown'
import { Blurred, useBlur } from '../../lib/blur'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'

/** Windows hands any other scheme to whatever program claims it, so a pasted link cannot start one. */
const OPENABLE = /^(https?|mailto):/i

function openLink(link: string): void {
  const url = normalizeUrl(link)
  if (OPENABLE.test(url)) void window.api.openExternalUrl(url).catch(() => undefined)
}

function spanStyle(span: Span): React.CSSProperties {
  return {
    fontWeight: span.bold ? 700 : undefined,
    fontStyle: span.italic ? 'italic' : undefined,
    textDecorationLine: span.link ? 'underline' : span.strike ? 'line-through' : undefined,
    fontFamily: span.code ? 'Consolas, monospace' : undefined,
    backgroundColor: span.code ? '#262626' : undefined,
    borderRadius: span.code ? 4 : undefined,
    padding: span.code ? '0 3px' : undefined,
    color: span.link ? '#ffffff' : undefined
  }
}

function Spans({ spans, style }: { spans: readonly Span[]; style: React.CSSProperties }): React.ReactElement {
  return <span className="whitespace-pre-wrap break-words" style={style}>
    {spans.map((span, index) => span.link
      ? <a
        key={index}
        href={normalizeUrl(span.link)}
        title={normalizeUrl(span.link)}
        style={spanStyle(span)}
        onClick={(event) => {
          event.preventDefault()
          openLink(span.link ?? '')
        }}
        className="cursor-pointer hover:text-surface-300"
      >{span.text}</a>
      : <span key={index} style={spanStyle(span)}>{span.text}</span>)}
  </span>
}

const BODY: React.CSSProperties = { color: color.textSecondary, fontSize: 16, lineHeight: '23px' }
const HEADINGS: Record<number, React.CSSProperties> = {
  1: { color: color.text, fontSize: 22, lineHeight: '28px', fontWeight: 700 },
  2: { color: color.text, fontSize: 19, lineHeight: '25px', fontWeight: 700 },
  3: { color: color.text, fontSize: 17, lineHeight: '23px', fontWeight: 700 }
}

function BlockView({ block, onToggleTask }: { block: Block; onToggleTask?: (line: number) => void }): React.ReactElement {
  switch (block.type) {
    case 'heading':
      return <div className="mb-1 mt-2"><Spans spans={block.spans} style={HEADINGS[Math.min(block.level, 3)]} /></div>
    case 'paragraph':
      return <p className="mb-2"><Spans spans={block.spans} style={BODY} /></p>
    case 'quote':
      return <blockquote className="mb-2 border-l-2 border-surface-600 pl-3"><Spans spans={block.spans} style={{ ...BODY, color: color.textMuted, fontStyle: 'italic' }} /></blockquote>
    case 'code':
      return <pre className="mb-2 overflow-x-auto rounded-lg bg-surface-900 p-2.5" style={{ fontFamily: 'Consolas, monospace', fontSize: 14, lineHeight: '20px', color: color.textSecondary }}>{block.text}</pre>
    case 'rule':
      return <hr className="my-3 h-px border-0 bg-surface-700" />
    case 'item': {
      const marker = block.checked !== null
        ? <button
          type="button"
          role="checkbox"
          aria-checked={block.checked}
          aria-label={block.spans.map((span) => span.text).join('')}
          disabled={!onToggleTask}
          onClick={() => onToggleTask?.(block.line)}
          className={cn('mr-2 mt-[3px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border',
            block.checked ? 'border-transparent bg-surface-300' : 'border-surface-500 hover:border-surface-300')}
        >{block.checked && <span style={{ color: '#0a0a0a', fontSize: 12, fontWeight: 800, lineHeight: 1 }}>✓</span>}</button>
        : <span className="shrink-0" style={{ ...BODY, width: block.ordered ? 26 : 16 }}>{block.ordered ? `${block.number}.` : '•'}</span>
      return <div className="mb-1 flex" style={{ paddingLeft: block.depth * 18 }}>
        {marker}
        <div className="min-w-0 flex-1"><Spans spans={block.spans} style={{ ...BODY, color: block.checked ? color.textFaint : BODY.color, textDecorationLine: block.checked ? 'line-through' : undefined }} /></div>
      </div>
    }
  }
}

/** A description as it reads. Clicking a checkbox ticks it in the source. */
export function MarkdownView({ source, onToggleTask }: { source: string; onToggleTask?: (line: number) => void }): React.ReactElement {
  const { blurred } = useBlur()
  const blocks = useMemo(() => parseMarkdown(source), [source])
  if (blurred) {
    return <Blurred><p className="whitespace-pre-wrap" style={BODY}>{blocks.map((block) => block.type === 'code' ? block.text : block.type === 'rule' ? '' : block.spans.map((span) => span.text).join('')).filter(Boolean).join('\n')}</p></Blurred>
  }
  return <div>{blocks.map((block, index) => <BlockView key={index} block={block} onToggleTask={onToggleTask} />)}</div>
}

interface Tool {
  label: string
  Icon: LucideIcon
  /** Ctrl plus this key does the same. */
  key?: string
  apply: (text: string, selection: Selection) => Edit
}

const TOOLS: readonly Tool[] = [
  { label: 'Bold', Icon: Bold, key: 'b', apply: (text, selection) => wrapSelection(text, selection, '**') },
  { label: 'Italic', Icon: Italic, key: 'i', apply: (text, selection) => wrapSelection(text, selection, '_') },
  { label: 'Strikethrough', Icon: Strikethrough, apply: (text, selection) => wrapSelection(text, selection, '~~') },
  { label: 'Code', Icon: Code, apply: (text, selection) => wrapSelection(text, selection, '`') },
  { label: 'Link', Icon: Link, key: 'k', apply: insertLink },
  { label: 'Heading', Icon: Heading2, apply: (text, selection) => prefixLines(text, selection, () => '## ') },
  { label: 'Bulleted list', Icon: List, apply: (text, selection) => prefixLines(text, selection, () => '- ') },
  { label: 'Numbered list', Icon: ListOrdered, apply: (text, selection) => prefixLines(text, selection, (index) => `${index + 1}. `) },
  { label: 'Checklist', Icon: ListChecks, apply: (text, selection) => prefixLines(text, selection, () => '- [ ] ') }
]

/** A plain text box with a row of buttons that write the Markdown for you. Ctrl+Enter saves, Escape cancels. */
export function MarkdownEditor({ value, onChange, onSave, onCancel }: {
  value: string
  onChange: (text: string) => void
  onSave?: () => void
  onCancel?: () => void
}): React.ReactElement {
  const input = useRef<HTMLTextAreaElement>(null)
  const forced = useRef<Selection | null>(null)

  useLayoutEffect(() => {
    const element = input.current
    element?.setSelectionRange(element.value.length, element.value.length)
  }, [])

  useLayoutEffect(() => {
    const selection = forced.current
    if (!selection || !input.current) return
    forced.current = null
    input.current.setSelectionRange(selection.start, selection.end)
  }, [value])

  const apply = (tool: Tool): void => {
    const element = input.current
    const selection = element ? { start: element.selectionStart, end: element.selectionEnd } : { start: value.length, end: value.length }
    const edit = tool.apply(value, selection)
    forced.current = edit.selection
    onChange(edit.text)
    element?.focus()
  }

  return <div className="overflow-hidden rounded-xl border border-input bg-surface-900 focus-within:border-surface-400">
    <div role="toolbar" aria-label="Formatting" className="flex overflow-x-auto border-b border-surface-800">
      {TOOLS.map((tool) => <button
        key={tool.label}
        type="button"
        aria-label={tool.label}
        title={tool.key ? `${tool.label} (Ctrl+${tool.key.toUpperCase()})` : tool.label}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => apply(tool)}
        className="flex h-11 w-11 shrink-0 items-center justify-center hover:bg-surface-800 active:bg-surface-800"
      ><tool.Icon color={color.textSecondary} size={18} /></button>)}
    </div>
    <textarea
      ref={input}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && onCancel) {
          event.preventDefault()
          onCancel()
          return
        }
        if (!event.ctrlKey || event.altKey) return
        if (event.key === 'Enter' && onSave) {
          event.preventDefault()
          onSave()
          return
        }
        const tool = TOOLS.find((item) => item.key === event.key.toLowerCase())
        if (!tool || event.shiftKey) return
        event.preventDefault()
        apply(tool)
      }}
      autoFocus
      placeholder="Add a more detailed description..."
      aria-label="Description"
      className="block max-h-[480px] min-h-[160px] w-full resize-none bg-transparent p-3 text-[16px] leading-[22px] text-foreground outline-none [field-sizing:content]"
    />
  </div>
}
