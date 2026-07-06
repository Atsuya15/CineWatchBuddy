import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Go serves static files from src/web/dist (http.Dir("../web/dist")); build there.
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Content hashes so browsers don't serve a stale cached bundle
        // after an update (otherwise index.js is cached indefinitely).
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },
  server: {
    port: 3000,
    // [TUNNEL] Dev proxy for same-origin relative API/WS paths. In production the
    // Go backend serves the built app and these routes directly (single origin).
    proxy: {
      '/ws': { target: 'http://localhost:8080', ws: true },
      '/create-room': 'http://localhost:8080',
      '/join-room': 'http://localhost:8080',
      '/rooms': 'http://localhost:8080',
      '/health': 'http://localhost:8080'
    }
  }
})
