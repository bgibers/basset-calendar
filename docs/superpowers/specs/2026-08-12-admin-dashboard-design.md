# 2027 Order Migration, Admin Dashboard & Stand-Option Recovery — Design

**Date:** 2026-08-12
**Status:** Approved (this document reflects the design Brendan approved in conversation)

## Background

The basset calendar app (Next.js on Vercel) collects one dog-photo order per calendar
day and hands the data to a print company that produces physical calendars. Order data
currently lives as files on a cPanel server (`dates/{year}/{month}/{day}/data.txt` +
photo), written by a small Express app (`bgibers/basset-day-backend`).

Problems this project solves:

1. **No admin visibility.** Kim (the admin) has no way to view or export orders.
2. **Stand options were never persisted.** The order form collected a calendar-stand
   choice (black/clear/order — hole-punch placement depends on it), but the backend
   never wrote it to disk, and the notification emails never sent (SMTP was broken
   and failures were silently swallowed). 2027 ordering is closed, so every one of
   the 362 orders is missing its stand option.
3. **No structured store.** File-on-disk storage has already produced anomalies
   (overwrite bug, stray files).

## Constraints

- **Zero additional spend.** Supabase free tier for data (text only — well within
  limits). Images stay on the already-paid cPanel server (563 MB for 2027 alone would
  exhaust Supabase's free storage tier within ~2 years). Email goes through the
  existing cPanel mail account via SMTP — no third-party email service.
- **Originals are print masters.** Never recompress or resize the original photos;
  the print company needs full resolution. Thumbnails are generated *additionally*
  for dashboard display.
- Admin auth is a single shared password (Kim is the only user; low-sensitivity data).

## Source data (2027)

From `2027.zip` (exported from the server; server copy remains as backup):

- **362 orders** (`data.txt` files), **361 images** (jpeg/jpg/png/webp/jfif/bmp/heic).
- `data.txt` format: indented `Owner Name`, `City`, `State`, `Email`, `Dog Name`,
  `IsRescue`, `Caption` prefix lines; captions may span multiple lines; fields may be
  empty (at least one order has no email).
- Known anomalies, all preserved and flagged rather than dropped:
  - **Feb 11 has two orders**: "The Mills Family" (folder, has photo, no email) and
    "Mary Webb" (stray `February/11.data.txt`, no photo).
  - **Aug 27** (Debbie & Leon Winstanley): data but no photo.

## Architecture

```
Visitors ──> /stand/<token> ──┐
Kim ──────> /admin ───────────┼──> Next.js API routes (service role) ──> Supabase Postgres (order rows)
                              │
                              └──> cPanel server: public_html/calendar-images/… (originals + thumbs)
                                   cPanel SMTP (mail account): all outbound email
```

### Database (Supabase, project `wbtnutelrbrefjwklcmo`)

Table `orders`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk default `gen_random_uuid()` | |
| `calendar_date` | date | NOT unique — Feb 11 legitimately has 2 rows; dashboard flags duplicates |
| `owner_name` | text | |
| `city` | text | |
| `state` | text | |
| `email` | text | may be empty |
| `dog_name` | text | |
| `is_rescue` | boolean | |
| `caption` | text | multi-line preserved |
| `image_url` | text nullable | full-res original on cPanel |
| `thumb_url` | text nullable | ~400px JPEG on cPanel, dashboard display only |
| `stand_option` | text nullable, check in (`have-black`,`have-clear`,`ordered`) | null = unknown |
| `stand_option_source` | text nullable, check in (`customer`,`admin`) | who set it |
| `stand_token` | uuid unique default `gen_random_uuid()` | personal form-link token |
| `stand_emails_sent` | int default 0 | |
| `stand_last_emailed_at` | timestamptz nullable | |
| `source` | text check in (`migrated`,`web`) | |
| `created_at` | timestamptz default now() | |

RLS enabled with **no** anon/authenticated policies; all access goes through Next.js
server routes using the service-role key. The anon key is not shipped to the browser.

### Image hosting (cPanel)

- Originals moved/symlinked under `public_html/calendar-images/{year}/{month}/{day}/`.
- Thumbnails generated at migration time (`thumb.jpg` alongside each original,
  longest edge 400px). The one `.heic` and `.bmp` also get browser-viewable JPEG
  copies; originals kept untouched for print.
- Directory listing disabled via `.htaccess`; CORS header (`Access-Control-Allow-Origin`
  for the app origin) if client-side fetching needs it.

### Email (cPanel SMTP)

- nodemailer against the cPanel mail account (existing `EMAIL_USER`/`EMAIL_PASSWORD`).
  Correct host/port to be confirmed by a live SMTP test (`mail.<domain>` on 587/465
  are the usual cPanel endpoints; the current code's `<domain>:587` may be why nothing
  ever sent). Verify SPF/DKIM records exist in cPanel before the mass send.
- Mass sends are **throttled batches** (size configurable, default ~25 per request)
  driven from the dashboard with a progress indicator, to stay under shared-host
  hourly caps. Each send updates `stand_emails_sent`/`stand_last_emailed_at`.

## Components

### 1. Migration script (one-time, run locally)

`scripts/migrate-2027.ts`, run against the unzipped `2027/` tree:

1. Walk `2027/{Month}/{day}/`, parse `data.txt` with a prefix-based parser that
   handles multi-line captions and empty fields; also ingest the stray
   `February/11.data.txt` as a second Feb 11 row.
2. Generate thumbnails (sharp or macOS `sips`); convert heic/bmp to JPEG copies.
3. Upload originals + thumbs to cPanel (or produce a ready-to-upload tree Brendan
   drops into `public_html` via File Manager — decided at implementation time).
4. Insert rows (`source='migrated'`, `stand_option=null`).
5. **Idempotent** — keyed on (`calendar_date`, `owner_name`); safe to re-run.
6. Print a reconciliation report: expected 362 rows / 361 images, list of anomalies
   (duplicate dates, missing photos, missing emails). Migration is accepted only if
   counts match.

### 2. Public stand form — `/stand/[token]`

- Token is the only auth; it unlocks exactly one order's stand fields.
- Shows dog name, owner name, calendar date (so recipients trust it), photos of both
  stands (existing `stand-black.jpg` / `stand-clear.jpg` assets), three radio options:
  **I have a black stand / I have a clear stand / I ordered one**. No payment.
- Submit sets `stand_option` + `stand_option_source='customer'`.
- Revisiting shows the saved answer and allows changing it. Invalid/unknown token →
  friendly error page.

### 3. Admin dashboard — `/admin`

- **Auth:** login form checks `ADMIN_PASSWORD` env var; success sets a signed
  HttpOnly cookie (HMAC with `ADMIN_COOKIE_SECRET`, ~30-day expiry). Middleware
  guards `/admin/*` and `/api/admin/*`.
- **Orders table** for a selected year: date, thumbnail, owner, dog, email,
  city/state, rescue, caption, stand option, email-nudge count/date.
- **Inline stand-option editing:** dropdown in each row; saving records
  `stand_option_source='admin'`. This is Kim's manual check-off.
- **Filters:** all · missing stand option · no email address · flagged
  (duplicate date / missing photo).
- **Exports:**
  - CSV of all order fields incl. image URLs (per year).
  - Image ZIPs **per month** (~50 MB each, full-res originals named
    `March-14-Biscuit.jpg` style) — sized to avoid function response limits.
    cPanel File Manager "Compress & Download" remains the whole-year bulk fallback.
  - Per-order photo download link.
- **Mass email — "Request stand options":** targets rows where
  `stand_option IS NULL AND email <> ''`. Kim sees recipient count + message preview,
  confirms, then batches send with progress. Each recipient gets a personalized
  `/stand/<token>` link; reply-to `barcsemail@gmail.com`. Because responders leave
  the target set automatically, the same button serves as the follow-up nudge.
  Claude drafts the email copy; Kim/Brendan can edit before sending.

### 4. API routes

| route | auth | purpose |
|---|---|---|
| `GET /api/stand/[token]` | token | fetch order summary for the form |
| `POST /api/stand/[token]` | token | save stand option |
| `POST /api/admin/login` | password | set session cookie |
| `GET /api/admin/orders?year=` | cookie | list orders |
| `PATCH /api/admin/orders/[id]` | cookie | update stand option (admin check-off) |
| `GET /api/admin/export.csv?year=` | cookie | CSV export |
| `GET /api/admin/export.zip?year=&month=` | cookie | monthly image ZIP |
| `POST /api/admin/send-stand-emails` | cookie | send one throttled batch; returns progress |

### Environment variables

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `ADMIN_COOKIE_SECRET`,
`EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_HOST`, `EMAIL_PORT`, `APP_BASE_URL`,
`IMAGE_BASE_URL`. All set in Vercel and `.env.local`; never committed.

New dependencies (pnpm, exact-pinned per global rules): `@supabase/supabase-js`,
`sharp` (thumbnails, migration only), a zip streamer (e.g. `archiver`), a CSV
serializer (or hand-rolled — fields are simple).

## Error handling

- Stand form: token lookup failures → friendly error; save failures surfaced to the
  user with retry.
- Mass email: per-recipient failures collected and shown to Kim (not silently
  swallowed — the root cause of this whole mess); `stand_emails_sent` only increments
  on accepted sends.
- Exports: ZIP route streams and fails loudly if an image fetch 404s, listing the
  missing files rather than producing a silently-incomplete archive.
- Migration: any unparseable `data.txt` aborts with the file path printed; no partial
  silent skips.

## Testing

- Unit-test the `data.txt` parser against real samples incl. multi-line captions,
  empty email, and the stray-file case.
- Migration verified by the reconciliation report (362/361 + known anomalies).
- SMTP verified by a live test send before any mass email; first real send goes to
  a 2-3 address test group.
- Admin auth: verify unauthenticated requests to `/admin/*` and `/api/admin/*`
  redirect/401.

## Out of scope (phase 2)

- Porting the public order form off the old Express server (ordering is closed for
  the year). When done: metadata → Supabase, image upload → cPanel, and the old
  `/fs/ls` directory-listing endpoint dies with the Express app.
- Any payment collection in the stand form (Kim tracks the $8 stand orders herself).
- Backfilling stand options from email history (the emails never sent; there is
  nothing to backfill from).
