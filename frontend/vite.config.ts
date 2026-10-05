import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Dev only: forward /api to the FastAPI backend (see backend/).
      // In production Nginx serves /api to the same origin. API_PROXY_TARGET
      // points a second checkout at a backend of its own.
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
