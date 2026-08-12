# 2027 Migration, Admin Dashboard & Stand Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the 362 file-based 2027 orders into Supabase, and build a password-protected admin dashboard where Kim can view/export orders (CSV + monthly image ZIPs), mass-email customers a personal stand-option form link, and record stand options manually.

**Architecture:** Next.js 14 App Router (existing app) + Supabase Postgres (order rows only, service-role access from server routes; RLS locked) + cPanel for image hosting (originals untouched as print masters, generated 400px thumbnails) + cPanel SMTP via nodemailer for all email. Spec: `docs/superpowers/specs/2026-08-12-admin-dashboard-design.md`.

**Tech Stack:** Next.js 14.0.3, TypeScript, Tailwind, `@supabase/supabase-js`, nodemailer 7.0.3 (existing), `archiver` (ZIPs), vitest (unit tests), macOS `sips` (migration-time image conversion — no native deps).

## Global Constraints

- Package manager is **pnpm only**; add deps with `pnpm add --save-exact`; no `^`/`~` on NEW deps (leave existing ranges alone); no package versions published <7 days ago.
- Original photos are **print masters** — never resize/recompress them; thumbnails are additional files.
- Stand option values are exactly: `have-black` | `have-clear` | `ordered`. Source values: `customer` | `admin`.
- SMTP (verified live 2026-08-12): host `barcsebasset-a-daycalendar.org`, port `465`, `secure: true`, user `order@barcsebasset-a-daycalendar.org`.
- Supabase project ref: `wbtnutelrbrefjwklcmo`. All DB access server-side via service-role key; never ship any Supabase key to the browser.
- Email failures must surface to the user/admin — never silently swallowed.
- All new secrets live in `.env.local` + Vercel env, never committed.

---

### Task 1: Project setup — deps, .npmrc, env scaffolding, vitest

**Files:**
- Create: `.npmrc`
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts + deps via pnpm commands)
- Modify: `.env.example`

**Interfaces:**
- Produces: `pnpm test` runs vitest; deps `@supabase/supabase-js`, `archiver`, `@types/archiver`, `vitest` available.

- [ ] **Step 1: Create `.npmrc`**

```
save-exact=true
minimum-release-age=10080
minimum-release-age-exclude=
```

- [ ] **Step 2: Install deps**

```bash
pnpm add --save-exact @supabase/supabase-js@2.45.4 archiver@7.0.1
pnpm add --save-exact -D vitest@1.6.0 @types/archiver@6.0.2
```

