import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/deepseek': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/deepseek/, '/v1'),
      },
      '/api/minimax': {
        target: 'https://api.minimaxi.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/minimax/, '/v1'),
      },
    },
  },
})
