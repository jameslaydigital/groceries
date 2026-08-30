import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(OUT, { recursive: true })

/* ---------- minimal PNG encoder (RGBA, 8-bit) ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(width, height, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

/* ---------- drawing helpers ---------- */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const lerp = (a, b, t) => a + (b - a) * t

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
}

function mix(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

function roundedRectDist(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - (hw - r)
  const dy = Math.abs(y - cy) - (hh - r)
  const ox = Math.max(dx, 0)
  const oy = Math.max(dy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r
}

function segDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax
  const aby = by - ay
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby), 0, 1)
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t))
}

/* ---------- icon design ---------- */

const C1 = hex('#1fb66b')
const C2 = hex('#0b7a4a')
const CARD = hex('#ffffff')
const CHECK = hex('#0e9d5c')

function render(size, { maskable = false } = {}) {
  const s = size / 512 // scale factor
  const pixels = Buffer.alloc(size * size * 4)

  const cx = 256 * s
  const cy = 256 * s
  const cardHw = (maskable ? 150 : 168) * s
  const cardHh = cardHw
  const radius = 92 * s
  const sw = 26 * s
  const p0 = [0.24, 0.54]
  const p1 = [0.43, 0.72]
  const p2 = [0.78, 0.34]

  const cardAlpha = (d) => clamp(1.5 - d, 0, 1) // 1.5px anti-alias

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // diagonal gradient background
      const t = (x + y) / (size * 2)
      const bg = mix(C1, C2, t)

      // subtle lighter glow toward top-left
      const gd = Math.hypot(x - 0.28 * size, y - 0.22 * size)
      const glow = clamp(1 - gd / (size * 0.85), 0, 1) * 0.18
      let col = mix(bg, [255, 255, 255], glow)

      let a = 1

      // card
      const cd = roundedRectDist(x + 0.5, y + 0.5, cx, cy, cardHw, cardHh, radius)
      const ca = cardAlpha(cd)
      if (ca > 0) col = mix(col, CARD, ca)
      a *= 1

      // checkmark
      const d = Math.min(segDist(x + 0.5, y + 0.5, p0[0] * size, p0[1] * size, p1[0] * size, p1[1] * size),
        segDist(x + 0.5, y + 0.5, p1[0] * size, p1[1] * size, p2[0] * size, p2[1] * size))
      const cov = clamp(1.5 - (d - sw), 0, 1)
      if (cov > 0) col = mix(col, CHECK, cov)

      const o = (y * size + x) * 4
      pixels[o] = Math.round(col[0])
      pixels[o + 1] = Math.round(col[1])
      pixels[o + 2] = Math.round(col[2])
      pixels[o + 3] = 255
    }
  }
  return encodePNG(size, size, pixels)
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, {}],
]

for (const [file, size, opts] of targets) {
  writeFileSync(join(OUT, file), render(size, opts))
  console.log(`✓ ${file} (${size}x${size})`)
}
