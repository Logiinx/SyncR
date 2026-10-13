import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Makes the version from package.json available in the app as __APP_VERSION__
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
})
