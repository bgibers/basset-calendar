# Order-Form Supabase Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the public order form off the legacy PHP backend so web orders land directly in Supabase, and make the yearly rollover a single admin-dashboard action instead of a code deploy.

**Architecture:** A new `POST /api/orders` route becomes the single write path for web orders: it forwards the photo to the legacy cPanel `/upload` endpoint (photos stay on cPanel), inserts the `orders` row (`source: 'web'`), and sends the admin notification email. A new `app_settings` table holds the admin-configurable `current_year`, which drives the public form's selling year (via `GET /api/dates-taken`) and the admin dashboard's year defaults. Spec: `docs/superpowers/specs/2026-08-16-order-form-supabase-port-design.md`.

**Tech Stack:** Next.js 14 App Router, Supabase (`@supabase/supabase-js` service-role client via `getSupabaseAdmin()`), nodemailer, vitest.

## Global Constraints

- Package manager is **pnpm only** — never npm or yarn.
- **No new dependencies.** If a dependency is removed (`axios`, Task 6), use `pnpm remove axios`.
- Pure logic lives in `src/lib/*.ts` with a sibling `*.test.ts`; API route files stay thin and are not unit-tested (repo convention — verified by `pnpm build` + `pnpm lint` instead).
- Server errors are logged with a `[route name]` prefix; client-facing error JSON never leaks internals (repo convention, see `src/app/api/admin/orders/route.ts`).
- `calendar_date` strings are always `YYYY-MM-DD`. Build them from the client's **local** date parts (`getFullYear`/`getMonth`/`getDate`), never `toISOString()` (UTC conversion shifts US-timezone dates to the previous day).
- Test commands: `pnpm test` (all), `pnpm test src/lib/<file>.test.ts` (single file).
- Applying the SQL migration to the live database and setting Vercel env vars are **manual ops steps** deferred to Task 8 — no task before that touches the live database schema.

---

### Task 1: `app_settings` migration + pure year helpers

**Files:**
- Create: `supabase/migrations/0002_app_settings.sql`
- Create: `src/lib/year.ts`
- Test: `src/lib/year.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveCurrentYear(stored: string | null | undefined, now?: Date): string` and `yearWindow(current: number): number[]` — used by Task 2 (settings accessors) and Task 7 (admin dropdown). Migration creates `public.app_settings (key text primary key, value text not null)` seeded with `('current_year', '2027')`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/year.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveCurrentYear, yearWindow } from '@/lib/year'

describe('resolveCurrentYear', () => {
  it('returns a valid stored 4-digit year as-is', () => {
    expect(resolveCurrentYear('2028', new Date(2026, 7, 16))).toBe('2028')
  })

  it('falls back to next calendar year when nothing is stored', () => {
    expect(resolveCurrentYear(null, new Date(2026, 7, 16))).toBe('2027')
    expect(resolveCurrentYear(undefined, new Date(2026, 7, 16))).toBe('2027')
  })

  it('falls back when the stored value is malformed', () => {
    expect(resolveCurrentYear('20x8', new Date(2026, 7, 16))).toBe('2027')
    expect(resolveCurrentYear('', new Date(2026, 7, 16))).toBe('2027')
    expect(resolveCurrentYear('28', new Date(2026, 7, 16))).toBe('2027')
  })
})

