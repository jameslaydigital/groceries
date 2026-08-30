import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const bin = (name) => join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name)

// Backend (API on :8787) + Vite dev server (on :5173, proxying /rpc & /events).
const backend = spawn('node', [join(ROOT, 'server.js')], { stdio: 'inherit' })
backend.on('exit', (code) => {
  if (code && code !== 0) {
    console.log('\n⚠️  Backend on :8787 exited — is another server already running there?')
    console.log('   If so, ignore this; the Vite proxy will use the existing one.\n')
  }
})

const vite = spawn(bin('vite'), [], { stdio: 'inherit' })
vite.on('error', (e) => {
  console.error('Failed to start Vite:', e.message)
  backend.kill()
  process.exit(1)
})

const shutdown = () => {
  backend.kill()
  vite.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
