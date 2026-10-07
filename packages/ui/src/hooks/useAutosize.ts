import { useLayoutEffect, type RefObject } from 'react'

/** Grows a textarea with its text, the way the phone's multiline inputs do, up to its CSS max height. */
export function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string): void {
  useLayoutEffect(() => {
    const area = ref.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = `${area.scrollHeight + area.offsetHeight - area.clientHeight}px`
  }, [ref, value])
}