describe('yearWindow', () => {
  it('is a three-year window centered on the current year', () => {
    expect(yearWindow(2028)).toEqual([2027, 2028, 2029])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/year.test.ts`
Expected: FAIL — cannot resolve `@/lib/year`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/year.ts`:

```ts
/**
 * Pure year logic, client-safe (no Supabase import — the admin dropdown uses
 * yearWindow in a client component).
 *
 * "Current year" means the calendar year currently being sold (the dates printed on
 * the calendar), not the wall-clock year: selling the 2028 calendar during 2027
 * means current_year is 2028.
 */

/** A valid stored value wins; otherwise next calendar year (the form's old behavior). */
export function resolveCurrentYear(
  stored: string | null | undefined,
  now: Date = new Date(),
): string {
  if (stored && /^\d{4}$/.test(stored)) return stored
  return String(now.getFullYear() + 1)
}

/** Admin dropdown choices: last year's orders, this year's, and one ahead. */
export function yearWindow(current: number): number[] {
  return [current - 1, current, current + 1]
}
```

Create `supabase/migrations/0002_app_settings.sql`:

```sql
create table public.app_settings (
  key text primary key,
  value text not null
);

-- current_year = the calendar year currently being sold (dates on the calendar),
-- not the wall-clock year. Bumping it in the admin dashboard is the entire yearly
-- rollover; readers fall back to (wall-clock year + 1) if this row is missing.
insert into public.app_settings (key, value) values ('current_year', '2027');

alter table public.app_settings enable row level security;
-- no policies: anon/authenticated get nothing; service role bypasses RLS (same as orders)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/year.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0002_app_settings.sql src/lib/year.ts src/lib/year.test.ts
git commit -m "feat: app_settings table and pure current-year helpers"
```

---

### Task 2: Server settings accessors + admin settings route + year fallbacks

**Files:**
- Create: `src/lib/settings.ts`
- Create: `src/app/api/admin/settings/route.ts`
- Modify: `src/app/api/admin/orders/route.ts:19`
- Modify: `src/app/api/admin/export/csv/route.ts` (the `?? '2027'` line, around line 21)
- Modify: `src/app/api/admin/export/zip/route.ts:33`

**Interfaces:**
- Consumes: `resolveCurrentYear` from `@/lib/year` (Task 1); `getSupabaseAdmin` from `@/lib/db`; `isAdminRequest` from `@/lib/admin-auth`.
- Produces: `getCurrentYear(): Promise<string>` and `setCurrentYear(year: string): Promise<void>` in `@/lib/settings` — used by Tasks 3 and 5. `GET /api/admin/settings` → `{ current_year: string }`; `PATCH /api/admin/settings` with body `{ current_year: string }` (4-digit) → `{ current_year: string }` — used by Task 7.

- [ ] **Step 1: Create `src/lib/settings.ts`**

```ts
import { getSupabaseAdmin } from '@/lib/db'
import { resolveCurrentYear } from '@/lib/year'

/** Server-only app_settings accessors. Client-safe year logic lives in @/lib/year. */

const CURRENT_YEAR_KEY = 'current_year'

/**
 * Never throws on a missing/malformed row — every caller (public form, admin
 * defaults) is better served by the fallback year than by a 500.
 */
export async function getCurrentYear(): Promise<string> {
  const { data, error } = await getSupabaseAdmin()
    .from('app_settings')
    .select('value')
    .eq('key', CURRENT_YEAR_KEY)
    .maybeSingle()
  if (error) {
    console.error('[settings] could not read current_year:', error)
    return resolveCurrentYear(null)
  }
  return resolveCurrentYear(data?.value ?? null)
}

export async function setCurrentYear(year: string): Promise<void> {
  if (!/^\d{4}$/.test(year)) throw new Error('year must be 4 digits')
  const { error } = await getSupabaseAdmin()
    .from('app_settings')
    .upsert({ key: CURRENT_YEAR_KEY, value: year })
  if (error) throw new Error(`could not save current_year: ${error.message}`)
}
```

- [ ] **Step 2: Create `src/app/api/admin/settings/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import { getCurrentYear, setCurrentYear } from '@/lib/settings'

export const dynamic = 'force-dynamic'

/** null when the request is an authenticated admin; otherwise the response to return. */
function deny(request: NextRequest): NextResponse | null {
  let admin = false
  try {
    // isAdminRequest throws if ADMIN_COOKIE_SECRET is unset (misconfigured deployment).
    admin = isAdminRequest(request)
  } catch (err) {
    console.error('[admin settings] session verification failed:', err)
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return null
}

export async function GET(request: NextRequest) {
  const denied = deny(request)
  if (denied) return denied
  try {
    return NextResponse.json({ current_year: await getCurrentYear() })
  } catch (err) {
    console.error('[admin settings] read failed:', err)
    return NextResponse.json({ error: 'Database unavailable' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const denied = deny(request)
  if (denied) return denied
  const body = await request.json().catch(() => null)
  const year =
    typeof (body as { current_year?: unknown })?.current_year === 'string'
      ? (body as { current_year: string }).current_year.trim()
      : ''
  if (!/^\d{4}$/.test(year)) {
    return NextResponse.json({ error: 'invalid year' }, { status: 400 })
  }
  try {
    await setCurrentYear(year)
    return NextResponse.json({ current_year: year })
  } catch (err) {
    console.error('[admin settings] save failed:', err)
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Replace the three hardcoded year fallbacks**

In each of `src/app/api/admin/orders/route.ts`, `src/app/api/admin/export/csv/route.ts`, and `src/app/api/admin/export/zip/route.ts`, the line

```ts
  const year = request.nextUrl.searchParams.get('year') ?? '2027'
```

becomes

```ts
  const year = request.nextUrl.searchParams.get('year') ?? (await getCurrentYear())
```

and each file adds the import:

```ts
import { getCurrentYear } from '@/lib/settings'
```

All three call sites are already inside `async` GET handlers, so `await` is legal. The `/^\d{4}$/` validation line directly below stays unchanged.

- [ ] **Step 4: Verify**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: all existing tests pass; lint clean; build succeeds (the new route compiles).

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings.ts src/app/api/admin/settings/route.ts src/app/api/admin/orders/route.ts src/app/api/admin/export/csv/route.ts src/app/api/admin/export/zip/route.ts
git commit -m "feat: admin-configurable current year replaces hardcoded 2027 fallbacks"
```

---

### Task 3: Dates-taken grouping + public `GET /api/dates-taken`

**Files:**
- Create: `src/lib/dates-taken.ts`
- Create: `src/app/api/dates-taken/route.ts`
- Test: `src/lib/dates-taken.test.ts`

**Interfaces:**
- Consumes: `getCurrentYear` from `@/lib/settings` (Task 2); `getSupabaseAdmin` from `@/lib/db`.
- Produces: `groupDatesTaken(rows: { calendar_date: string }[]): Record<string, string[]>`; `GET /api/dates-taken` → `{ year: string, datesTaken: Record<string, string[]> }` where keys are month indexes `"1"`–`"12"` and values are day-of-month strings without leading zeros (the exact shape the form's date picker already consumes) — used by Task 6.

- [ ] **Step 1: Write the failing test**

Create `src/lib/dates-taken.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { groupDatesTaken } from '@/lib/dates-taken'

describe('groupDatesTaken', () => {
  it('groups days under 1-based month keys, stripping leading zeros', () => {
    const grouped = groupDatesTaken([
      { calendar_date: '2028-01-05' },
      { calendar_date: '2028-01-12' },
      { calendar_date: '2028-11-03' },
    ])
    expect(grouped['1']).toEqual(['5', '12'])
    expect(grouped['11']).toEqual(['3'])
  })

  it('always contains all 12 month keys, even with no orders', () => {
    const grouped = groupDatesTaken([])
    expect(Object.keys(grouped)).toHaveLength(12)
    expect(grouped['7']).toEqual([])
  })

  it('ignores rows with unparseable dates', () => {
    expect(groupDatesTaken([{ calendar_date: 'garbage' }])['1']).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/dates-taken.test.ts`
Expected: FAIL — cannot resolve `@/lib/dates-taken`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/dates-taken.ts`:

```ts
/**
 * Groups orders' calendar dates into the shape the public form's date picker
 * expects: month index ("1"–"12") -> array of day-of-month strings. All 12 keys are
 * always present so the client never needs existence checks.
 */
export function groupDatesTaken(
  rows: { calendar_date: string }[],
): Record<string, string[]> {
  const grouped: Record<string, string[]> = {}
  for (let m = 1; m <= 12; m++) grouped[String(m)] = []
  for (const row of rows) {
    const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(row.calendar_date)
    if (!match) continue
    grouped[String(Number(match[1]))].push(String(Number(match[2])))
  }
  return grouped
}
```

Create `src/app/api/dates-taken/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/db'
import { getCurrentYear } from '@/lib/settings'
import { groupDatesTaken } from '@/lib/dates-taken'

export const dynamic = 'force-dynamic'

/**
 * Public: which dates of the currently-sold calendar year are taken. Returning the
 * year here is what lets the form drop its own currentYear+1 guess — the admin-set
 * year drives both sides. Exposes no PII (dates only).
 */
export async function GET() {
  try {
    const year = await getCurrentYear()
    const { data, error } = await getSupabaseAdmin()
      .from('orders')
      .select('calendar_date')
      .gte('calendar_date', `${year}-01-01`)
      .lte('calendar_date', `${year}-12-31`)
    if (error) {
      console.error('[dates-taken] query failed:', error)
      return NextResponse.json({ error: 'Could not load dates' }, { status: 500 })
    }
    return NextResponse.json({ year, datesTaken: groupDatesTaken(data ?? []) })
  } catch (err) {
    console.error('[dates-taken] database unavailable:', err)
    return NextResponse.json({ error: 'Database unavailable' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/dates-taken.test.ts && pnpm build`
Expected: 3 tests PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dates-taken.ts src/lib/dates-taken.test.ts src/app/api/dates-taken/route.ts
git commit -m "feat: public dates-taken endpoint backed by Supabase"
```

---

### Task 4: Order submission parsing/validation/mapping

**Files:**
- Create: `src/lib/order-submit.ts`
- Test: `src/lib/order-submit.test.ts`

**Interfaces:**
- Consumes: `MONTHS` from `@/lib/months`.
- Produces (all used by Task 5's route):
  - `interface OrderSubmission { ownerName; city; state; email; dogName; isRescue: boolean; caption; standOption: '' | 'have-black' | 'have-clear' | 'order'; isFreeClaim: boolean; calendarDate: string }` (string fields unless noted)
  - `parseSubmission(fields: Record<string, string | undefined>, currentYear: string): { ok: true; value: OrderSubmission } | { ok: false; error: string }`
  - `toOrderRow(s: OrderSubmission, imageUrl: string | null): Record<string, unknown>` — insert-ready `orders` row
  - `legacyImageUrl(imageBaseUrl: string, calendarDate: string, ext: string): string`
  - `extensionForMime(type: string): string` (`image/jpeg` → `.jpg`, `image/png` → `.png`)
  - `STAND_OPTION_LABELS: Record<OrderSubmission['standOption'], string>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/order-submit.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  parseSubmission,
  toOrderRow,
  legacyImageUrl,
  extensionForMime,
} from '@/lib/order-submit'

const valid = {
  ownerName: 'Pat Smith',
  city: 'Baltimore',
  state: 'MD',
  email: 'pat@example.com',
  dogName: 'Waffles',
  isRescue: 'true',
  caption: 'Longest ears in town',
  standOption: 'order',
  isFreeClaim: 'false',
  year: '2028',
  month: '3',
  day: '5',
}

describe('parseSubmission', () => {
  it('parses a valid submission into a YYYY-MM-DD calendar date', () => {
    const result = parseSubmission(valid, '2028')
    expect(result).toMatchObject({
      ok: true,
      value: {
        ownerName: 'Pat Smith',
        isRescue: true,
        isFreeClaim: false,
        standOption: 'order',
        calendarDate: '2028-03-05',
      },
    })
  })

  it('rejects a missing required field', () => {
    const result = parseSubmission({ ...valid, email: ' ' }, '2028')
    expect(result).toEqual({ ok: false, error: 'missing field: email' })
  })

  it('rejects a malformed email', () => {
    expect(parseSubmission({ ...valid, email: 'nope' }, '2028')).toEqual({
      ok: false,
      error: 'invalid email',
    })
  })

  it('rejects an unknown stand option', () => {
    expect(parseSubmission({ ...valid, standOption: 'gold' }, '2028')).toEqual({
      ok: false,
      error: 'invalid standOption',
    })
  })

  it('allows an empty stand option (free claims skip the stand step)', () => {
    const result = parseSubmission({ ...valid, standOption: '', isFreeClaim: 'true' }, '2028')
    expect(result.ok).toBe(true)
  })

  it('rejects a year that is not the currently-sold year', () => {
    expect(parseSubmission(valid, '2027')).toEqual({ ok: false, error: 'invalid year' })
  })

  it('rejects an impossible day for the month', () => {
    expect(parseSubmission({ ...valid, month: '2', day: '30' }, '2028')).toEqual({
      ok: false,
      error: 'invalid day',
    })
    // 2028 is a leap year, so Feb 29 is fine
    expect(parseSubmission({ ...valid, month: '2', day: '29' }, '2028').ok).toBe(true)
  })
})

describe('toOrderRow', () => {
  const submission = (parseSubmission(valid, '2028') as { ok: true; value: never }).value

  it("maps the form's 'order' to the DB's 'ordered' with customer source", () => {
    const row = toOrderRow(submission, 'https://img.example/photo.jpg')
    expect(row).toMatchObject({
      calendar_date: '2028-03-05',
      owner_name: 'Pat Smith',
      dog_name: 'Waffles',
      is_rescue: true,
      stand_option: 'ordered',
      stand_option_source: 'customer',
      source: 'web',
      image_url: 'https://img.example/photo.jpg',
      thumb_url: 'https://img.example/photo.jpg',
    })
  })

  it('maps an empty stand option to nulls and a failed upload to null URLs', () => {
    const free = (
      parseSubmission({ ...valid, standOption: '', isFreeClaim: 'true' }, '2028') as {
        ok: true
        value: never
      }
    ).value
    expect(toOrderRow(free, null)).toMatchObject({
      stand_option: null,
      stand_option_source: null,
      image_url: null,
      thumb_url: null,
    })
  })
})

describe('legacyImageUrl / extensionForMime', () => {
  it('builds the migration-script path pattern', () => {
    expect(legacyImageUrl('https://example.org/calendar-images', '2028-03-05', '.jpg')).toBe(
      'https://example.org/calendar-images/2028/March/5/photo.jpg',
    )
  })

  it('maps mime types to extensions', () => {
    expect(extensionForMime('image/jpeg')).toBe('.jpg')
    expect(extensionForMime('image/png')).toBe('.png')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/order-submit.test.ts`
Expected: FAIL — cannot resolve `@/lib/order-submit`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/order-submit.ts`:

```ts
import { MONTHS } from '@/lib/months'

/**
 * Parsing, validation, and row-mapping for public order submissions. Pure — the
 * network (multipart parsing, legacy upload, Supabase insert) stays in the route
 * and src/lib/legacy-upload.ts so all of this is unit-testable.
 */

export interface OrderSubmission {
  ownerName: string
  city: string
  state: string
  email: string
  dogName: string
  isRescue: boolean
  caption: string
  standOption: '' | 'have-black' | 'have-clear' | 'order'
  isFreeClaim: boolean
  /** YYYY-MM-DD, built from the client's local date parts (never toISOString). */
  calendarDate: string
}

export const STAND_OPTION_LABELS: Record<OrderSubmission['standOption'], string> = {
  '': 'Not specified',
  'have-black': 'Already has a black acrylic stand',
  'have-clear': 'Already has a clear acrylic stand',
  order: 'Ordering a stand',
}

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
const STAND_OPTIONS: ReadonlyArray<OrderSubmission['standOption']> = [
  '',
  'have-black',
  'have-clear',
  'order',
]

/**
 * Validates the multipart fields from the public form. PayPal capture has already
 * happened when this runs, so only clearly-invalid input (tampering or a bug) is
 * rejected — in particular there is deliberately NO availability check here; the
 * admin dashboard's duplicate-date flag is the reconciliation point (see spec).
 */
export function parseSubmission(
  fields: Record<string, string | undefined>,
  currentYear: string,
): { ok: true; value: OrderSubmission } | { ok: false; error: string } {
  const get = (k: string) => (fields[k] ?? '').trim()

  for (const k of ['ownerName', 'city', 'state', 'email', 'dogName', 'caption'] as const) {
    if (!get(k)) return { ok: false, error: `missing field: ${k}` }
  }
  if (!EMAIL_RE.test(get('email'))) return { ok: false, error: 'invalid email' }

  const standOption = get('standOption') as OrderSubmission['standOption']
  if (!STAND_OPTIONS.includes(standOption)) {
    return { ok: false, error: 'invalid standOption' }
  }

  const year = get('year')
  if (year !== currentYear) return { ok: false, error: 'invalid year' }
  const month = Number(get('month'))
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, error: 'invalid month' }
  }
  const day = Number(get('day'))
  // day 0 of next month = last day of this month
  const daysInMonth = new Date(Number(year), month, 0).getDate()
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth) {
    return { ok: false, error: 'invalid day' }
  }

  return {
    ok: true,
    value: {
      ownerName: get('ownerName'),
      city: get('city'),
      state: get('state'),
      email: get('email'),
      dogName: get('dogName'),
      isRescue: get('isRescue') === 'true',
      caption: get('caption'),
      standOption,
      isFreeClaim: get('isFreeClaim') === 'true',
      calendarDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    },
  }
}

/** Insert-ready orders row. Defaults (id, stand_token, timestamps) come from the DB. */
export function toOrderRow(
  s: OrderSubmission,
  imageUrl: string | null,
): Record<string, unknown> {
  return {
    calendar_date: s.calendarDate,
    owner_name: s.ownerName,
    city: s.city,
    state: s.state,
    email: s.email,
    dog_name: s.dogName,
    is_rescue: s.isRescue,
    caption: s.caption,
    image_url: imageUrl,
    // The legacy host generates no thumbnails; the admin table lazy-loads images,
    // so the full image doubles as its own thumbnail (form caps uploads at 4 MB).
    thumb_url: imageUrl,
    stand_option:
      s.standOption === 'order' ? 'ordered' : s.standOption === '' ? null : s.standOption,
    stand_option_source: s.standOption === '' ? null : 'customer',
    source: 'web',
  }
}

/**
 * Same path pattern scripts/migrate-2027.mjs established on the legacy filesystem:
 * {base}/{year}/{Month}/{day}/photo{ext}. If the PHP endpoint turns out to save
 * under a different name (see spec "Known risk"), this is the only place to change.
 */
export function legacyImageUrl(imageBaseUrl: string, calendarDate: string, ext: string): string {
  const year = calendarDate.slice(0, 4)
  const month = MONTHS[Number(calendarDate.slice(5, 7)) - 1]
  const day = Number(calendarDate.slice(8, 10))
  return `${imageBaseUrl}/${year}/${encodeURIComponent(month)}/${day}/photo${ext}`
}

export function extensionForMime(type: string): string {
  return type === 'image/png' ? '.png' : '.jpg'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/order-submit.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/order-submit.ts src/lib/order-submit.test.ts
git commit -m "feat: order submission parsing, validation, and row mapping"
```

---

### Task 5: Legacy upload forwarder + `POST /api/orders` + delete send-email route

**Files:**
- Create: `src/lib/legacy-upload.ts`
- Create: `src/app/api/orders/route.ts`
- Delete: `src/app/api/send-email/route.ts`

**Interfaces:**
- Consumes: everything Task 4 produced; `getCurrentYear` (Task 2); `getSupabaseAdmin` from `@/lib/db`; `getTransporter` from `@/lib/mailer`; `MONTHS` from `@/lib/months`.
- Produces: `uploadPhotoToLegacy(file: File, fields: Record<string, string>, calendarDate: string): Promise<void>` (throws on failure); `POST /api/orders` accepting multipart fields `ownerName, city, state, email, dogName, isRescue, caption, standOption, isFreeClaim, year, month, day, image` → `{ success: true }` | `{ error }` with 400/500 — used by Task 6's client.

- [ ] **Step 1: Create `src/lib/legacy-upload.ts`**

```ts
import { MONTHS } from '@/lib/months'

/**
 * Forwards the customer's photo to the legacy cPanel endpoint, which remains the
 * photo store (spec decision: photos stay on cPanel). The field names and
 * {month, year, date} query params match what the old client sent, so the legacy
 * filesystem's data.txt layout stays coherent.
 *
 * Isolated in its own module so the orders route can be tested with this mocked.
 * Throws on any failure; the caller decides what a failed upload means.
 */
export async function uploadPhotoToLegacy(
  file: File,
  fields: Record<string, string>,
  calendarDate: string,
): Promise<void> {
  const base = process.env.LEGACY_UPLOAD_URL
  if (!base) throw new Error('LEGACY_UPLOAD_URL not set')

  const year = calendarDate.slice(0, 4)
  const month = MONTHS[Number(calendarDate.slice(5, 7)) - 1]
  const day = String(Number(calendarDate.slice(8, 10)))

  const body = new FormData()
  for (const [key, value] of Object.entries(fields)) body.append(key, value)
  body.append('image', file)

  const params = new URLSearchParams({ month, year, date: day })
  const res = await fetch(`${base}/upload?${params}`, { method: 'POST', body })
  if (!res.ok) throw new Error(`legacy upload failed: HTTP ${res.status}`)
}
```

- [ ] **Step 2: Create `src/app/api/orders/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/db'
import { getCurrentYear } from '@/lib/settings'
import { getTransporter } from '@/lib/mailer'
import { uploadPhotoToLegacy } from '@/lib/legacy-upload'
import {
  parseSubmission,
  toOrderRow,
  legacyImageUrl,
  extensionForMime,
  STAND_OPTION_LABELS,
} from '@/lib/order-submit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// photo forward to cPanel + insert + SMTP can exceed the 10s default
export const maxDuration = 60

const MAX_IMAGE_BYTES = 4_000_000 // matches the form's client-side cap
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])

const FIELD_KEYS = [
  'ownerName', 'city', 'state', 'email', 'dogName', 'isRescue',
  'caption', 'standOption', 'isFreeClaim', 'year', 'month', 'day',
] as const

export async function POST(request: NextRequest) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'expected multipart form data' }, { status: 400 })
  }

  const fields: Record<string, string | undefined> = {}
  for (const key of FIELD_KEYS) {
    const value = form.get(key)
    if (typeof value === 'string') fields[key] = value
  }

  let currentYear: string
  try {
    currentYear = await getCurrentYear()
  } catch (err) {
    console.error('[orders] settings unavailable:', err)
    return NextResponse.json({ error: 'Database unavailable' }, { status: 500 })
  }

  const parsed = parseSubmission(fields, currentYear)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const s = parsed.value

  const image = form.get('image')
  if (!(image instanceof File) || !IMAGE_TYPES.has(image.type) || image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: 'image must be a JPEG or PNG up to 4 MB' },
      { status: 400 },
    )
  }

  // Photo first, but a failed upload never blocks the insert: a photo-less row is
  // visible and flagged in the admin dashboard; a lost row is invisible.
  let imageUrl: string | null = null
  try {
    await uploadPhotoToLegacy(
      image,
      {
        ownerName: s.ownerName,
        city: s.city,
        state: s.state,
        email: s.email,
        dogName: s.dogName,
        isRescue: String(s.isRescue),
        needCalendarStand: String(s.standOption === 'order'),
        standOption: s.standOption,
        caption: s.caption,
      },
      s.calendarDate,
    )
    imageUrl = legacyImageUrl(
      process.env.IMAGE_BASE_URL ?? '',
      s.calendarDate,
      extensionForMime(image.type),
    )
  } catch (err) {
    console.error('[orders] legacy photo upload failed:', err)
  }

  try {
    const { error } = await getSupabaseAdmin().from('orders').insert(toOrderRow(s, imageUrl))
    if (error) {
      console.error('[orders] insert failed:', error)
      return NextResponse.json({ error: 'Could not save order' }, { status: 500 })
    }
  } catch (err) {
    console.error('[orders] database unavailable:', err)
    return NextResponse.json({ error: 'Database unavailable' }, { status: 500 })
  }

  // Notification email (absorbed from the deleted /api/send-email route). Sent for
  // every order, free claims included. Failure logs but never fails a saved order.
  try {
    await getTransporter().sendMail({
      from: process.env.EMAIL_USER,
      to: 'barcsemail@gmail.com',
      subject: 'New order',
      text:
        'A new calendar order has been submitted. \n\n' +
        `Date: ${s.calendarDate}\n` +
        `Order type: ${s.isFreeClaim ? 'Free second-space claim' : 'Paid order'}\n` +
        `Owner Name: ${s.ownerName}\n` +
        `City: ${s.city}\n` +
        `State: ${s.state}\n` +
        `Email: ${s.email}\n` +
        `Dog Name: ${s.dogName}\n` +
        `Is Rescue: ${s.isRescue}\n` +
        `Calendar Stand: ${STAND_OPTION_LABELS[s.standOption]}\n` +
        `Caption: ${s.caption}\n` +
        (imageUrl
          ? ''
          : '\nNOTE: the photo upload to the legacy server FAILED; the order was saved without a photo.\n'),
    })
  } catch (err) {
    // nodemailer puts the server's rejection text on `response`
    const response = (err as { response?: unknown })?.response
    console.error(
      '[orders] notification email failed:',
      err,
      response ? `SMTP response: ${response}` : '',
    )
  }

  return NextResponse.json({ success: true })
}
```

- [ ] **Step 3: Delete the old email route**

```bash
git rm src/app/api/send-email/route.ts
```

(The build in the next step proves nothing else imports it; the only caller was `httpService.sendEmail`, replaced in Task 6.)

- [ ] **Step 4: Verify**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: all tests pass; lint clean; build succeeds. Note: `pnpm build` may warn about the client still calling `sendEmail` — it won't, because `sendEmail` posts by URL string, not import; the client is updated in Task 6, and until then the form is broken against a dev server. That's fine mid-plan; Tasks 5 and 6 land in the same PR/session.

- [ ] **Step 5: Commit**

```bash
git add src/lib/legacy-upload.ts src/app/api/orders/route.ts
git commit -m "feat: single-write-path POST /api/orders; absorb order notification email"
```

---

### Task 6: Client — `http-service.ts` rewrite + `page.tsx` call sites

**Files:**
- Modify: `src/lib/http-service.ts` (full rewrite)
- Modify: `src/app/page.tsx` (year derivation ~lines 45-48, `loadDatesTaken` ~82-92, `handleFreeClaimUpload` ~146-168, `handlePaymentSuccess` ~170-201)
- Possibly modify: `package.json` (remove `axios` if unused elsewhere)

**Interfaces:**
- Consumes: `GET /api/dates-taken` (Task 3) and `POST /api/orders` (Task 5).
- Produces: `httpService.getDatesTaken(): Promise<{ year: string; datesTaken: DatesTaken }>` and `httpService.submitOrder(file: File, formData: OrderFormData, date: Date, isFreeClaim: boolean): Promise<void>` (throws on failure). `page.tsx` still imports `{ DatesTaken, httpService }`.

- [ ] **Step 1: Rewrite `src/lib/http-service.ts`**

Replace the entire file with:

```ts
export interface DatesTaken {
  [key: string]: string[]
}

