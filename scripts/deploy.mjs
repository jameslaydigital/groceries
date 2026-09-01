import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = process.env.SYNCART_HOST || 'syncart'

/* ---------------- arg parsing ---------------- */

const flags = { push: false, message: null }
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--push') flags.push = true
  else if (a === '-m' || a === '--message') flags.message = args[++i]
  else if (a === '--host') {
    const v = args[++i]
    if (!v) {
      console.error('--host requires a value')
      process.exit(2)
    }
    flags.host = v
  } else {
    console.error(`Unknown argument: ${a}\n\nUsage: npm run deploy [--push] [-m "message"] [--host <ssh-alias>]`)
    process.exit(2)
  }
}

/* ---------------- helpers ---------------- */

function run(cmd, cmdArgs, { cwd = ROOT } = {}) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`)
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd })
  if (r.status !== 0) {
    console.error(`\n❌ ${cmd} failed (exit ${r.status})`)
    process.exit(r.status ?? 1)
  }
  return r
}

function gitStatus() {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
  return (r.stdout || '').trim()
}

/* ---------------- commit / push ---------------- */

if (flags.message) {
  run('git', ['add', '-A'])
  run('git', ['commit', '-m', flags.message])
  flags.push = true
}

if (flags.push) {
  const dirty = gitStatus()
  if (dirty) {
    console.warn('\n⚠️  Working tree is dirty (uncommitted changes will NOT be pushed):\n' + dirty)
  }
  run('git', ['push', 'origin', 'main'])
}

/* ---------------- sync + build + restart ---------------- */

const host = flags.host || HOST
run('rsync', [
  '-az',
  '--delete',
  '--exclude', 'node_modules/',
  '--exclude', 'families/',
  '--exclude', 'platform.db*',
  '--exclude', 'backups/',
  '-e', 'ssh',
  './',
  `${host}:/opt/syncart/`,
])
run('ssh', [host, 'cd /opt/syncart && npm run build && sudo systemctl restart syncart && sleep 1 && systemctl is-active syncart'])

console.log('\n✅ Deployed to ' + host + ' — service active.')
