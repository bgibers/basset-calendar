import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'node:stream'
import archiver from 'archiver'
import { getSupabaseAdmin } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'
import { MONTHS } from '@/lib/months'
import type { Order } from '@/lib/types'
import { extensionFromUrl, zipEntryName } from '@/lib/zip-names'
import { getCurrentYear } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const FETCH_TIMEOUT_MS = 30_000

function dayOf(calendarDate: string): number {
  // calendar_date is a date column, always YYYY-MM-DD.
  return Number(calendarDate.slice(8, 10))
}

export async function GET(request: NextRequest) {
  let admin = false
  try {
    // isAdminRequest throws if ADMIN_COOKIE_SECRET is unset (misconfigured deployment).
    // Log server-side; never leak the message or stack to the client.
    admin = isAdminRequest(request)
  } catch (err) {
    console.error('[admin export zip] session verification failed:', err)
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const year = request.nextUrl.searchParams.get('year') ?? (await getCurrentYear())
  if (!/^\d{4}$/.test(year)) {
    return NextResponse.json({ error: 'invalid year' }, { status: 400 })
  }

  const month = request.nextUrl.searchParams.get('month') ?? ''
  const monthIndex = MONTHS.indexOf(month as (typeof MONTHS)[number])
  if (monthIndex < 0) {
    return NextResponse.json({ error: 'invalid month' }, { status: 400 })
  }

  // Half-open range so we never have to know the month's length.
  const start = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`
  const end =
    monthIndex === 11
      ? `${Number(year) + 1}-01-01`
      : `${year}-${String(monthIndex + 2).padStart(2, '0')}-01`

  let orders: Order[]
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('orders')
      .select('*')
      .gte('calendar_date', start)
      .lt('calendar_date', end)
      .order('calendar_date')
    if (error) {
      // PostgREST messages can name schema objects and constraints; log, don't return.
      console.error('[admin export zip] query failed:', error)
      return NextResponse.json({ error: 'Could not load orders' }, { status: 500 })
    }
    orders = (data ?? []) as Order[]
  } catch (err) {
    // getSupabaseAdmin throws when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset.
    console.error('[admin export zip] database unavailable:', err)
    return NextResponse.json({ error: 'Database unavailable' }, { status: 500 })
  }

  const archive = archiver('zip', { zlib: { level: 6 } })
  archive.on('warning', err => console.error('[admin export zip] archive warning:', err))
  archive.on('error', err => console.error('[admin export zip] archive error:', err))

  // Build the archive while the response streams. Every order is accounted for in
  // manifest.txt — included, no photo, or failed download — so a fetch failure can
  // never produce a silently short archive.
  void (async () => {
    const included: string[] = []
    const noPhoto: string[] = []
    const failed: string[] = []
    const taken = new Set<string>()

    try {
      for (const order of orders) {
        // Client hung up (closed tab / cancelled download): stop fetching images
        // instead of holding the function open for the rest of maxDuration.
        if (request.signal.aborted) {
          failed.push('ABORTED: download cancelled by the client before all orders were processed')
          break
        }
        const label = `${order.calendar_date} — ${order.dog_name || '(no dog name)'} (${
          order.owner_name || 'unknown owner'
        })`
        if (!order.image_url) {
          noPhoto.push(label)
          continue
        }
        try {
          const res = await fetch(order.image_url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
          if (!res.ok) {
            failed.push(`${label} — HTTP ${res.status} — ${order.image_url}`)
            continue
          }
          const name = zipEntryName(
            month,
            dayOf(order.calendar_date),
            order.dog_name,
            extensionFromUrl(order.image_url),
            taken,
          )
          archive.append(Buffer.from(await res.arrayBuffer()), { name })
          included.push(`${name} — ${label}`)
        } catch (err) {
          failed.push(
            `${label} — fetch error: ${err instanceof Error ? err.message : 'unknown'} — ${order.image_url}`,
          )
        }
      }
    } catch (err) {
      // Unexpected failure (not a per-image one): still ship a manifest that says so.
      console.error('[admin export zip] build failed:', err)
      failed.push(`ABORTED: archive build failed before all orders were processed`)
    }

    const lines = [
      `Photo export — ${month} ${year}`,
      `Orders in this month: ${orders.length}`,
      '',
      `Included photos (${included.length}):`,
      ...(included.length ? included.map(l => `  ${l}`) : ['  (none)']),
      '',
      `Orders with no photo on file (${noPhoto.length}):`,
      ...(noPhoto.length ? noPhoto.map(l => `  ${l}`) : ['  (none)']),
      '',
      `Photos that could not be downloaded (${failed.length}):`,
      ...(failed.length ? failed.map(l => `  ${l}`) : ['  (none)']),
      '',
    ]
    try {
      archive.append(lines.join('\n'), { name: 'manifest.txt' })
      await archive.finalize()
    } catch (err) {
      // e.g. the response stream was destroyed mid-write; nothing left to send.
      console.error('[admin export zip] finalize failed:', err)
      archive.destroy()
    }
  })()

  const body = Readable.toWeb(archive) as ReadableStream<Uint8Array>
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="orders-${year}-${month}.zip"`,
      'Cache-Control': 'no-store',
    },
  })
}