export interface OrderFormData {
  ownerName: string
  city: string
  state: string
  email: string
  dogName: string
  isRescue: boolean
  caption: string
  standOption: 'have-black' | 'have-clear' | 'order' | ''
}

/**
 * The form's only backend is our own API now — the legacy PHP host is reached
 * solely server-side (src/lib/legacy-upload.ts).
 */
export const httpService = {
  /** The currently-sold calendar year and its taken dates, both admin-controlled. */
  async getDatesTaken(): Promise<{ year: string; datesTaken: DatesTaken }> {
    const res = await fetch('/api/dates-taken')
    if (!res.ok) throw new Error(`Failed to load dates (${res.status})`)
    return res.json()
  },

  /**
   * One call replaces the old uploadToServer + sendEmail pair. Sends local date
   * parts (year/month/day), never an ISO string — UTC conversion would shift
   * US-timezone dates to the previous day. Throws on failure.
   */
  async submitOrder(
    file: File,
    formData: OrderFormData,
    date: Date,
    isFreeClaim: boolean,
  ): Promise<void> {
    const body = new FormData()
    body.append('ownerName', formData.ownerName)
    body.append('city', formData.city)
    body.append('state', formData.state)
    body.append('email', formData.email)
    body.append('dogName', formData.dogName)
    body.append('isRescue', String(formData.isRescue))
    body.append('caption', formData.caption)
    body.append('standOption', formData.standOption)
    body.append('isFreeClaim', String(isFreeClaim))
    body.append('year', String(date.getFullYear()))
    body.append('month', String(date.getMonth() + 1))
    body.append('day', String(date.getDate()))
    body.append('image', file)

    const res = await fetch('/api/orders', { method: 'POST', body })
    if (!res.ok) {
      const payload = await res.json().catch(() => null)
      throw new Error(payload?.error ?? `Order submission failed (${res.status})`)
    }
  },
}
```

- [ ] **Step 2: Update `src/app/page.tsx`**

Four edits (leave everything else — PayPal, pricing, free-claim UI — untouched):

**(a)** Add server-driven year state and derive the picker bounds from it. Replace

```ts
  const currentYear = new Date().getFullYear()
  const yearForSelecting = (currentYear + 1).toString()
  const minDate = new Date(currentYear + 1, 0, 1)
  const maxDate = new Date(currentYear + 1, 11, 31)
