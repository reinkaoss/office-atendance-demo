import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tech demo: always runs on the in-memory sample data (src/lib/demo.js).
// No backend, no sign-in. Not the live project.
export default defineConfig({
  plugins: [react()],
  base: './',
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify('1') },
})
