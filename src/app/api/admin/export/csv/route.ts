import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'
import { toCsv } from '@/lib/csv'
import { getCurrentYear } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  let admin = false
  try {
    // isAdminRequest throws if ADMIN_COOKIE_SECRET is unset (misconfigured deployment).
    // Log server-side; never leak the message or stack to the client.
    admin = isAdminRequest(request)
  } catch (err) {
    console.error('[admin export csv] session verification failed:', err)
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let year: string
  try {
    // getCurrentYear reaches getSupabaseAdmin, which throws when SUPABASE_URL /
    // SUPABASE_SERVICE_ROLE_KEY are unset; keep the route's own log + JSON shape.
    year = request.nextUrl.searchParams.get('year') ?? (await getCurrentYear())
  } catch (err) {
    console.error('[admin export csv] database unavailable:', err)
    return NextResponse.json({ error: 'Database unavailable' }, { status: 500 })
  }
  if (!/^\d{4}$/.test(year)) {
    return NextResponse.json({ error: 'invalid year' }, { status: 400 })
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('orders')
      .select('*')
      .gte('calendar_date', `${year}-01-01`)
      .lte('calendar_date', `${year}-12-31`)
      .order('calendar_date')
    if (error) {
      // PostgREST messages can name schema objects and constraints; log, don't return.
      console.error('[admin export csv] query failed:', error)
      return NextResponse.json({ error: 'Could not load orders' }, { status: 500 })
    }

    // stand_token is the secret in the public /stand/{token} URL — a spreadsheet
    // that gets forwarded would be a list of live magic links. Every other column
    // is exported.
    const rows = ((data ?? []) as Record<string, unknown>[]).map(
      ({ stand_token: _standToken, ...rest }) => rest,
    )
    const csv = toCsv(rows)
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="orders-${year}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    // getSupabaseAdmin throws when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset.
    console.error('[admin export csv] database unavailable:', err)
    return NextResponse.json({ error: 'Database unavailable' }, { status: 500 })
  }
}