```

with

```ts
  // Admin-set selling year from /api/dates-taken; fallback matches the old
  // currentYear+1 behavior until the first load completes.
  const [sellingYear, setSellingYear] = useState<number>(new Date().getFullYear() + 1)
  const yearForSelecting = sellingYear.toString()
  const minDate = new Date(sellingYear, 0, 1)
  const maxDate = new Date(sellingYear, 11, 31)
```

**(b)** Replace the body of `loadDatesTaken`:

```ts
  const loadDatesTaken = async () => {
    setLoading(true)
    try {
      const { year, datesTaken } = await httpService.getDatesTaken()
      setSellingYear(Number(year))
      setDatesTaken(datesTaken)
    } catch (error) {
      console.error('Error loading dates:', error)
    } finally {
      setLoading(false)
    }
  }
```

**(c)** In `handleFreeClaimUpload`, replace

```ts
        await httpService.uploadToServer(fileValue, formData, selectedDate)
```

with

```ts
        await httpService.submitOrder(fileValue, formData, selectedDate, true)
```

**(d)** In `handlePaymentSuccess`, replace the two calls

```ts
        await httpService.uploadToServer(fileValue, formData, selectedDate)
        await loadDatesTaken()
        await httpService.sendEmail(formData, selectedDate)
```

with

```ts
        await httpService.submitOrder(fileValue, formData, selectedDate, false)
        await loadDatesTaken()
