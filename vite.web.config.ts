import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone Vite config for previewing the renderer UI in a normal browser
// (no Electron). Used by `npm run dev:web`.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer/dev-web'),
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer')
    }
  },
  plugins: [react()],
  server: { port: 5174 }
})
