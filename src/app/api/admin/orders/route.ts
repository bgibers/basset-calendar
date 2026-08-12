import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  let admin = false
  try {
    // isAdminRequest throws if ADMIN_COOKIE_SECRET is unset (misconfigured deployment).
    // Log server-side; never leak the message or stack to the client.
    admin = isAdminRequest(request)
  } catch (err) {
    console.error('[admin orders] session verification failed:', err)
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const year = request.nextUrl.searchParams.get('year') ?? '2027'
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
      console.error('[admin orders] query failed:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ orders: data ?? [] })
  } catch (err) {
    // getSupabaseAdmin throws when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset.
    console.error('[admin orders] database unavailable:', err)
    return NextResponse.json({ error: 'Database unavailable' }, { status: 500 })
  }
}