```

The sandbox short-circuit at the top of `handlePaymentSuccess` and the existing catch blocks (which show the thank-you screen regardless — preserved behavior per spec) stay as they are.

- [ ] **Step 3: Remove axios if nothing else uses it**

Run: `grep -rn "axios" src/`
Expected: no matches (the rewrite removed the only importer). If clean:

```bash
pnpm remove axios
```

If there are other importers, leave the dependency and note it in the commit message.

- [ ] **Step 4: Verify**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: all pass. Then a quick manual check: `pnpm dev`, open `http://localhost:3000` — the form loads, the date picker shows the year from `app_settings` fallback logic (2027 until the migration is applied in Task 8, since `getCurrentYear` falls back to wall-clock+1 = 2027), and taken dates from Supabase are disabled.

- [ ] **Step 5: Commit**

```bash
git add src/lib/http-service.ts src/app/page.tsx package.json pnpm-lock.yaml
git commit -m "feat: point the public order form at our API; drop the legacy PHP client"
```

---

### Task 7: Admin UI — dynamic year dropdown, Settings card, lazy thumbnails

**Files:**
- Create: `src/components/admin/SettingsCard.tsx`
- Modify: `src/components/admin/OrdersTable.tsx` (lines 21, 25, the `load` effect ~60-62, dropdown ~141-146, both `<img>` tags ~280-296)
- Modify: `src/app/admin/(protected)/page.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /api/admin/settings` (Task 2); `yearWindow` from `@/lib/year` (Task 1).
- Produces: admin dashboard UI only; nothing downstream consumes it.

