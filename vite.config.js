import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['PORT', 'VITE_PORT'])
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: Number(env.VITE_PORT || 5173),
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${Number(env.PORT || 8787)}`,
          // Preserve the browser's host so the API can enforce same-origin writes.
          changeOrigin: false,
        },
      },
    },
  }
})
