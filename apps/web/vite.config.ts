import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url))
const { version } = JSON.parse(readFileSync(here('./package.json'), 'utf8')) as { version: string }

function commitHash(): string {
  const deployed = process.env.VERCEL_GIT_COMMIT_SHA
  if (deployed) return deployed.slice(0, 8)
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().slice(0, 8)
  } catch {
    return 'unknown'
  }
}

// The workspace packages load from source, as in the desktop app, so no dist folder can go stale.
export const workspaceSources = [
  { find: '@ego/core', replacement: here('../../packages/core/src/index.ts') },
  { find: /^@ego\/api-contracts$/, replacement: here('../../packages/api-contracts/src/index.ts') },
  { find: /^@ego\/local\/(.*)$/, replacement: here('../../packages/local/src/$1') },
  { find: /^@ego\/ui\/(.*)$/, replacement: here('../../packages/ui/src/$1') }
]

export default defineConfig({
  plugins: [react()],
  define: {
    __EGO_VERSION__: JSON.stringify(version),
    __EGO_COMMIT__: JSON.stringify(commitHash())
  },
  resolve: { alias: workspaceSources },
  // SQLite finds its .wasm file next to its own module, which pre-bundling would move.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  server: {
    port: 5173,
    strictPort: true,
    headers: { 'Service-Worker-Allowed': '/' }
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: { main: here('./index.html'), sw: here('./src/sw.ts') },
      output: {
        // The service worker must sit at the root under a fixed name to control every page.
        entryFileNames: (chunk) => chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'
      }
    }
  }
})