- [ ] **Step 1: Make `OrdersTable` derive its years from settings**

In `src/components/admin/OrdersTable.tsx`:

Add to the imports:

```ts
import { yearWindow } from '@/lib/year'
```

Delete the constant:

```ts
const YEARS = [2026, 2027, 2028]
```

Replace

```ts
  const [year, setYear] = useState(2027)
```

with

```ts
  // null until /api/admin/settings answers; the orders load waits for it so the
  // table always opens on the admin-configured year.
  const [year, setYear] = useState<number | null>(null)
  const [yearOptions, setYearOptions] = useState<number[]>([])
```

Add a mount effect directly above the existing `useEffect(() => { void load(year) }, ...)`:

```ts
  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/settings')
      .then(res => (res.ok ? res.json() : null))
      .catch(() => null)
      .then(body => {
        if (cancelled) return
        const current = Number(body?.current_year)
        // Settings unreachable: fall back to next wall-clock year rather than a
        // dead dashboard.
        const resolved = Number.isInteger(current) ? current : new Date().getFullYear() + 1
        setYearOptions(yearWindow(resolved))
        setYear(resolved)
      })
    return () => {
      cancelled = true
    }
  }, [])
```

Change the load effect to wait for the year:

```ts
  useEffect(() => {
    if (year !== null) void load(year)
  }, [load, year])
```

