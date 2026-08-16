# Order-form Supabase port — design

**Date:** 2026-08-16
**Goal:** Make the calendar system self-managing across years. After this work, a new
calendar year requires exactly one admin action (bumping a year setting in the
dashboard) — no migration script, no code deploy, no developer.

## Background

The public order form (`src/app/page.tsx` + `src/lib/http-service.ts`) still writes
orders to the legacy PHP/cPanel backend at
`https://www.barcsebasset-a-daycalendar.org/fs` (`/datestaken` for availability,
`/upload` for the photo + form fields). Web submissions never reach Supabase, so each
year someone must hand-run `scripts/migrate-2027.mjs` to import that year's orders
into the admin dashboard. Separately, the dashboard hardcodes years
(`YEARS = [2026, 2027, 2028]` in `OrdersTable.tsx`; `?? '2027'` fallbacks in three
admin API routes), so even the dashboard needs a code change each year.

## Decisions (made during brainstorming)

- **Photos stay on cPanel.** New uploads continue to land on the legacy host; only the
  order *record* moves to Supabase. (User chose this over Supabase Storage.)
- **Year selection is an admin-configurable setting**, not derived from data. (User
  chose this over deriving years from the orders table.)
- **Approach A: proxy through one API route.** The form posts everything to a new
  `POST /api/orders`, which forwards the photo to cPanel and inserts the Supabase row
  server-side. One write path, one place to handle partial failure. (User approved
  over client-side dual-write.)
- **PayPal checkout, pricing, and the client-only free-claim flow are unchanged.**
  Only the destination of order data and the availability lookup change.

## Architecture

```
Public form (page.tsx)
  ├─ GET  /api/dates-taken        → reads app_settings.current_year + orders table
  └─ POST /api/orders (multipart) ─┬─ forward photo → legacy cPanel /upload
                                   ├─ insert orders row (source: 'web')
                                   └─ send admin notification email

Admin dashboard
  ├─ GET/PATCH /api/admin/settings → app_settings.current_year
  └─ admin/orders, export/csv, export/zip → year fallback from app_settings
```

The legacy `/datestaken` endpoint is no longer called by anything. The legacy
`/upload` endpoint remains the photo store.

## Database

New migration `supabase/migrations/0002_app_settings.sql`:

```sql
create table public.app_settings (
  key text primary key,
  value text not null
);
insert into public.app_settings (key, value) values ('current_year', '2027');
alter table public.app_settings enable row level security;
-- no policies: same service-role-only pattern as orders
```

`current_year` means **the calendar year currently being sold** (dates printed on the
calendar), not the wall-clock year. Selling the 2028 calendar during 2027 means
`current_year = '2028'`.

Fallback: if the row is missing, every reader falls back to
`new Date().getFullYear() + 1` (the current form behavior) rather than erroring.

## API routes

### `POST /api/orders` (new, public)

Accepts multipart form data: `ownerName`, `city`, `state`, `email`, `dogName`,
`isRescue`, `caption`, `standOption`, `isFreeClaim`, `date` (ISO), `image` (file).

1. **Validate** server-side: required fields present, email format, date parses and
   falls within `current_year`, image is `image/png` or `image/jpeg` and ≤ 4 MB.
   Reject with 400 otherwise.
2. **Forward the photo** to `${LEGACY_UPLOAD_URL}/upload` with the same multipart
   fields and `{month, year, date}` query params the client sends today. The base URL
   moves from a hardcoded constant in `http-service.ts` to a `LEGACY_UPLOAD_URL` env
   var. This call lives in its own module (`src/lib/legacy-upload.ts`) so tests can
   mock it.
3. **Compute URLs.** `image_url` follows the same path pattern the migration script
   established: `${IMAGE_BASE_URL}/{year}/{Month}/{day}/photo{ext}`.
   `thumb_url = image_url` — the legacy endpoint generates no thumbnails, and a
   server-side thumbnail pipeline is not worth building for ≤ 4 MB images (see
   Admin dashboard changes for the lazy-loading mitigation). If the cPanel upload
   fails, insert the row anyway with `image_url`/`thumb_url` null.
4. **Insert the orders row**: `source: 'web'`; `stand_option` mapped from form values
   (`'order'` → `'ordered'`, `''` → `null`); `stand_option_source: 'customer'` when a
   stand option was given, else null. All other columns from the form fields.
5. **Send the admin notification email** (logic moved from `/api/send-email`, which
   is deleted). Sent for every order — free claims included, labeled as such in the
   body — rather than today's paid-only behavior, so the admin inbox reflects
   everything. Email failure does not fail the request; it is logged.

Ordering of failures: the insert is attempted even if the upload fails (a photo-less
row is visible and flagged in the dashboard; a lost row is invisible). If the insert
itself fails, return 500 and log loudly — same net behavior as today, where the
client swallows errors, but now discoverable in Vercel logs.

