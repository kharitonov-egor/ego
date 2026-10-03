/// <reference types="vite/client" />

import type { IpcApi } from '../shared/types'

declare global {
  interface Window {
    api: IpcApi
  }
  const __EGO_VERSION__: string
  const __EGO_COMMIT__: string
}
