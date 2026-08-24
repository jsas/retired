import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// base: the app is served from a project path on GitHub Pages
// (https://jsas.github.io/retirement-web-app/). Locally `npm run dev` still
// works — Vite only applies base to the build output paths.
export default defineConfig({
  base: '/retirement-web-app/',
  plugins: [react()],
})
