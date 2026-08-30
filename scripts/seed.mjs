import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(process.env.DATA_DIR || join(ROOT, 'families'), { recursive: true })

const { getTenantDb, platform, DEFAULT_SUBDOMAIN } = await import('../server.js')

const subdomain = (process.argv[2] || DEFAULT_SUBDOMAIN).toLowerCase()
const clear = process.argv.includes('--clear')

const family = platform.prepare('SELECT * FROM families WHERE subdomain = ?').get(subdomain)
if (!family) {
  console.error(`Family "${subdomain}" not found. Create it first:`)
  console.error(`  npm run family -- create ${subdomain} "<Family Name>"`)
  process.exit(1)
}

const db = getTenantDb(subdomain)
if (clear) db.exec('DELETE FROM items')

const tagId = {}
for (const t of db.prepare('SELECT id, name FROM tags').all()) tagId[t.name] = t.id

// [name, quantity, category, [store tags], checked]
const SEED = [
  // Produce
  ['Avocados', '3', 'Produce', ["Trader Joe's"], false],
  ['Bananas', '1 bunch', 'Produce', ["Trader Joe's"], false],
  ['Heirloom Tomatoes', '4', 'Produce', ["Smith's"], false],
  ['Spinach', '1 bag', 'Produce', ["Trader Joe's"], false],
  ['Strawberries', '2 lb', 'Produce', ['Costco'], false],
  ['Granny Smith Apples', '3 lb', 'Produce', ['Costco'], true],
  // Dairy
  ['Whole Milk', '1 gal', 'Dairy', ["Smith's"], false],
  ['Greek Yogurt', '32 oz', 'Dairy', ['Costco'], false],
  ['Free-Range Eggs', '18', 'Dairy', ['Costco'], true],
  ['Salted Butter', '2', 'Dairy', ["Smith's"], false],
  // Bakery
  ['Sourdough Loaf', '1', 'Bakery', ["Trader Joe's"], false],
  ['Butter Croissants', '4', 'Bakery', ["Trader Joe's"], false],
  // Meat & Seafood
  ['Rotisserie Chicken', '1', 'Meat & Seafood', ['Costco'], false],
  ['Salmon Fillets', '2 lb', 'Meat & Seafood', ["Smith's"], false],
  ['Ground Beef 90/10', '2 lb', 'Meat & Seafood', ['Costco'], false],
  // Frozen
  ['Frozen Peas', '1 lb', 'Frozen', ["Smith's"], false],
  ['Pepperoni Pizza', '2', 'Frozen', ['Costco'], false],
  // Pantry
  ['Extra Virgin Olive Oil', '1 L', 'Pantry', ['Costco'], false],
  ['Spaghetti', '2', 'Pantry', ["Smith's"], true],
  ['Basmati Rice', '5 lb', 'Pantry', ['Costco'], false],
  ['Canned Black Beans', '6', 'Pantry', ['Costco'], false],
  // Snacks
  ['Tortilla Chips', '1', 'Snacks', ["Trader Joe's"], false],
  ['Raw Almonds', '1 lb', 'Snacks', ['Costco'], false],
  ['Dark Chocolate Bars', '2', 'Snacks', ["Trader Joe's"], false],
  // Beverages
  ['Coffee Beans', '1 lb', 'Beverages', ['Costco'], false],
  ['Sparkling Water', '24', 'Beverages', ['Costco'], false],
  // Household
  ['Paper Towels', '12', 'Household', ['Costco'], false],
  ['Dish Soap', '1', 'Household', ["Smith's"], false],
]

const insertItem = db.prepare('INSERT INTO items (name, quantity, category, checked) VALUES (?, ?, ?, ?)')
const insertTag = db.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)')

let count = 0
for (const [name, quantity, category, stores, checked] of SEED) {
  const info = insertItem.run(name, quantity, category, checked ? 1 : 0)
  for (const store of stores) {
    const id = tagId[store]
    if (id) insertTag.run(info.lastInsertRowid, id)
  }
  count++
}

console.log(`✅ seeded ${count} items into "${subdomain}"${clear ? ' (cleared first)' : ''}`)
console.log(`   Visit http://${subdomain}.lvh.me:${process.env.PORT || 8787} to see them`)
