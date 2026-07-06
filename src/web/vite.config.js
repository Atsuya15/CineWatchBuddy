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
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
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
