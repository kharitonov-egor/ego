import { defineConfig } from 'vitest/config'
import { workspaceSources } from './vite.config.ts'

export default defineConfig({
  resolve: { alias: workspaceSources },
  test: {
    include: ['src/**/*.test.{ts,tsx}']
  }
})