If pnpm reports a listed version is younger than 7 days (it won't — these are old), pick the newest version ≥7 days old and note it in the commit message.

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: { environment: 'node' },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
```

- [ ] **Step 4: Add test script to `package.json`** — add `"test": "vitest run"` to `scripts`.

- [ ] **Step 5: Extend `.env.example`** (placeholders only, no real values):

```
NEXT_PUBLIC_SANDBOX=true
EMAIL_USER=order@example.org
EMAIL_PASSWORD=changeme
EMAIL_HOST=example.org
EMAIL_PORT=465
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=changeme
ADMIN_PASSWORD=changeme
ADMIN_COOKIE_SECRET=changeme-64-random-chars
APP_BASE_URL=https://example.vercel.app
IMAGE_BASE_URL=https://example.org/calendar-images
```

- [ ] **Step 6: Verify** — `pnpm test` → "no test files found" exit 0 (or passes trivially); `pnpm build` still succeeds.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "chore: add pnpm config, supabase/archiver/vitest deps, env scaffolding"`

---

### Task 2: Supabase schema

**Files:**
- Create: `supabase/migrations/0001_orders.sql` (checked in for the record; applied via Supabase MCP or SQL editor)

**Interfaces:**
- Produces: table `public.orders` with columns exactly as below; all later tasks depend on these names.

- [ ] **Step 1: Write the SQL**

```sql
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  calendar_date date not null,
  owner_name text not null default '',
  city text not null default '',
  state text not null default '',
  email text not null default '',
  dog_name text not null default '',
  is_rescue boolean not null default false,
  caption text not null default '',
  image_url text,
  thumb_url text,
  stand_option text check (stand_option in ('have-black','have-clear','ordered')),
  stand_option_source text check (stand_option_source in ('customer','admin')),
  stand_token uuid not null unique default gen_random_uuid(),
  stand_emails_sent int not null default 0,
  stand_last_emailed_at timestamptz,
  source text not null check (source in ('migrated','web')),
  created_at timestamptz not null default now()
);
-- deliberately NO unique constraint on calendar_date (Feb 11 2027 has two legit rows)
create index orders_calendar_date_idx on public.orders (calendar_date);
create index orders_stand_token_idx on public.orders (stand_token);
alter table public.orders enable row level security;
-- no policies: anon/authenticated get nothing; service role bypasses RLS
```

- [ ] **Step 2: Apply it** — authenticate the Supabase MCP (`mcp__supabase__authenticate`, user completes OAuth) and apply the migration via the MCP's migration/SQL tool; fallback: user pastes the SQL into the Supabase SQL editor.

- [ ] **Step 3: Verify** — query `select count(*) from public.orders;` via MCP → returns 0. Confirm RLS shows enabled with 0 policies.

- [ ] **Step 4: Commit** — `git add supabase && git commit -m "feat: orders table schema (RLS locked, no public policies)"`

---

### Task 3: data.txt parser (TDD)

**Files:**
- Create: `src/lib/parse-order-data.ts`
- Test: `src/lib/parse-order-data.test.ts`

**Interfaces:**
- Produces: `parseOrderData(raw: string): ParsedOrder` where
  `type ParsedOrder = { ownerName: string; city: string; state: string; email: string; dogName: string; isRescue: boolean; caption: string }`.
  Throws `Error('unrecognized data.txt format')` if no known field prefix is found at all.

- [ ] **Step 1: Write failing tests** — real format: each field on an indented line `    Owner Name Hannah and Michael Young`, blank lines between, caption may span multiple lines, fields may be empty.

```ts
import { describe, it, expect } from 'vitest'
import { parseOrderData } from './parse-order-data'

const sample = `
    Owner Name Hannah and Michael Young

    City Spring Lake

    State NC

    Email hantasticgrace@yahoo.com

    Dog Name Clyde and Fred

    IsRescue true

    Caption Two peas in a pod. 
    `

describe('parseOrderData', () => {
  it('parses a standard order', () => {
    expect(parseOrderData(sample)).toEqual({
      ownerName: 'Hannah and Michael Young',
      city: 'Spring Lake',
      state: 'NC',
      email: 'hantasticgrace@yahoo.com',
      dogName: 'Clyde and Fred',
      isRescue: true,
      caption: 'Two peas in a pod.',
    })
  })

  it('handles empty email', () => {
    const s = sample.replace('Email hantasticgrace@yahoo.com', 'Email ')
    expect(parseOrderData(s).email).toBe('')
  })

  it('preserves multi-line captions', () => {
    const s = sample.replace(
      'Caption Two peas in a pod. ',
      'Caption Line one\nLine two'
    )
    expect(parseOrderData(s).caption).toBe('Line one\nLine two')
  })

  it('throws on garbage', () => {
    expect(() => parseOrderData('hello world')).toThrow('unrecognized')
  })
})
```

- [ ] **Step 2: Run** — `pnpm test` → 4 failures (module not found).

- [ ] **Step 3: Implement**

```ts
export type ParsedOrder = {
  ownerName: string; city: string; state: string; email: string
  dogName: string; isRescue: boolean; caption: string
}

const FIELDS: Array<[keyof ParsedOrder | 'isRescueRaw', string]> = [
  ['ownerName', 'Owner Name '],
  ['city', 'City '],
  ['state', 'State '],
  ['email', 'Email'],
  ['dogName', 'Dog Name '],
  ['isRescueRaw', 'IsRescue '],
  ['caption', 'Caption'],
]

export function parseOrderData(raw: string): ParsedOrder {
  const lines = raw.split('\n')
  const values: Record<string, string> = {}
  let current: string | null = null
  let matchedAny = false

  for (const line of lines) {
    const trimmed = line.trim()
    const field = FIELDS.find(([, prefix]) => trimmed.startsWith(prefix.trim()))
    // A new field starts only when the trimmed line begins with a known label
    if (field && (trimmed === field[1].trim() || trimmed.startsWith(field[1]) || trimmed === field[1].trimEnd())) {
      matchedAny = true
      current = field[0]
      values[current] = trimmed.slice(field[1].trimEnd().length).trim()
    } else if (current === 'caption' && trimmed !== '') {
      // captions are the only multi-line field
      values.caption += '\n' + trimmed
    }
  }

  if (!matchedAny) throw new Error('unrecognized data.txt format')

  return {
    ownerName: values.ownerName ?? '',
    city: values.city ?? '',
    state: values.state ?? '',
    email: values.email ?? '',
    dogName: values.dogName ?? '',
    isRescue: (values.isRescueRaw ?? '') === 'true',
    caption: (values.caption ?? '').trim(),
  }
}
```

- [ ] **Step 4: Run** — `pnpm test` → 4 pass. If the multi-line caption test fails on blank-line handling, adjust so blank lines inside a caption are preserved only between non-blank caption lines (test is authoritative).

- [ ] **Step 5: Commit** — `git commit -m "feat: parser for legacy data.txt order files"`

---

### Task 4: Migration script

**Files:**
- Create: `scripts/migrate-2027.mjs`
- Create: `src/lib/months.ts` (shared month-name list)

**Interfaces:**
- Consumes: `parseOrderData` (via a small JS re-implementation import — see Step 1 note), `orders` table.
- Produces: rows in `orders` (`source='migrated'`); an upload tree at `<out>/calendar-images/2027/{Month}/{day}/photo.<ext>` + `thumb.jpg`; a reconciliation report on stdout. Later tasks rely on `image_url`/`thumb_url` being `${IMAGE_BASE_URL}/2027/{Month}/{day}/photo.<ext>` and `.../thumb.jpg`.

- [ ] **Step 1: Create `src/lib/months.ts`**

```ts
export const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
] as const
```

- [ ] **Step 2: Write `scripts/migrate-2027.mjs`** — run with `node scripts/migrate-2027.mjs <sourceDir> <outDir>` where `<sourceDir>` contains `2027/`. Uses `sips` (macOS) for thumbnails and heic/bmp→jpeg conversion; imports the parser by transpile-free re-export: keep the parser file dependency-free and load it with `await import('../src/lib/parse-order-data.ts')` via `node --experimental-strip-types` if available, otherwise duplicate the ~40-line parser into the script with a header comment `// KEEP IN SYNC with src/lib/parse-order-data.ts`.

```js
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const [,, sourceDir, outDir] = process.argv
if (!sourceDir || !outDir) { console.error('usage: node scripts/migrate-2027.mjs <sourceDir> <outDir>'); process.exit(1) }

// load .env.local then .env
for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim()
  }
}
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, IMAGE_BASE_URL } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !IMAGE_BASE_URL) { console.error('missing env'); process.exit(1) }
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const YEAR = 2027

// --- parser: KEEP IN SYNC with src/lib/parse-order-data.ts (or import it) ---
/* paste parseOrderData here per Task 3 */

const CONVERT_EXTS = new Set(['.heic', '.bmp'])
const anomalies = []
const rows = []

function findImage(dir) {
  const files = fs.readdirSync(dir).filter(f => f !== 'data.txt' && !f.startsWith('.'))
  return files.length === 1 ? files[0] : (files.length === 0 ? null : files[0])
}

function processOrder(month, day, dataPath, imageDir) {
  const parsed = parseOrderData(fs.readFileSync(dataPath, 'utf8'))
  const dateStr = `${YEAR}-${String(MONTHS.indexOf(month) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  let imageUrl = null, thumbUrl = null
  const img = imageDir ? findImage(imageDir) : null
  if (img) {
    let ext = path.extname(img).toLowerCase()
    const dayOut = path.join(outDir, 'calendar-images', String(YEAR), month, String(day))
    fs.mkdirSync(dayOut, { recursive: true })
    let photoSrc = path.join(imageDir, img)
    if (CONVERT_EXTS.has(ext)) {
      // browser-viewable copy; ORIGINAL is also copied untouched below
      const converted = path.join(dayOut, 'photo.jpg')
      execFileSync('sips', ['-s', 'format', 'jpeg', photoSrc, '--out', converted])
      fs.copyFileSync(photoSrc, path.join(dayOut, `original${ext}`)) // print master, untouched
      photoSrc = converted; ext = '.jpg'
    } else {
      fs.copyFileSync(photoSrc, path.join(dayOut, `photo${ext}`)) // byte-for-byte
    }
    execFileSync('sips', ['-Z', '400', '-s', 'format', 'jpeg', photoSrc, '--out', path.join(dayOut, 'thumb.jpg')])
    imageUrl = `${IMAGE_BASE_URL}/${YEAR}/${encodeURIComponent(month)}/${day}/photo${ext}`
    thumbUrl = `${IMAGE_BASE_URL}/${YEAR}/${encodeURIComponent(month)}/${day}/thumb.jpg`
  } else {
    anomalies.push(`MISSING PHOTO: ${month} ${day} (${parsed.ownerName})`)
  }
  if (!parsed.email) anomalies.push(`NO EMAIL: ${month} ${day} (${parsed.ownerName})`)
  rows.push({
    calendar_date: dateStr, owner_name: parsed.ownerName, city: parsed.city,
    state: parsed.state, email: parsed.email, dog_name: parsed.dogName,
    is_rescue: parsed.isRescue, caption: parsed.caption,
    image_url: imageUrl, thumb_url: thumbUrl, source: 'migrated',
  })
}

for (const month of MONTHS) {
  const mDir = path.join(sourceDir, String(YEAR), month)
  if (!fs.existsSync(mDir)) continue
  for (const entry of fs.readdirSync(mDir)) {
    const full = path.join(mDir, entry)
    if (fs.statSync(full).isDirectory()) {
      processOrder(month, entry, path.join(full, 'data.txt'), full)
    } else if (entry.endsWith('.data.txt')) {
      // stray file like February/11.data.txt — second order for that day, no photo
      const day = entry.replace('.data.txt', '')
      anomalies.push(`STRAY FILE (2nd order for date): ${month} ${day}`)
      processOrder(month, day, full, null)
    }
  }
}

// duplicate-date detection
const seen = new Map()
for (const r of rows) seen.set(r.calendar_date, (seen.get(r.calendar_date) ?? 0) + 1)
for (const [d, n] of seen) if (n > 1) anomalies.push(`DUPLICATE DATE: ${d} (${n} orders)`)

// idempotency: skip rows already inserted
const { data: existing, error: exErr } = await db.from('orders')
  .select('calendar_date, owner_name').eq('source', 'migrated')
if (exErr) { console.error(exErr); process.exit(1) }
const existingKeys = new Set(existing.map(r => `${r.calendar_date}|${r.owner_name}`))
const toInsert = rows.filter(r => !existingKeys.has(`${r.calendar_date}|${r.owner_name}`))

if (toInsert.length) {
  const { error } = await db.from('orders').insert(toInsert)
  if (error) { console.error('INSERT FAILED:', error); process.exit(1) }
}

console.log(`parsed orders: ${rows.length} (expect 362)`)
console.log(`with photos:   ${rows.filter(r => r.image_url).length} (expect 361)`)
console.log(`inserted now:  ${toInsert.length}, skipped (already migrated): ${rows.length - toInsert.length}`)
console.log('\nANOMALIES:'); anomalies.forEach(a => console.log(' -', a))
```

- [ ] **Step 3: Dry-run against the unzipped tree** (already at the scratchpad `orders-2027/`) with a throwaway `outDir`. Expected report: `parsed orders: 362`, `with photos: 361`, anomalies listing Feb 11 stray/duplicate, Aug 27 missing photo, and every no-email order. Any parse abort = fix parser first.

- [ ] **Step 4: Real run** — `node scripts/migrate-2027.mjs <scratchpad>/orders-2027 <scratchpad>/upload-tree`. Verify in Supabase: `select count(*) from orders` → 362; `select count(*) from orders where image_url is not null` → 361; re-run script → `inserted now: 0`.

- [ ] **Step 5: Hand off upload tree** — Brendan zips `<scratchpad>/upload-tree/calendar-images` and uploads to cPanel `public_html/calendar-images/`, plus this `.htaccess` inside `calendar-images/`:

```
Options -Indexes
```

Verify one URL in a browser: `https://<domain>/calendar-images/2027/April/20/thumb.jpg`.

- [ ] **Step 6: Commit** — `git commit -m "feat: one-time 2027 order migration script"`

---

### Task 5: Server libs — Supabase client, admin session auth (TDD), types

**Files:**
- Create: `src/lib/db.ts`, `src/lib/types.ts`, `src/lib/admin-auth.ts`
- Test: `src/lib/admin-auth.test.ts`

**Interfaces:**
- Produces:
  - `db.ts`: `getSupabaseAdmin(): SupabaseClient` (server-only; throws if env missing).
  - `types.ts`: `type StandOption = 'have-black' | 'have-clear' | 'ordered'`; `interface Order { id: string; calendar_date: string; owner_name: string; city: string; state: string; email: string; dog_name: string; is_rescue: boolean; caption: string; image_url: string | null; thumb_url: string | null; stand_option: StandOption | null; stand_option_source: 'customer' | 'admin' | null; stand_token: string; stand_emails_sent: number; stand_last_emailed_at: string | null; source: 'migrated' | 'web'; created_at: string }`; `const STAND_LABELS: Record<StandOption, string>` = `{ 'have-black': 'Has black stand', 'have-clear': 'Has clear stand', 'ordered': 'Ordered a stand' }`.
  - `admin-auth.ts`: `createSessionToken(): string`, `verifySessionToken(token: string | undefined): boolean`, `SESSION_COOKIE = 'admin_session'`, and `isAdminRequest(req: NextRequest): boolean`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createSessionToken, verifySessionToken } from './admin-auth'

beforeAll(() => { process.env.ADMIN_COOKIE_SECRET = 'test-secret' })

describe('admin session tokens', () => {
  it('round-trips a valid token', () => {
    expect(verifySessionToken(createSessionToken())).toBe(true)
  })
  it('rejects tampering', () => {
    expect(verifySessionToken(createSessionToken() + 'x')).toBe(false)
  })
  it('rejects expired tokens', () => {
    const past = Date.now() - 1000
    const crypto = require('node:crypto')
    const sig = crypto.createHmac('sha256', 'test-secret').update(String(past)).digest('hex')
    expect(verifySessionToken(`${past}.${sig}`)).toBe(false)
  })
  it('rejects undefined/garbage', () => {
    expect(verifySessionToken(undefined)).toBe(false)
    expect(verifySessionToken('nope')).toBe(false)
  })
})
```

- [ ] **Step 2: Run** — fails (module missing).

- [ ] **Step 3: Implement `admin-auth.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'

export const SESSION_COOKIE = 'admin_session'
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function sign(exp: string): string {
  const secret = process.env.ADMIN_COOKIE_SECRET
  if (!secret) throw new Error('ADMIN_COOKIE_SECRET not set')
  return createHmac('sha256', secret).update(exp).digest('hex')
}

export function createSessionToken(): string {
  const exp = String(Date.now() + THIRTY_DAYS_MS)
  return `${exp}.${sign(exp)}`
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false
  const [exp, sig] = token.split('.')
  if (!exp || !sig || Number(exp) < Date.now()) return false
  const expected = sign(exp)
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

export function isAdminRequest(req: NextRequest): boolean {
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)
}
```

`db.ts`:

```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null
export function getSupabaseAdmin(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Supabase env vars not set')
    client = createClient(url, key, { auth: { persistSession: false } })
  }
  return client
}
```

`types.ts` exactly as in Interfaces above.

- [ ] **Step 4: Run** — `pnpm test` → all pass.

- [ ] **Step 5: Commit** — `git commit -m "feat: supabase admin client and signed admin session auth"`

---

### Task 6: Admin login (page + API + route-group guard)

**Files:**
- Create: `src/app/admin/login/page.tsx`, `src/app/api/admin/login/route.ts`, `src/app/admin/(protected)/layout.tsx`

**Interfaces:**
- Consumes: `createSessionToken`, `verifySessionToken`, `SESSION_COOKIE` from Task 5.
- Produces: protected route group — every page under `src/app/admin/(protected)/` redirects to `/admin/login` without a valid cookie. Later API routes each call `isAdminRequest(req)` themselves and return 401.

- [ ] **Step 1: `POST /api/admin/login`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSessionToken, SESSION_COOKIE } from '@/lib/admin-auth'

export async function POST(request: NextRequest) {
  const { password } = await request.json()
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60,
  })
  return res
}
```

