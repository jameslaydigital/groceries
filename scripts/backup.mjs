import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'families')
const PLATFORM_DB = process.env.PLATFORM_DB || join(ROOT, 'platform.db')
const OUT = process.env.BACKUP_DIR || join(ROOT, 'backups', new Date().toISOString().replace(/[:.]/g, '-'))

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
