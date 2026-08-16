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
