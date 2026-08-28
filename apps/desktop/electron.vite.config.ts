import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // Resolve the workspace source so development never depends on a stale core dist folder.
    plugins: [externalizeDepsPlugin({ exclude: ['@ego/core'] })],
    resolve: {
      alias: {
        '@ego/core': resolve(__dirname, '../../packages/core/src/index.ts')
      }
    },
    envPrefix: ['MAIN_VITE_']
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    envPrefix: ['RENDERER_VITE_', 'VITE_'],
    resolve: {
      alias: {
        '@': resolve('src/renderer'),
        '@ego/core': resolve(__dirname, '../../packages/core/src/index.ts')
      }
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
          notification: resolve(__dirname, 'src/renderer/notification.html')
        }
      }
    }
  }
})
