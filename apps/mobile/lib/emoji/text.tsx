import React, { createContext, useContext, useState } from 'react'
import { Image, PixelRatio, StyleSheet, Text as NativeText, processColor, type ColorValue, type TextProps } from 'react-native'
import { cssInterop } from 'nativewind'
import { emojiParts } from './parts'

/** What a nested Text inherits natively, which its pictures have to be told. */
interface Inherited {
  fontSize: number
  opacity: number
  inkAlpha: number
}

interface Look {
  size: number
  scale: number
  drop: number
  opacity: number
}

const Parent = createContext<Inherited | null>(null)

function alphaOf(color: ColorValue | undefined): number | undefined {
  const processed = color === undefined ? undefined : processColor(color)
  return typeof processed === 'number' ? (processed >>> 24) / 255 : undefined
}

/**
 * Android mounts a picture beside the Text, not inside it, so the Text's opacity and ink never
 * reach it. Blur and spoilers hide text that way, so the picture copies them.
 *
 * Android also reserves a slot scaled by the system font size but keeps the picture at its own
 * size, top-aligned to the slot. The transform grows the picture into the slot.
 */
function Picture({ emoji, uri, look }: { emoji: string; uri: string; look: Look }): React.ReactNode {
  const [failed, setFailed] = useState(false)
  if (failed) return emoji
  const grow = look.size * (look.scale - 1) / 2
  return <Image
    source={{ uri }}
    accessibilityLabel={emoji}
    onError={() => setFailed(true)}
    style={{
      width: look.size,
      height: look.size,
      opacity: look.opacity,
      transform: [{ translateX: grow }, { translateY: grow + look.drop }, { scale: look.scale }]
    }}
  />
}

function pictures(text: string, look: Look): React.ReactNode[] | null {
  const parts = emojiParts(text)
  if (!parts.some((part) => part.image)) return null
  return parts.map((part, index) => part.image
    ? <Picture key={`${index}${part.text}`} emoji={part.text} uri={part.image} look={look} />
    : part.text)
}

function withPictures(children: React.ReactNode, look: Look): React.ReactNode {
  if (typeof children === 'string') return pictures(children, look) ?? children
  if (children === null || typeof children !== 'object') return children
  return React.Children.map(children, (child) => typeof child === 'string' ? pictures(child, look) ?? child : child)
}

function isLoneEmoji(children: React.ReactNode): boolean {
  if (typeof children !== 'string') return false
  const parts = emojiParts(children)
  return parts.length === 1 && parts[0].image !== null
}

/** React Native's Text with Apple's emoji in place of Android's. Metro gives it to the app as react-native's Text. */
export function Text(props: TextProps): React.ReactElement {
  const parent = useContext(Parent)
  const style = StyleSheet.flatten(props.style)
  const inherited: Inherited = {
    fontSize: style?.fontSize ?? parent?.fontSize ?? 14,
    opacity: (parent?.opacity ?? 1) * (typeof style?.opacity === 'number' ? style.opacity : 1),
    inkAlpha: alphaOf(style?.color) ?? parent?.inkAlpha ?? 1
  }
  const size = Math.round(inherited.fontSize * 1.25)
  const scale = PixelRatio.getFontScale()
  // A picture stands on the baseline. Among letters it drops a little, like an emoji glyph. Alone, its line ends at the baseline, so it stays put.
  const drop = parent === null && isLoneEmoji(props.children) ? 0 : Math.round(size * scale * 0.1)
  const plain = props.selectable || props.adjustsFontSizeToFit
  const children = plain ? props.children : withPictures(props.children, { size, scale, drop, opacity: inherited.opacity * inherited.inkAlpha })
  return <Parent.Provider value={inherited}>
    <NativeText {...props} cssInterop={false}>{children}</NativeText>
  </Parent.Provider>
}

cssInterop(Text, { className: 'style' })
