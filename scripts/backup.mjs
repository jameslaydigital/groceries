import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'families')
const PLATFORM_DB = process.env.PLATFORM_DB || join(ROOT, 'platform.db')
const backupsRoot = process.env.BACKUP_DIR || join(ROOT, 'backups')
const OUT = join(backupsRoot, new Date().toISOString().replace(/[:.]/g, '-'))
const KEEP = Number(process.env.KEEP_BACKUPS) || 30

mkdirSync(OUT, { recursive: true })

function snapshot(src, name) {
  if (!src || typeof src !== 'string') return
  const dest = join(OUT, name)
  const db = new DatabaseSync(src)
  try {
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`)
    console.log(`✓ ${name}`)
  } finally {
    db.close()
  }
}

snapshot(PLATFORM_DB, 'platform.db')
for (const f of readdirSync(DATA_DIR)) {
  if (f.endsWith('.db')) snapshot(join(DATA_DIR, f), f)
}

console.log(`✅ backup written to ${OUT}`)

// Prune old backups, keeping the newest KEEP.
const dirs = readdirSync(backupsRoot)
  .filter((d) => d !== '.')
  .map((d) => ({ name: d, path: join(backupsRoot, d) }))
  .sort((a, b) => (a.name < b.name ? 1 : -1))
for (const old of dirs.slice(KEEP)) {
  rmSync(old.path, { recursive: true, force: true })
  console.log(`🗑  pruned ${old.name}`)
}