- [ ] **Step 2: Guard layout `src/app/admin/(protected)/layout.tsx`**

```tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySessionToken, SESSION_COOKIE } from '@/lib/admin-auth'

export default function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  if (!verifySessionToken(cookies().get(SESSION_COOKIE)?.value)) redirect('/admin/login')
  return <>{children}</>
}
```

- [ ] **Step 3: Login page `src/app/admin/login/page.tsx`** — minimal client component: one password input + button; POSTs to `/api/admin/login`; on 200 `router.push('/admin')`; on 401 shows "Wrong password". Style with existing Tailwind classes to match the app.

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminLogin() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) router.push('/admin')
    else setError('Wrong password')
  }
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-bold">Admin login</h1>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
          className="w-full border rounded p-2" placeholder="Password" autoFocus />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button className="w-full bg-blue-600 text-white rounded p-2">Log in</button>
      </form>
    </main>
  )
}
```

- [ ] **Step 4: Placeholder protected page** `src/app/admin/(protected)/page.tsx` rendering `<h1>Dashboard</h1>` (replaced in Task 7).

- [ ] **Step 5: Verify manually** — set `ADMIN_PASSWORD`/`ADMIN_COOKIE_SECRET` in `.env.local`; `pnpm dev`; `/admin` unauthenticated → redirected to `/admin/login`; wrong password → error; right password → dashboard placeholder.

- [ ] **Step 6: Commit** — `git commit -m "feat: admin login with signed session cookie and protected route group"`

---

### Task 7: Orders API + dashboard table with filters and inline stand editing

**Files:**
- Create: `src/app/api/admin/orders/route.ts` (GET list), `src/app/api/admin/orders/[id]/route.ts` (PATCH), `src/app/admin/(protected)/page.tsx` (replace placeholder), `src/components/admin/OrdersTable.tsx`

**Interfaces:**
- Consumes: `getSupabaseAdmin`, `isAdminRequest`, `Order`, `StandOption`, `STAND_LABELS`, `MONTHS`.
- Produces:
  - `GET /api/admin/orders?year=2027` → `{ orders: Order[] }` sorted by `calendar_date`, 401 if not admin.
  - `PATCH /api/admin/orders/:id` body `{ stand_option: StandOption | null }` → `{ order: Order }`; sets `stand_option_source` to `'admin'` (or null when clearing), 401/404 accordingly.

- [ ] **Step 1: GET route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const year = request.nextUrl.searchParams.get('year') ?? '2027'
  const { data, error } = await getSupabaseAdmin()
    .from('orders').select('*')
    .gte('calendar_date', `${year}-01-01`).lte('calendar_date', `${year}-12-31`)
    .order('calendar_date')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ orders: data })
}
```

