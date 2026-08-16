import { MONTHS } from '@/lib/months'

// The legacy cPanel host has no SLA. Without a cap, a host that accepts the
// connection but never answers would hold the request until the orders route's
// maxDuration kills the function — losing the order before the Supabase insert
// ever runs. Bounded here so a hung upload degrades to a photo-less saved row.
const FETCH_TIMEOUT_MS = 30_000

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
  const res = await fetch(`${base}/upload?${params}`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`legacy upload failed: HTTP ${res.status}`)
}
