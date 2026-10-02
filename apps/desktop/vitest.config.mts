import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      { find: '@ego/core', replacement: resolve(import.meta.dirname, '../../packages/core/src/index.ts') },
      { find: /^@ego\/local\/(.*)$/, replacement: resolve(import.meta.dirname, '../../packages/local/src/$1') }
    ]
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['out/**']
  }
})
