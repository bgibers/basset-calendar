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
