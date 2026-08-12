import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'
import type { StandOption } from '@/lib/types'

export const dynamic = 'force-dynamic'

const VALID: (StandOption | null)[] = ['have-black', 'have-clear', 'ordered', null]

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  let admin = false
  try {
    // isAdminRequest throws if ADMIN_COOKIE_SECRET is unset (misconfigured deployment).
    admin = isAdminRequest(request)
  } catch (err) {
    console.error('[admin orders patch] session verification failed:', err)
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let stand_option: unknown
  try {
    const body = await request.json()
    stand_option = (body as { stand_option?: unknown } | null)?.stand_option ?? null
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!VALID.includes(stand_option as StandOption | null)) {
    return NextResponse.json({ error: 'invalid stand_option' }, { status: 400 })
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('orders')
      .update({ stand_option, stand_option_source: stand_option ? 'admin' : null })
      .eq('id', params.id)
      .select()
      .maybeSingle()
    if (error) {
      console.error('[admin orders patch] update failed:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json({ order: data })
  } catch (err) {
    // getSupabaseAdmin throws when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset.
    console.error('[admin orders patch] database unavailable:', err)
    return NextResponse.json({ error: 'Database unavailable' }, { status: 500 })
  }
}
