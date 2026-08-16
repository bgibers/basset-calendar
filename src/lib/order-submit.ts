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