- [ ] **Step 2: PATCH route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'

const VALID = ['have-black', 'have-clear', 'ordered', null]

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { stand_option } = await request.json()
  if (!VALID.includes(stand_option)) return NextResponse.json({ error: 'invalid stand_option' }, { status: 400 })
  const { data, error } = await getSupabaseAdmin()
    .from('orders')
    .update({ stand_option, stand_option_source: stand_option ? 'admin' : null })
    .eq('id', params.id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ order: data })
}
```

- [ ] **Step 3: `OrdersTable.tsx`** (client component). Props: none; fetches `/api/admin/orders?year=` on mount and year change. Features — all client-side:
  - Year selector (default 2027), count of orders shown.
  - Filter pills: `All` / `Missing stand option` (`stand_option === null`) / `No email` (`email === ''`) / `Flagged` (duplicate `calendar_date` within the loaded set, or `image_url === null`).
  - Columns: Date · Photo (thumb `<img src={thumb_url}>` 48px, links to `image_url`) · Owner · Dog · Email · City/State · Rescue (✓) · Caption (truncated, title-attr full) · Stand option `<select>` (blank/3 options; on change PATCH, optimistic update, revert + alert on failure; show `(customer)` or `(admin)` tag from `stand_option_source`) · Nudges (`stand_emails_sent` + date).
  - Rows with anomalies get a yellow background and a "⚠ duplicate date" / "⚠ no photo" badge.
- [ ] **Step 4: Wire `(protected)/page.tsx`** to render `<OrdersTable />` plus header with an "Export" section placeholder (filled Task 8) and "Email" section placeholder (Task 9/10).
- [ ] **Step 5: Verify manually** — with 362 migrated rows: table loads, filters count correctly (Feb 11 duplicate → Flagged shows ≥3 rows: 2 duplicates + Aug 27), changing a stand option persists across reload and shows `(admin)`.
- [ ] **Step 6: Commit** — `git commit -m "feat: admin orders API and dashboard table with filters and inline stand editing"`

---

### Task 8: Exports — CSV and monthly image ZIP

**Files:**
- Create: `src/app/api/admin/export/csv/route.ts`, `src/app/api/admin/export/zip/route.ts`, `src/lib/csv.ts`
- Test: `src/lib/csv.test.ts`
- Modify: `src/app/admin/(protected)/page.tsx` + `src/components/admin/OrdersTable.tsx` (export buttons)

**Interfaces:**
- Consumes: orders GET query pattern from Task 7; `MONTHS`.
- Produces:
  - `toCsv(rows: Record<string, unknown>[]): string` — header from keys of first row; RFC-4180 quoting (quote fields containing `"`, `,`, `\n`; double inner quotes).
  - `GET /api/admin/export/csv?year=2027` → `text/csv` attachment `orders-2027.csv`, all Order columns.
  - `GET /api/admin/export/zip?year=2027&month=March` → `application/zip` attachment `orders-2027-March.zip` containing each order's ORIGINAL image named `March-14-Biscuit.jpg` (date + sanitized dog name + original extension).

