import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        // Owner-only admin panel (Release 2): a separate entry served at
        // /admin.html. All privileged work happens in Supabase Edge
        // Functions that verify the admin role server-side; this page is
        // only a window, never a key.
        admin: 'admin.html',
      },
    },
  },
})