In the year `<select>`, replace `{YEARS.map(y => (` with `{yearOptions.map(y => (` and change the select's `value={year}` to `value={year ?? ''}`.

In the CSV/ZIP export `href`s and the two `onSent={() => void load(year)}` / retry `load(year)` call sites, `year` may now be null; TypeScript will point at each one. Guard the whole controls block instead of each site: wrap the Exports card, StandEmailPanel, and Orders card in the existing JSX with `{year !== null && (...)}` is invasive — simpler and sufficient: at the top of the returned JSX add an early return before the main `return`:

```ts
  if (year === null) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <p className="py-12 text-center text-gray-500">Loading settings…</p>
      </section>
    )
  }
```

After this early return, `year` narrows to `number` for the whole render body, so no other call site changes.

- [ ] **Step 2: Lazy-load the thumbnails**

Web orders have `thumb_url = image_url` (full-size images up to 4 MB), so both `<img>` tags in the photo cell get `loading="lazy"`:

```tsx
                            <img
                              src={o.thumb_url}
                              alt={o.dog_name}
                              width={48}
                              height={48}
                              loading="lazy"
                              className="rounded ring-1 ring-gray-200"
                            />
```

(Apply to both the linked and unlinked variants.)

- [ ] **Step 3: Create `src/components/admin/SettingsCard.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'

/**
 * The one yearly admin action: bump the calendar year being sold. Saving reloads
 * the page so the orders table re-reads the setting — a full reload is fine for a
 * once-a-year operation and avoids coupling this card to OrdersTable's state.
 */
export default function SettingsCard() {
  const [year, setYear] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/settings')
      .then(async res => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        const body = await res.json()
        if (!cancelled) {
          setYear(String(body.current_year ?? ''))
          setStatus('ready')
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load settings')
          setStatus('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function save() {
    setStatus('saving')
    setError('')
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_year: year.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
      setStatus('ready')
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">Settings</h2>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="font-medium text-gray-700">
          Calendar year being sold{' '}
          <input
            value={year}
            onChange={e => setYear(e.target.value)}
            disabled={status === 'loading' || status === 'saving'}
            inputMode="numeric"
            className="ml-1 w-20 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          onClick={() => void save()}
          disabled={status !== 'ready' || !/^\d{4}$/.test(year.trim())}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
        >
          Save
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Controls which year the public order form sells and the default year across
        this dashboard. Bumping this once a year is the entire rollover.
      </p>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  )
}
```

