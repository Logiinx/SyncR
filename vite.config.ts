import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'))

// Builds dist/sw.js from src/sw.js, with the list of all app files to keep on the phone.
// The version changes whenever a file changes, so phones notice there's a new version.
function serviceWorker(): Plugin {
  return {
    name: 'syncr-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const publicFiles = readdirSync('public', { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => `${entry.parentPath}/${entry.name}`.replace(/\\/g, '/').replace(/^public\//, ''))
      // index.html is written after this step, so it's added by hand
      const files = [...new Set(['index.html', ...Object.keys(bundle), ...publicFiles])].sort()
      const template = readFileSync('src/sw.js', 'utf8')
      const hash = createHash('sha256').update(template)
      for (const file of publicFiles) hash.update(file).update(readFileSync(`public/${file}`))
      hash.update(files.join('\n')).update(version)
      const source = template
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__FILES__', JSON.stringify(files))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serviceWorker()],
  // Makes the version from package.json available in the app as __APP_VERSION__
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  // Dev server only: check files for changes regularly. The normal file watcher
  // sometimes missed edits on Windows and served old code.
  server: {
    watch: { usePolling: true, interval: 300 },
  },
})