**No availability check at submit.** PayPal capture happens before this route is
called, so rejecting a just-taken date would strand a paid customer. The dashboard's
existing duplicate-date flag is the reconciliation point. (The orders table
deliberately has no unique constraint on `calendar_date`.)

### `GET /api/dates-taken` (new, public)

No parameters. Reads `current_year` from `app_settings`, queries `orders` for that
year, and returns:

```json
{ "year": "2028", "datesTaken": { "1": ["5", "12"], "2": [], ... } }
```

`datesTaken` keeps the exact shape `http-service.ts` already expects (month index →
array of day-of-month strings). Returning the year here is what lets the public form
drop its `currentYear + 1` computation — the admin-set year drives both sides, and
the form no longer flips to the wrong year every January 1st. `force-dynamic`, no
caching. Exposes no PII (dates only).

### `GET/PATCH /api/admin/settings` (new, admin)

Same `isAdminRequest` auth pattern as the other admin routes. GET returns
`{ current_year }`. PATCH accepts `{ current_year }`, validated as a 4-digit year.

### Changed admin routes

`admin/orders`, `admin/export/csv`, `admin/export/zip`: replace the `?? '2027'`
fallback with the `app_settings` value (fetched via a small shared helper, e.g.
`getCurrentYear()` in `src/lib/settings.ts`).

### Deleted

`src/app/api/send-email/route.ts` — logic absorbed into `POST /api/orders`.

## Client changes (`src/lib/http-service.ts`, `src/app/page.tsx`)

- `getDatesTaken(year)` → `getDatesTaken()`: one fetch to `/api/dates-taken`,
  returning `{ year, datesTaken }`. The 12-request fan-out to the legacy host goes
  away.
- `uploadToServer` + `sendEmail` collapse into `submitOrder(file, formData, date,
  isFreeClaim)`: one multipart POST to `/api/orders`. `submitOrder` **throws on
  failure** (unlike today's `uploadToServer`, which catches and logs); `page.tsx`'s
  existing catch blocks handle it.
- `page.tsx`: `yearForSelecting` / `minDate` / `maxDate` derive from the year
  returned by `/api/dates-taken` instead of `currentYear + 1`.
  `handleFreeClaimUpload` and `handlePaymentSuccess` each make one `submitOrder`
  call instead of two calls. Sandbox short-circuit (no upload in sandbox) unchanged.
- `API_BASE_URL` constant removed from client code entirely.

## Admin dashboard changes

- `OrdersTable.tsx`: on mount, fetch `/api/admin/settings`; year dropdown becomes a
  three-year window `[current_year - 1, current_year, current_year + 1]` with
  `current_year` selected. The hardcoded `YEARS` array and `useState(2027)` go away.
- A small **Settings card** on the admin page shows the current year with an input +
  save button (PATCH `/api/admin/settings`). Bumping this is the entire yearly
  rollover task.
- Add `loading="lazy"` to the thumbnail `<img>`s in `OrdersTable.tsx` so
  full-size-as-thumbnail web-order images are only fetched when scrolled into view.

## Env vars

- `LEGACY_UPLOAD_URL` (new): base URL of the legacy PHP endpoint, e.g.
  `https://www.barcsebasset-a-daycalendar.org/fs`. Server-side only.
- `IMAGE_BASE_URL` (existing): unchanged, now also used by `POST /api/orders` to
  build `image_url`.
- Both added to `.env.example`.

## Known risk — legacy upload path pattern

The exact filename/extension the PHP `/upload` endpoint saves under is not
verifiable from this repo (the PHP source is not here). The `photo{ext}` pattern is
inferred from what `migrate-2027.mjs` assumed about the same filesystem.
**Implementation must include a manual smoke test against the real cPanel host**
(sandbox submission, then check the resulting file path) before the computed
`image_url` is trusted. If the real pattern differs, only the URL-construction
helper in `src/lib/legacy-upload.ts` changes.

## Testing

Unit tests alongside the existing `src/lib/*.test.ts` files:

- `/api/orders` field validation, stand-option mapping, URL construction, and the
  upload-fails-row-still-inserted path (legacy upload mocked via
  `src/lib/legacy-upload.ts`).
- `/api/dates-taken` grouping (orders rows → month-keyed day arrays).
- `getCurrentYear()` fallback behavior when the settings row is missing.
- Year-window derivation for the dropdown.

No live network calls in tests. Manual smoke tests post-deploy: one sandbox order
end-to-end, dates-taken reflects it, admin dashboard shows it, photo URL resolves.

## Out of scope

- Server-side enforcement of free-claim eligibility (remains client-only, as today).
- Payment verification server-side (PayPal capture remains client-side, as today).
- Migrating existing photos off cPanel or to Supabase Storage.
- Any change to stand emails, exports, or the stand token flow.
- Deleting `scripts/migrate-2027.mjs` (kept as historical record; simply never needed
  again).
