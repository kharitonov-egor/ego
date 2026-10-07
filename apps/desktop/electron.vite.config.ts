import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }

function commitHash(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().slice(0, 8)
  } catch {
    return 'unknown'
  }
}

// Resolve the workspace sources so development never depends on a stale dist folder. The dist
// folders are CommonJS, which the renderer's dev server hands to the browser untouched.
const workspaceSources = [
  { find: '@ego/core', replacement: resolve(__dirname, '../../packages/core/src/index.ts') },
  { find: /^@ego\/api-contracts$/, replacement: resolve(__dirname, '../../packages/api-contracts/src/index.ts') },
  { find: /^@ego\/local\/(.*)$/, replacement: resolve(__dirname, '../../packages/local/src/$1') },
  { find: /^@ego\/ui\/(.*)$/, replacement: resolve(__dirname, '../../packages/ui/src/$1') }
]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@ego/core', '@ego/api-contracts', '@ego/local', '@ego/ui'] })],
    resolve: {
      alias: workspaceSources
    },
    envPrefix: ['MAIN_VITE_']
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    envPrefix: ['RENDERER_VITE_', 'VITE_'],
    define: {
      __EGO_VERSION__: JSON.stringify(version),
      __EGO_COMMIT__: JSON.stringify(commitHash())
    },
    resolve: {
      alias: workspaceSources
    },
    plugins: [react()],
    css: {
      postcss: resolve(__dirname, 'postcss.config.js')
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'src/renderer/index.html'),
          'quick-add': resolve(__dirname, 'src/renderer/quick-add.html'),
          'tool-palette': resolve(__dirname, 'src/renderer/tool-palette.html'),
          notification: resolve(__dirname, 'src/renderer/notification.html')
        }
      }
    }
  }
})