- [ ] **Step 1: CSV helper TDD** — tests: quotes commas/quotes/newlines, empty rows → `''`. Then implement (~15 lines). Run, pass.
- [ ] **Step 2: CSV route** — query same as Task 7 GET; `toCsv(data)`; respond with headers `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="orders-${year}.csv"`. 401 guard first.
- [ ] **Step 3: ZIP route** — 401 guard; validate `month` ∈ MONTHS; query orders for that month with `image_url not null`; for each, `fetch(image_url)`, on !ok collect into `missing[]`; append `Buffer.from(await res.arrayBuffer())` to an `archiver('zip')` instance as `${month}-${day}-${dogName.replace(/[^a-zA-Z0-9-]+/g, '')}.${ext}`; also append `manifest.txt` listing every included file and any `missing` entries; stream archive as the response body (convert Node stream via `ReadableStream` wrapper / `stream.Readable.toWeb`). If any image is missing, the manifest says so explicitly — never a silently short archive. Set `export const maxDuration = 300`.
- [ ] **Step 4: Buttons in dashboard** — "Download CSV (year)" link + month dropdown with "Download photos ZIP". Plain `<a href>` links to the routes (cookie rides along).
- [ ] **Step 5: Verify** — download CSV, open, spot-check row count 362 & special chars; download `February` ZIP, confirm ~28 files incl. both Feb-11 handling (one photo + manifest noting Mary Webb has none... her row has no image so simply absent + noted), file names correct.
- [ ] **Step 6: Commit** — `git commit -m "feat: CSV and monthly photo ZIP exports"`

