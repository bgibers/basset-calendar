/**
 * One-time migration of the legacy 2027 calendar orders into Supabase.
 *
 *   node scripts/migrate-2027.mjs <sourceDir> <outDir> [--dry-run]
 *
 * <sourceDir> contains `2027/{Month}/{day}/data.txt` + one image per day-folder
 * (plus stray `2027/{Month}/{day}.data.txt` files: a second order for that date).
 * <outDir> receives the upload tree: `calendar-images/2027/{Month}/{day}/photo.<ext>`,
 * `thumb.jpg`, and `original.<ext>` for images that needed a browser-viewable copy.
 *
 * The source tree is READ-ONLY. Print masters (`photo.<ext>`) are byte-for-byte
 * copies — never recompressed or resized. Thumbnails are 400px-longest-edge JPEGs
 * made with macOS `sips`, which is also used to convert .heic/.bmp originals.
 *
 * Inserts are idempotent, keyed on (calendar_date, owner_name) among
 * source='migrated' rows, so re-running inserts nothing new.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
// Node >= 22.6 strips the types; the parser file is dependency-free on purpose.
import { parseOrderData } from '../src/lib/parse-order-data.ts'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const [sourceDir, outDir] = args.filter((a) => !a.startsWith('--'))
if (!sourceDir || !outDir) {
  console.error('usage: node scripts/migrate-2027.mjs <sourceDir> <outDir> [--dry-run]')
  process.exit(1)
}

// load .env.local then .env (existing process env wins)
for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim()
  }
}
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, IMAGE_BASE_URL } = process.env
if (!IMAGE_BASE_URL || (!dryRun && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY))) {
  console.error('missing env: need IMAGE_BASE_URL (+ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY unless --dry-run)')
  process.exit(1)
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const YEAR = 2027
// 362 day-folder data.txt files + the one stray February/11.data.txt = 363 orders;
// every day-folder but August/27 has an image, and the stray has none, so 361 photos.
const EXPECTED_ORDERS = 363
const EXPECTED_PHOTOS = 361

/** Extensions that browsers do not reliably render — we ship a JPEG copy alongside. */
const CONVERT_EXTS = new Set(['.heic', '.bmp'])
/** Field labels as they appear in data.txt — mirrors src/lib/parse-order-data.ts. */
const FIELD_LABELS = ['Owner Name', 'City', 'State', 'Email', 'Dog Name', 'IsRescue', 'Caption']

const anomalies = []
const rows = []

/** The single image in a day-folder, or null. Extra files are reported as anomalies. */
function findImage(dir, where) {
  const files = fs.readdirSync(dir).filter((f) => f !== 'data.txt' && !f.startsWith('.'))
  if (files.length === 0) return null
  if (files.length > 1) {
    anomalies.push(`MULTIPLE IMAGES: ${where} — using ${files[0]}, ignoring ${files.slice(1).join(', ')}`)
  }
  return files[0]
}

/**
 * Cross-checks parsed output against the raw file so a parser bug cannot pass
 * silently. Structural problems are reported; only a row with no identifying
 * information at all is treated as unusable.
 */
function validateParsed(raw, parsed, where) {
  const lines = raw.split('\n').map((l) => l.trim())
  for (const label of FIELD_LABELS) {
    const n = lines.filter((l) => l === label || l.startsWith(`${label} `)).length
    if (n > 1) anomalies.push(`STRUCTURAL: ${where} — field label "${label}" appears ${n}x`)
  }
  for (const label of FIELD_LABELS) {
    if (parsed.caption.split('\n').some((l) => l === label || l.startsWith(`${label} `))) {
      anomalies.push(`STRUCTURAL: ${where} — caption swallowed the "${label}" label`)
    }
  }
  const missing = FIELD_LABELS.filter(
    (label) => !lines.some((l) => l === label || l.startsWith(`${label} `)),
  )
  if (missing.length) anomalies.push(`STRUCTURAL: ${where} — no line for: ${missing.join(', ')}`)
  if (!parsed.ownerName && !parsed.dogName) {
    anomalies.push(`UNUSABLE: ${where} — empty owner_name and dog_name`)
    return false
  }
  return true
}

