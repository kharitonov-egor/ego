import { globalShortcut } from 'electron'

const registeredHotkeys = new Map<string, string>()

export function registerHotkey(
  hotkey: string,
  id: string,
  onTrigger: (id: string) => void
): boolean {
  try {
    const electronAccelerator = toElectronAccelerator(hotkey)
    if (!electronAccelerator) return false

    if (registeredHotkeys.has(hotkey)) {
      globalShortcut.unregister(electronAccelerator)
    }

    const success = globalShortcut.register(electronAccelerator, () => {
      onTrigger(id)
    })

    if (success) {
      registeredHotkeys.set(hotkey, id)
    }
    return success
  } catch (err) {
    console.error('Failed to register hotkey:', hotkey, err)
    return false
  }
}

export function unregisterHotkey(hotkey: string): void {
  try {
    const electronAccelerator = toElectronAccelerator(hotkey)
    if (electronAccelerator) {
      globalShortcut.unregister(electronAccelerator)
    }
    registeredHotkeys.delete(hotkey)
  } catch (err) {
    console.error('Failed to unregister hotkey:', hotkey, err)
  }
}

export function unregisterAll(): void {
  globalShortcut.unregisterAll()
  registeredHotkeys.clear()
}

function toElectronAccelerator(hotkey: string): string | null {
  if (!hotkey || hotkey.trim() === '') return null
  return hotkey
    .split('+')
    .map((part) => {
      const p = part.trim()
      switch (p.toLowerCase()) {
        case 'ctrl':
        case 'control':
          return 'Ctrl'
        case 'alt':
          return 'Alt'
        case 'shift':
          return 'Shift'
        case 'meta':
        case 'win':
        case 'super':
          return 'Super'
        default:
          return p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)
      }
    })
    .join('+')
}