---

### Task 9: Public stand form — `/stand/[token]`

**Files:**
- Create: `src/app/api/stand/[token]/route.ts` (GET + POST), `src/app/stand/[token]/page.tsx`, `src/components/StandForm.tsx`

**Interfaces:**
- Consumes: `getSupabaseAdmin`, `StandOption`, stand images `src/assets/stand-black.jpg` / `stand-clear.jpg` (existing).
- Produces:
  - `GET /api/stand/:token` → `{ dogName, ownerName, calendarDate, standOption }` or 404 `{ error: 'not found' }`.
  - `POST /api/stand/:token` body `{ standOption: StandOption }` → `{ ok: true }`; sets `stand_option_source='customer'`; 400 on invalid value; 404 on bad token.

- [ ] **Step 1: API route** — both handlers look up `.eq('stand_token', params.token)`. Token strings that aren't UUIDs must 404, not 500 (wrap the query; Postgres uuid cast error → return 404).

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/db'

const VALID = ['have-black', 'have-clear', 'ordered']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function findOrder(token: string) {
  if (!UUID_RE.test(token)) return null
  const { data } = await getSupabaseAdmin().from('orders').select('*').eq('stand_token', token).maybeSingle()
  return data
}

export async function GET(_: NextRequest, { params }: { params: { token: string } }) {
  const order = await findOrder(params.token)
  if (!order) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({
    dogName: order.dog_name, ownerName: order.owner_name,
    calendarDate: order.calendar_date, standOption: order.stand_option,
  })
}

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const { standOption } = await request.json()
  if (!VALID.includes(standOption)) return NextResponse.json({ error: 'invalid option' }, { status: 400 })
  const order = await findOrder(params.token)
  if (!order) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const { error } = await getSupabaseAdmin().from('orders')
    .update({ stand_option: standOption, stand_option_source: 'customer' })
    .eq('id', order.id)
  if (error) return NextResponse.json({ error: 'Could not save, please try again' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Page + form** — server page fetches via GET (absolute URL from `APP_BASE_URL` or call `findOrder` directly server-side — prefer direct call, no self-fetch); invalid token renders a friendly "This link doesn't look right — please email barcsemail@gmail.com" page. Valid: renders `<StandForm>` (client) with the three radio options styled like the existing order form (reuse the radio+image pattern from `src/app/page.tsx:448-497`), preselecting any saved answer, header "**{dogName}** — {Month} {day}, 2027". Submit POSTs; success state: "Thanks! Your answer is saved. You can change it any time with this same link." Failure: inline error + retry.
- [ ] **Step 3: Verify** — grab a real `stand_token` from the DB, open `/stand/<token>` in dev, submit each option, confirm row updates with `source='customer'` and dashboard shows the `(customer)` tag; garbage token → friendly 404 page.
- [ ] **Step 4: Commit** — `git commit -m "feat: tokenized public stand-option form"`

---

### Task 10: Email — shared mailer, mass stand-request sending with batching UI

**Files:**
- Create: `src/lib/mailer.ts`, `src/lib/stand-email.ts`, `src/app/api/admin/send-stand-emails/route.ts`, `src/components/admin/StandEmailPanel.tsx`
- Modify: `src/app/api/send-email/route.ts` (use env host/port + shared mailer), `src/app/admin/(protected)/page.tsx`

**Interfaces:**
- Consumes: verified SMTP settings (Global Constraints), orders table, `APP_BASE_URL`.
- Produces:
  - `mailer.ts`: `getTransporter()` — nodemailer transport from `EMAIL_HOST`/`EMAIL_PORT` (secure when port 465)/`EMAIL_USER`/`EMAIL_PASSWORD`.
  - `stand-email.ts`: `standEmailText(order): string` and `STAND_EMAIL_SUBJECT`.
  - `POST /api/admin/send-stand-emails` body `{ batchSize?: number }` (default 25, max 50) → `{ sent: number, remaining: number, failures: Array<{ email: string, error: string }> }`. Targets `stand_option IS NULL AND email <> ''`, ordered by `stand_last_emailed_at` nulls-first then `calendar_date`; increments `stand_emails_sent`, sets `stand_last_emailed_at` per accepted send.

- [ ] **Step 1: `mailer.ts`**

```ts
import nodemailer from 'nodemailer'

export function getTransporter() {
  const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD } = process.env
  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASSWORD) throw new Error('email env vars not set')
  const port = Number(EMAIL_PORT ?? 465)
  return nodemailer.createTransport({
    host: EMAIL_HOST, port, secure: port === 465,
    auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD },
  })
}
```

- [ ] **Step 2: `stand-email.ts`** — draft copy (Kim/Brendan can edit this file before sending):

```ts
import type { Order } from './types'

export const STAND_EMAIL_SUBJECT = 'Your Basset-a-Day calendar — one quick question'

export function standEmailText(order: Order): string {
  const link = `${process.env.APP_BASE_URL}/stand/${order.stand_token}`
  const date = new Date(order.calendar_date + 'T00:00:00')
    .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  return `Hi ${order.owner_name},

Thank you for ordering a spot in the BARCS Basset-a-Day calendar — ${order.dog_name} is featured on ${date}!

Due to a technical mixup on our end, we didn't record which calendar stand you have. The hole-punch placement is different for the black and clear acrylic stands, so we need to know before printing.

Could you take 10 seconds to tell us here?

${link}

That link is personal to your order — no login needed. If anything looks wrong, just reply to this email.

Thank you!
BARCS Basset-a-Day Calendar`
}
```

- [ ] **Step 3: Send route** — guard 401; fetch batch; loop `await transporter.sendMail({ from: EMAIL_USER, replyTo: 'barcsemail@gmail.com', to, subject, text })` sequentially with a 500 ms delay between sends; on success update the row counters; on failure push to `failures` (do NOT increment); after loop, count remaining eligible and return. `export const maxDuration = 60`.
- [ ] **Step 4: `StandEmailPanel.tsx`** — shows live count of eligible recipients (`stand_option === null && email !== ''` from the loaded orders), a preview of the email (rendered from a sample order via a `GET`-less client copy of the template or a small preview endpoint — simplest: render the template text with placeholder values inline in the component, matching `stand-email.ts` copy), a "Send to N people" button → confirm dialog → loops POSTing batches until `remaining === 0` or a batch reports failures; progress bar `sent/total`; failures listed with emails + errors. Button label switches to "Send follow-up to N people" when every eligible row has `stand_emails_sent > 0`.
- [ ] **Step 5: Update `send-email/route.ts`** — replace the hardcoded transport with `getTransporter()`; keep behavior otherwise; failures now `return 500` (already does) — additionally `console.error` includes the SMTP response.
- [ ] **Step 6: Verify with a safety net** — temporarily set both test rows' emails: pick 2 real orders in Supabase, note their emails, overwrite with `bcgiberson@gmail.com` / `brendan@kintsu.xyz`, press Send with batchSize 2, confirm both arrive with working personal links, then restore the original emails via SQL. Submit one stand option through a received link end-to-end.
- [ ] **Step 7: Commit** — `git commit -m "feat: mass stand-request emails with batching, and env-based SMTP everywhere"`

---

### Task 11: Deploy + production verification

**Files:** none (config + ops)

- [ ] **Step 1: Set Vercel env vars** (production): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD` (fresh strong value for Kim), `ADMIN_COOKIE_SECRET` (`openssl rand -hex 32`), `EMAIL_HOST=barcsebasset-a-daycalendar.org`, `EMAIL_PORT=465`, `EMAIL_USER`, `EMAIL_PASSWORD`, `APP_BASE_URL=<prod url>`, `IMAGE_BASE_URL=https://www.barcsebasset-a-daycalendar.org/calendar-images`.
- [ ] **Step 2: Deploy** — `git push` (or `vercel deploy --prod` per repo habit).
- [ ] **Step 3: Production smoke test** — `/admin` login works over HTTPS; table shows 362; CSV downloads; one monthly ZIP downloads; one `/stand/<token>` link renders; send-stand-emails to the 2-address test group (same safety-net trick as Task 10 Step 6) works in prod.
- [ ] **Step 4: Check cPanel Email Deliverability page** — SPF + DKIM show "Valid" for the domain; if not, click repair and re-send one test to Gmail confirming inbox placement.
- [ ] **Step 5: Hand off to Kim** — share `/admin` URL + password; walk through: filters, check-off dropdown, exports, the send button (and that pressing it again later only emails non-responders).
- [ ] **Step 6: Commit any doc tweaks; done.**

---

## Self-review notes

- Spec coverage: schema→T2, migration+anomalies+thumbnails→T4, stand form→T9, admin auth→T5/6, table+filters+inline edit→T7, CSV/ZIP/per-order download (thumb links to original; ZIP+CSV)→T7/8, mass email+follow-up+failure surfacing→T10, SMTP env fix for existing route→T10, deploy/SPF→T11. Phase-2 items (order-form port) intentionally absent per spec.
- Types/names cross-checked: `Order`, `StandOption`, `STAND_LABELS`, `getSupabaseAdmin`, `isAdminRequest`, `SESSION_COOKIE`, `MONTHS` used consistently.
- Vitest covers pure logic (parser, auth tokens, CSV); routes verified by scripted manual checks — the app has no test harness today and route-handler integration tests would need more scaffolding than the payoff justifies (accepted trade-off).