- [ ] **Step 4: Add the card to the admin page**

In `src/app/admin/(protected)/page.tsx`, add the import and render it between the header and the table:

```tsx
import OrdersTable from '@/components/admin/OrdersTable'
import SettingsCard from '@/components/admin/SettingsCard'
```

```tsx
        </header>

        <SettingsCard />

        {/* Export and stand-request email controls live inside OrdersTable so they follow
            the selected year. */}
        <OrdersTable />
```

- [ ] **Step 5: Verify**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: all pass. Manual: `pnpm dev`, log into `/admin` — Settings card shows the year (2027 via fallback until the migration is applied), dropdown shows the three-year window, orders load for the resolved year.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/SettingsCard.tsx src/components/admin/OrdersTable.tsx "src/app/admin/(protected)/page.tsx"
git commit -m "feat: settings-driven year dropdown, admin year setting card, lazy thumbnails"
```

---

### Task 8: Env example, final verification, ops checklist

**Files:**
- Modify: `.env.example`

**Interfaces:**
- Consumes: everything above.
- Produces: deployable state + documented manual ops steps.

- [ ] **Step 1: Document the new env var**

In `.env.example`, add below `IMAGE_BASE_URL`:

```
# Legacy cPanel endpoint that still stores order photos (POST {url}/upload).
# Server-side only.
LEGACY_UPLOAD_URL=https://example.org/fs
```

- [ ] **Step 2: Full verification**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: everything green. Also confirm the legacy host no longer appears in client code: `grep -rn "barcsebasset" src/` should match nothing.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs: add LEGACY_UPLOAD_URL to env example"
```

- [ ] **Step 4: Manual ops (requires the user — do not attempt unattended)**

These need production credentials and confirmation; present them as a checklist and walk through them with the user:

1. **Apply the migration:** run `supabase/migrations/0002_app_settings.sql` in the Supabase SQL editor (same as 0001 was applied). Verify: `select * from app_settings;` returns `current_year = 2027`.
2. **Set env vars in Vercel:** `LEGACY_UPLOAD_URL=https://www.barcsebasset-a-daycalendar.org/fs` (Production + Preview). `IMAGE_BASE_URL` already exists.
3. **Deploy.**
4. **Smoke-test the legacy path pattern (the spec's Known Risk):** submit a test order against production without paying by calling the API directly:

   ```bash
   curl -sS -X POST "https://<app-domain>/api/orders" \
     -F ownerName="Smoke Test" -F city="Testville" -F state="MD" \
     -F email="bcgiberson@gmail.com" -F dogName="Testdog" -F isRescue=false \
     -F caption="smoke test" -F standOption="" -F isFreeClaim=true \
     -F year=2027 -F month=12 -F day=31 \
     -F image=@/path/to/small-test.jpg
   ```

   Then verify, in order: (a) the row appears in the admin dashboard on Dec 31; (b) the notification email arrived; (c) **the `image_url` on the row actually resolves** — this proves the PHP endpoint saved the file where `legacyImageUrl` predicts. If the URL 404s, inspect the cPanel filesystem for the real saved path and adjust `legacyImageUrl` in `src/lib/order-submit.ts` (plus its test) to match.
5. **Clean up:** delete the smoke-test row in the Supabase dashboard (`delete from orders where owner_name = 'Smoke Test';`) and remove the test file from the cPanel tree.
6. **Full user-path smoke test:** one PayPal-sandbox order end-to-end on a preview deployment (`NEXT_PUBLIC_SANDBOX=true` skips the real upload by design — this validates the UI flow, not the write path, which step 4 covered).

---

## Self-Review Notes

- **Spec coverage:** migration + settings (Tasks 1-2), dates-taken (Task 3), submission parsing incl. `'order'`→`'ordered'` mapping and `thumb_url = image_url` (Task 4), single write path + email absorption + send-email deletion (Task 5), client port + year-from-server (Task 6), admin year window + Settings card + lazy thumbnails (Task 7), env vars + Known-Risk smoke test (Task 8). Out-of-scope items (free-claim enforcement, payment verification, storage migration) have no tasks, as specified.
- **Deliberate deviation from none:** the client sends `year`/`month`/`day` local date parts instead of the spec's single ISO `date` field — `toISOString()` shifts US-timezone dates a day backward; the spec's intent (correct `calendar_date`) requires this. Recorded in Global Constraints.
- **Type consistency check:** `OrderFormData` (Task 6) field set matches `parseSubmission`'s expected fields (Task 4) plus the date parts and `isFreeClaim` appended by `submitOrder`; `yearWindow`/`resolveCurrentYear` names consistent across Tasks 1, 2, 7; `uploadPhotoToLegacy(file, fields, calendarDate)` signature identical in Tasks 5's two files.
