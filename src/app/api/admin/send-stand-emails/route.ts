import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'
import { getTransporter } from '@/lib/mailer'
import { clampBatchSize, sendStandBatch } from '@/lib/stand-email'
import type { Order } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Sends are sequential with a 500 ms pause, so a full 50-row batch needs ~25 s of wall
// clock plus SMTP round trips. 60 s leaves headroom without risking a hung request.
export const maxDuration = 60

/** Rows still worth emailing: no stand option recorded and a non-blank email address. */
function eligible<
  T extends { is(column: string, value: null): T; neq(column: string, value: string): T },
>(query: T): T {
  return query.is('stand_option', null).neq('email', '')
}

export async function POST(request: NextRequest) {
  let admin = false
  try {
    // isAdminRequest throws if ADMIN_COOKIE_SECRET is unset (misconfigured deployment).
    // Log server-side; never leak the message or stack to the client.
    admin = isAdminRequest(request)
  } catch (err) {
    console.error('[send stand emails] session verification failed:', err)
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // The body is optional: no body at all means "use the default batch size".
  let body: unknown = null
  try {
    const raw = await request.text()
    body = raw.trim() === '' ? null : JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const batchSize = clampBatchSize(
    typeof body === 'object' && body !== null && 'batchSize' in body
      ? (body as { batchSize: unknown }).batchSize
      : undefined,
  )

  try {
    const supabase = getSupabaseAdmin()

    // Oldest nudge first (never-emailed rows lead), then by calendar date so a partial
    // run walks the year in a predictable order.
    const { data, error } = await eligible(supabase.from('orders').select('*'))
      .order('stand_last_emailed_at', { ascending: true, nullsFirst: true })
      .order('calendar_date', { ascending: true })
      .limit(batchSize)
    if (error) {
      // PostgREST messages can name schema objects and constraints; log, don't return.
      console.error('[send stand emails] query failed:', error)
      return NextResponse.json({ error: 'Could not load recipients' }, { status: 500 })
    }

    const orders = (data ?? []) as Order[]
    const transporter = getTransporter()

    const { sent, failures } = await sendStandBatch(orders, {
      mailer: transporter,
      from: process.env.EMAIL_USER,
      markSent: async order => {
        const { error: updateError } = await supabase
          .from('orders')
          .update({
            stand_emails_sent: order.stand_emails_sent + 1,
            stand_last_emailed_at: new Date().toISOString(),
          })
          .eq('id', order.id)
        if (updateError) throw new Error(updateError.message)
      },
    })

    // Count what is left *after* the batch so the client knows whether to loop again.
    const { count, error: countError } = await eligible(
      supabase.from('orders').select('id', { count: 'exact', head: true }),
    )
    if (countError) {
      console.error('[send stand emails] remaining count failed:', countError)
      return NextResponse.json({ error: 'Could not count remaining recipients' }, { status: 500 })
    }

    return NextResponse.json({ sent, remaining: count ?? 0, failures })
  } catch (err) {
    // getSupabaseAdmin throws without Supabase env vars; getTransporter without SMTP ones.
    console.error('[send stand emails] send failed:', err)
    return NextResponse.json({ error: 'Could not send emails' }, { status: 500 })
  }
}
