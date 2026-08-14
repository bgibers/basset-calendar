import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'
import { getTransporter } from '@/lib/mailer'
import { clampBatchSize, isValidCampaignStart, sendStandBatch } from '@/lib/stand-email'
import type { Order } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Sends are sequential with a 500 ms pause, so a full 50-row batch needs ~25 s of wall
// clock plus SMTP round trips. 60 s leaves headroom without risking a hung request.
export const maxDuration = 60

/**
 * Rows still worth emailing *in this campaign*: no stand option recorded, an email address,
 * and not already emailed since the campaign started.
 *
 * The campaign scope is what makes the client's batch loop terminate — without it, every
 * batch would re-fetch the rows the previous batch just emailed and `remaining` would
 * never reach zero. A later press of the button uses a newer timestamp and therefore
 * becomes a follow-up to whoever still has not answered.
 */
function eligible<
  T extends {
    is(column: string, value: null): T
    neq(column: string, value: string): T
    or(filter: string): T
  },
>(query: T, campaignStartedAt: string): T {
  return query
    .is('stand_option', null)
    .neq('email', '')
    .or(`stand_last_emailed_at.is.null,stand_last_emailed_at.lt.${campaignStartedAt}`)
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
  const fields = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const batchSize = clampBatchSize(fields.batchSize)

  // One press of the send button = one campaign. The client stamps it so every batch in
  // that press shares a scope; a caller that omits it gets a single-batch campaign
  // starting now, which is still correct (just not resumable).
  const campaignStartedAt =
    fields.campaignStartedAt === undefined ? new Date().toISOString() : fields.campaignStartedAt
  if (!isValidCampaignStart(campaignStartedAt)) {
    return NextResponse.json({ error: 'invalid campaignStartedAt' }, { status: 400 })
  }
  // Re-serialize before it reaches the `or()` filter: `Date.parse` accepts formats that
  // contain a comma (`Wed, 12 Aug 2026 …`), and a comma inside the clause would split it
  // into a bogus extra condition. Normalizing leaves exactly one safe shape.
  const campaignCutoff = new Date(Date.parse(campaignStartedAt)).toISOString()

  // Every email carries a personal link built from APP_BASE_URL. Without it we would mass
  // send dead links, so fail before the loop rather than after the damage.
  if (!(process.env.APP_BASE_URL ?? '').trim()) {
    console.error('[send stand emails] APP_BASE_URL is unset; refusing to send dead links')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  try {
    const supabase = getSupabaseAdmin()

    // Oldest nudge first (never-emailed rows lead), then by calendar date so a partial
    // run walks the year in a predictable order.
    const { data, error } = await eligible(supabase.from('orders').select('*'), campaignCutoff)
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

    const { sent, failures, skipped } = await sendStandBatch(orders, {
      mailer: transporter,
      from: process.env.EMAIL_USER,
      baseUrl: process.env.APP_BASE_URL,
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
      // An address nobody can deliver to is stamped *at the campaign cutoff* and never
      // counted as emailed: that drops it from this campaign's eligible set (so the batch
      // loop can finish) while leaving it eligible for the next campaign, in case the
      // address gets fixed in the meantime.
      markSkipped: async order => {
        const { error: updateError } = await supabase
          .from('orders')
          .update({ stand_last_emailed_at: campaignCutoff })
          .eq('id', order.id)
        if (updateError) throw new Error(updateError.message)
      },
    })

    // Count what is left *after* the batch so the client knows whether to loop again.
    const { count, error: countError } = await eligible(
      supabase.from('orders').select('id', { count: 'exact', head: true }),
      campaignCutoff,
    )
    if (countError) {
      console.error('[send stand emails] remaining count failed:', countError)
      return NextResponse.json({ error: 'Could not count remaining recipients' }, { status: 500 })
    }

    return NextResponse.json({ sent, remaining: count ?? 0, failures, skipped })
  } catch (err) {
    // getSupabaseAdmin throws without Supabase env vars; getTransporter without SMTP ones.
    console.error('[send stand emails] send failed:', err)
    return NextResponse.json({ error: 'Could not send emails' }, { status: 500 })
  }
}
