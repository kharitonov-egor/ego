export function keyboardOverlap(viewTop: number, viewHeight: number, keyboardTop: number): number {
  return Math.min(viewHeight, Math.max(0, viewTop + viewHeight - keyboardTop))
}

/** Scroll only when the focused field crosses the visible bounds of its form. */
export function inputScrollDelta(inputTop: number, inputHeight: number, visibleTop: number, visibleBottom: number): number {
  const gap = 12
  const top = visibleTop + gap
  const bottom = visibleBottom - gap
  if (bottom <= top) return 0
  if (inputTop < top) return inputTop - top
  if (inputTop + inputHeight > bottom) {
    return Math.min(inputTop - top, inputTop + inputHeight - bottom)
  }
  return 0
}