function processOrder(month, day, dataPath, imageDir) {
  const where = `${month} ${day}`
  let parsed
  try {
    parsed = parseOrderData(fs.readFileSync(dataPath, 'utf8'))
  } catch (err) {
    anomalies.push(`PARSE FAILED: ${where} — ${err.message}`)
    return
  }
  if (!validateParsed(fs.readFileSync(dataPath, 'utf8'), parsed, where)) return

  const dateStr = `${YEAR}-${String(MONTHS.indexOf(month) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  let imageUrl = null
  let thumbUrl = null
  const img = imageDir ? findImage(imageDir, where) : null

  if (img) {
    let ext = path.extname(img).toLowerCase()
    const dayOut = path.join(outDir, 'calendar-images', String(YEAR), month, String(day))
    let photoSrc = path.join(imageDir, img)
    if (!dryRun) {
      fs.mkdirSync(dayOut, { recursive: true })
      if (CONVERT_EXTS.has(ext)) {
        // the untouched original stays as the print master's source of truth
        fs.copyFileSync(photoSrc, path.join(dayOut, `original${ext}`))
        const converted = path.join(dayOut, 'photo.jpg')
        execFileSync('sips', ['-s', 'format', 'jpeg', photoSrc, '--out', converted])
        photoSrc = converted
        ext = '.jpg'
      } else {
        fs.copyFileSync(photoSrc, path.join(dayOut, `photo${ext}`)) // byte-for-byte
        photoSrc = path.join(dayOut, `photo${ext}`)
      }
      execFileSync('sips', ['-Z', '400', '-s', 'format', 'jpeg', photoSrc, '--out', path.join(dayOut, 'thumb.jpg')])
    } else if (CONVERT_EXTS.has(ext)) {
      ext = '.jpg'
    }
    imageUrl = `${IMAGE_BASE_URL}/${YEAR}/${encodeURIComponent(month)}/${day}/photo${ext}`
    thumbUrl = `${IMAGE_BASE_URL}/${YEAR}/${encodeURIComponent(month)}/${day}/thumb.jpg`
  } else {
    anomalies.push(`MISSING PHOTO: ${where} (${parsed.ownerName})`)
  }

  if (!parsed.email) anomalies.push(`NO EMAIL: ${where} (${parsed.ownerName})`)

  rows.push({
    calendar_date: dateStr,
    owner_name: parsed.ownerName,
    city: parsed.city,
    state: parsed.state,
    email: parsed.email,
    dog_name: parsed.dogName,
    is_rescue: parsed.isRescue,
    caption: parsed.caption,
    image_url: imageUrl,
    thumb_url: thumbUrl,
    source: 'migrated',
  })
}

if (!dryRun) {
  // shipped with the tree so the uploaded directory is not browsable
  const imagesRoot = path.join(outDir, 'calendar-images')
  fs.mkdirSync(imagesRoot, { recursive: true })
  fs.writeFileSync(path.join(imagesRoot, '.htaccess'), 'Options -Indexes\n')
}

for (const month of MONTHS) {
  const mDir = path.join(sourceDir, String(YEAR), month)
  if (!fs.existsSync(mDir)) continue
  for (const entry of fs.readdirSync(mDir).sort()) {
    if (entry.startsWith('.')) continue
    const full = path.join(mDir, entry)
    if (fs.statSync(full).isDirectory()) {
      const dataPath = path.join(full, 'data.txt')
      if (!fs.existsSync(dataPath)) {
        anomalies.push(`NO data.txt: ${month} ${entry}`)
        continue
      }
      processOrder(month, entry, dataPath, full)
    } else if (entry.endsWith('.data.txt')) {
      // stray file like February/11.data.txt — a second order for that date, no photo
      const day = entry.replace('.data.txt', '')
      anomalies.push(`STRAY FILE (2nd order for date): ${month} ${day}`)
      processOrder(month, day, full, null)
    } else {
      anomalies.push(`UNEXPECTED FILE: ${month}/${entry}`)
    }
  }
}

// duplicate-date detection (Feb 11 2027 legitimately has two orders)
const byDate = new Map()
for (const r of rows) byDate.set(r.calendar_date, (byDate.get(r.calendar_date) ?? 0) + 1)
for (const [d, n] of byDate) if (n > 1) anomalies.push(`DUPLICATE DATE: ${d} (${n} orders)`)

// duplicate idempotency keys would make re-runs re-insert forever
const keys = new Map()
for (const r of rows) {
  const k = `${r.calendar_date}|${r.owner_name}`
  keys.set(k, (keys.get(k) ?? 0) + 1)
}
for (const [k, n] of keys) if (n > 1) anomalies.push(`DUPLICATE KEY (breaks idempotency): ${k} (${n}x)`)

const withPhotos = rows.filter((r) => r.image_url).length
const countsOk = rows.length === EXPECTED_ORDERS && withPhotos === EXPECTED_PHOTOS

function report(insertedNow, skipped) {
  console.log(`parsed orders: ${rows.length} (expect ${EXPECTED_ORDERS})`)
  console.log(`with photos:   ${withPhotos} (expect ${EXPECTED_PHOTOS})`)
  if (insertedNow !== null) {
    console.log(`inserted now:  ${insertedNow}, skipped (already migrated): ${skipped}`)
  }
  console.log(`\nANOMALIES (${anomalies.length}):`)
  anomalies.forEach((a) => console.log(' -', a))
}

if (!countsOk) {
  report(null, null)
  console.error(
    `\nBLOCKED: expected ${EXPECTED_ORDERS} orders / ${EXPECTED_PHOTOS} photos, ` +
      `got ${rows.length} / ${withPhotos}. Nothing inserted.`,
  )
  process.exit(1)
}

if (dryRun) {
  report(null, null)
  console.log('\n(dry run — no inserts, no files written)')
  process.exit(0)
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const { data: existing, error: exErr } = await db
  .from('orders')
  .select('calendar_date, owner_name')
  .eq('source', 'migrated')
if (exErr) {
  console.error(exErr)
  process.exit(1)
}
const existingKeys = new Set(existing.map((r) => `${r.calendar_date}|${r.owner_name}`))
const toInsert = rows.filter((r) => !existingKeys.has(`${r.calendar_date}|${r.owner_name}`))

for (let i = 0; i < toInsert.length; i += 100) {
  const { error } = await db.from('orders').insert(toInsert.slice(i, i + 100))
  if (error) {
    console.error('INSERT FAILED:', error)
    process.exit(1)
  }
}

report(toInsert.length, rows.length - toInsert.length)
