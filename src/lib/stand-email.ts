import type { Order } from './types'

/**
 * The stand-request email: copy, batch-size rules, and the sequential send loop.
 *
 * Kim/Brendan can edit the copy below directly — it is the single source of truth for
 * both the real send and the admin preview, so the preview can never drift from what
 * owners actually receive.
 */

export const STAND_EMAIL_SUBJECT = 'Your Basset-a-Day calendar — one quick question'

/** Replies go to the volunteer inbox, not the no-reply sending mailbox. */
export const STAND_EMAIL_REPLY_TO = 'barcsemail@gmail.com'

export const DEFAULT_BATCH_SIZE = 25
export const MAX_BATCH_SIZE = 50

/** Milliseconds to wait between sends so the SMTP host does not rate-limit us. */
export const SEND_DELAY_MS = 500

export function standEmailText(order: Order, baseUrl?: string): string {
  // Trailing slashes are easy to leave in APP_BASE_URL and would produce `//stand/`.
  const base = (baseUrl ?? process.env.APP_BASE_URL ?? '').replace(/\/+$/, '')
  const link = `${base}/stand/${order.stand_token}`
  // calendar_date is a date column (YYYY-MM-DD). Parsing it bare would be treated as
  // UTC midnight and render as the previous day west of Greenwich, so pin local noon.
  const date = new Date(`${order.calendar_date}T12:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  return `Hi ${order.owner_name},

Thank you for ordering a spot in the BARCS Basset-a-Day calendar — ${order.dog_name} is featured on ${date}!

Due to a technical mixup on our end, we didn't record which calendar stand you have. The hole-punch placement is different for the black and clear acrylic stands, so we need to know before printing.

Could you take 10 seconds to tell us here?

${link}

That link is personal to your order — no login needed. If anything looks wrong, just reply to this email.

Thank you!
BARCS Basset-a-Day Calendar`
}

/** A row is worth emailing when we still do not know its stand and we can reach the owner. */
export function isStandEmailEligible(order: Pick<Order, 'stand_option' | 'email'>): boolean {
  return order.stand_option === null && (order.email ?? '').trim() !== ''
}

/**
 * True when every eligible row has already been emailed at least once — the admin UI
 * uses this to relabel the button as a follow-up. An empty list is not "already
 * emailed"; there is simply nothing to send.
 */
export function allEligibleAlreadyEmailed(eligible: Pick<Order, 'stand_emails_sent'>[]): boolean {
  return eligible.length > 0 && eligible.every(o => o.stand_emails_sent > 0)
}

/** Clamp a client-supplied batch size into [1, MAX_BATCH_SIZE]; non-numbers use the default. */
export function clampBatchSize(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_BATCH_SIZE
  return Math.min(MAX_BATCH_SIZE, Math.max(1, Math.trunc(raw)))
}

/** The slice of nodemailer's transporter this module needs — keeps the loop testable. */
export interface StandMailer {
  sendMail(options: {
    from?: string
    replyTo?: string
    to: string
    subject: string
    text: string
  }): Promise<unknown>
}

export interface SendStandBatchOptions {
  mailer: StandMailer
  /** Record the successful send (increment the counter, stamp the timestamp). */
  markSent: (order: Order) => Promise<void>
  delay?: (ms: number) => Promise<void>
  from?: string
  baseUrl?: string
}

export interface SendStandBatchResult {
  sent: number
  failures: { email: string; error: string }[]
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Send one stand-request email per order, sequentially, pausing between sends.
 *
 * Every problem surfaces in `failures` — nothing is swallowed. A send that fails does
 * not bump the row's counters, so the next batch retries it. A send that succeeds but
 * whose bookkeeping update fails still counts as sent (the owner did get the email)
 * and is *also* reported, because that row will otherwise be emailed again.
 */
export async function sendStandBatch(
  orders: Order[],
  options: SendStandBatchOptions,
): Promise<SendStandBatchResult> {
  const { mailer, markSent, delay = wait, from, baseUrl } = options
  const failures: { email: string; error: string }[] = []
  let sent = 0

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i]
    if (i > 0) await delay(SEND_DELAY_MS)
    try {
      await mailer.sendMail({
        from,
        replyTo: STAND_EMAIL_REPLY_TO,
        to: order.email,
        subject: STAND_EMAIL_SUBJECT,
        text: standEmailText(order, baseUrl),
      })
    } catch (err) {
      failures.push({ email: order.email, error: message(err) })
      continue
    }
    sent++
    try {
      await markSent(order)
    } catch (err) {
      failures.push({
        email: order.email,
        error: `email sent but the send count could not be updated: ${message(err)}`,
      })
    }
  }

  return { sent, failures }
}
