import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSessionToken, SESSION_COOKIE } from '@/lib/admin-auth'

// The route must never touch a real database or a real SMTP server in tests.
interface MailOptions {
  from?: string
  replyTo?: string
  to: string
  subject: string
  text: string
}
const sendMail = vi.fn(async (_options: MailOptions) => ({ accepted: ['x'] }))
vi.mock('@/lib/mailer', () => ({ getTransporter: () => ({ sendMail }) }))

interface Row {
  id: string
  calendar_date: string
  owner_name: string
  email: string
  dog_name: string
  stand_option: string | null
  stand_token: string
  stand_emails_sent: number
  stand_last_emailed_at: string | null
}

/** Filters each query applied, so tests can assert the eligibility conditions directly. */
interface Recorded {
  is: [string, unknown][]
  neq: [string, string][]
  or: string[]
  order: { column: string; options?: unknown }[]
  limit: number | null
  head: boolean
}

const state = {
  rows: [] as Row[],
  selectError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  updates: [] as { id: unknown; values: Record<string, unknown> }[],
  queries: [] as Recorded[],
}

/** Apply the recorded PostgREST filters the way Postgres would, so batching is real. */
function applyFilters(rows: Row[], q: Recorded): Row[] {
  let out = rows
  for (const [column, value] of q.is) {
    out = out.filter(r => (r as unknown as Record<string, unknown>)[column] === value)
  }
  for (const [column, value] of q.neq) {
    out = out.filter(r => (r as unknown as Record<string, unknown>)[column] !== value)
  }
  for (const clause of q.or) {
    // Only the one shape the route builds: `col.is.null,col.lt.<timestamp>`
    const match = /^(\w+)\.is\.null,\1\.lt\.(.+)$/.exec(clause)
    if (!match) throw new Error(`unsupported or() clause: ${clause}`)
    const [, column, cutoff] = match
    out = out.filter(r => {
      const value = (r as unknown as Record<string, unknown>)[column!] as string | null
      return value === null || value < cutoff!
    })
  }
  // stand_last_emailed_at ascending, nulls first; then calendar_date.
  out = [...out].sort((a, b) => {
    const av = a.stand_last_emailed_at
    const bv = b.stand_last_emailed_at
    if (av !== bv) {
      if (av === null) return -1
      if (bv === null) return 1
      return av < bv ? -1 : 1
    }
    return a.calendar_date < b.calendar_date ? -1 : a.calendar_date > b.calendar_date ? 1 : 0
  })
  return q.limit === null ? out : out.slice(0, q.limit)
}

function selectBuilder(head: boolean) {
  const recorded: Recorded = { is: [], neq: [], or: [], order: [], limit: null, head }
  state.queries.push(recorded)
  const builder: Record<string, unknown> = {}
  builder.is = (column: string, value: unknown) => {
    recorded.is.push([column, value])
    return builder
  }
  builder.neq = (column: string, value: string) => {
    recorded.neq.push([column, value])
    return builder
  }
  builder.or = (clause: string) => {
    recorded.or.push(clause)
    return builder
  }
  builder.order = (column: string, options?: unknown) => {
    recorded.order.push({ column, options })
    return builder
  }
  const settle = () => {
    if (state.selectError) {
      return head
        ? { count: null, error: state.selectError }
        : { data: null, error: state.selectError }
    }
    const rows = applyFilters(state.rows, recorded)
    return head ? { count: rows.length, error: null } : { data: rows, error: null }
  }
  builder.limit = (n: number) => {
    recorded.limit = n
    return Promise.resolve(settle())
  }
  // A head:true count query is awaited directly, with no limit() call.
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(settle()).then(resolve)
  return builder
}

vi.mock('@/lib/db', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: (_cols: string, options?: { head?: boolean }) => selectBuilder(!!options?.head),
      update: (values: Record<string, unknown>) => ({
        eq: async (_col: string, id: unknown) => {
          state.updates.push({ id, values })
          if (!state.updateError) {
            const row = state.rows.find(r => r.id === id)
            if (row) Object.assign(row, values)
          }
          return { error: state.updateError }
        },
      }),
    }),
  }),
}))

import { POST } from './route'

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'id-1',
    calendar_date: '2027-02-11',
    owner_name: 'Kim',
    email: 'kim@example.com',
    dog_name: 'Gus',
    stand_option: null,
    stand_token: '11111111-2222-3333-4444-555555555555',
    stand_emails_sent: 0,
    stand_last_emailed_at: null,
    ...overrides,
  }
}

function req(body?: unknown, opts: { auth?: boolean; raw?: string } = {}) {
  const request = new NextRequest('http://localhost/api/admin/send-stand-emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
  if (opts.auth !== false) request.cookies.set(SESSION_COOKIE, createSessionToken())
  return request
}

// Relative to now: a campaign stamp in the future is rejected by design, so a hardcoded
// date would rot the moment the wall clock passed it.
const CAMPAIGN = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.ADMIN_COOKIE_SECRET = 'test-secret'
  process.env.EMAIL_USER = 'order@example.org'
  process.env.APP_BASE_URL = 'https://calendar.example.org'
  Object.assign(state, {
    rows: [],
    selectError: null,
    updateError: null,
    updates: [],
    queries: [],
  })
  sendMail.mockClear()
  sendMail.mockImplementation(async () => ({ accepted: ['x'] }))
})

afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe('POST /api/admin/send-stand-emails', () => {
  it('rejects an unauthenticated request with 401 before touching SMTP', async () => {
    const res = await POST(req({ batchSize: 5 }, { auth: false }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('returns a clean 500 when ADMIN_COOKIE_SECRET is unset', async () => {
    // Build the signed request first; the secret disappears only at verification time.
    const request = req({})
    delete process.env.ADMIN_COOKIE_SECRET
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(request)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Server misconfigured' })
    expect(err).toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('returns 400 for a malformed JSON body', async () => {
    const res = await POST(req(undefined, { raw: '{not json' }))
    expect(res.status).toBe(400)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('refuses to send when APP_BASE_URL is unset, before any email goes out', async () => {
    state.rows = [row()]
    delete process.env.APP_BASE_URL
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(req({ campaignStartedAt: CAMPAIGN }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Server misconfigured' })
    expect(sendMail).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalled()
  })

  it('refuses to send when APP_BASE_URL is blank', async () => {
    state.rows = [row()]
    process.env.APP_BASE_URL = '   '
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await POST(req({ campaignStartedAt: CAMPAIGN }))).status).toBe(500)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('rejects a malformed or future campaign timestamp with 400', async () => {
    state.rows = [row()]
    const future = new Date(Date.now() + 10 * 60_000).toISOString()
    for (const value of ['not-a-date', '', 123, null, future]) {
      const res = await POST(req({ campaignStartedAt: value }))
      expect(res.status, `campaignStartedAt=${String(value)}`).toBe(400)
    }
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('sends a batch, records counters, and reports what remains', async () => {
    state.rows = [
      row({ id: 'a', email: 'a@x.com', calendar_date: '2027-01-01' }),
      row({ id: 'b', email: 'b@x.com', calendar_date: '2027-01-02' }),
      row({ id: 'c', email: 'c@x.com', calendar_date: '2027-01-03' }),
    ]
    const res = await POST(req({ batchSize: 2, campaignStartedAt: CAMPAIGN }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: 2, remaining: 1, failures: [] })
    expect(sendMail.mock.calls.map(c => c[0].to)).toEqual(['a@x.com', 'b@x.com'])
    const first = sendMail.mock.calls[0]![0]
    expect(first.from).toBe('order@example.org')
    expect(first.replyTo).toBe('barcsemail@gmail.com')
    expect(first.text).toContain('https://calendar.example.org/stand/')
    expect(state.updates).toHaveLength(2)
    expect(state.updates[0]!.values.stand_emails_sent).toBe(1)
    expect(typeof state.updates[0]!.values.stand_last_emailed_at).toBe('string')
  })

  it('applies the eligibility filter to both the batch and the remaining count', async () => {
    state.rows = [row({ id: 'a' })]
    await POST(req({ batchSize: 1, campaignStartedAt: CAMPAIGN }))
    expect(state.queries).toHaveLength(2)
    const [batch, remaining] = state.queries
    for (const q of [batch!, remaining!]) {
      expect(q.is).toEqual([['stand_option', null]])
      expect(q.neq).toEqual([['email', '']])
      expect(q.or).toEqual([
        `stand_last_emailed_at.is.null,stand_last_emailed_at.lt.${CAMPAIGN}`,
      ])
    }
    expect(batch!.head).toBe(false)
    expect(remaining!.head).toBe(true)
    expect(batch!.order).toEqual([
      { column: 'stand_last_emailed_at', options: { ascending: true, nullsFirst: true } },
      { column: 'calendar_date', options: { ascending: true } },
    ])
  })

  it('never re-fetches a row already emailed in the same campaign', async () => {
    state.rows = [
      row({ id: 'a', email: 'a@x.com', calendar_date: '2027-01-01' }),
      row({ id: 'b', email: 'b@x.com', calendar_date: '2027-01-02' }),
    ]

    const one = await POST(req({ batchSize: 1, campaignStartedAt: CAMPAIGN }))
    expect(await one.json()).toEqual({ sent: 1, remaining: 1, failures: [] })

    const two = await POST(req({ batchSize: 1, campaignStartedAt: CAMPAIGN }))
    expect(await two.json()).toEqual({ sent: 1, remaining: 0, failures: [] })

    // Two batches, two distinct recipients — nobody emailed twice, and remaining hit 0.
    expect(sendMail.mock.calls.map(c => c[0].to)).toEqual(['a@x.com', 'b@x.com'])

    const three = await POST(req({ batchSize: 1, campaignStartedAt: CAMPAIGN }))
    expect(await three.json()).toEqual({ sent: 0, remaining: 0, failures: [] })
    expect(sendMail).toHaveBeenCalledTimes(2)
  })

  it('treats a later campaign as a follow-up to whoever still has no stand option', async () => {
    state.rows = [row({ id: 'a', email: 'a@x.com', stand_last_emailed_at: CAMPAIGN })]
    const later = new Date(Date.parse(CAMPAIGN) + 60 * 60_000).toISOString()
    const res = await POST(req({ batchSize: 5, campaignStartedAt: later }))
    expect(await res.json()).toEqual({ sent: 1, remaining: 0, failures: [] })
    expect(state.updates[0]!.values.stand_emails_sent).toBe(1)
  })

  it('excludes rows with a stand option or no email from both counts', async () => {
    state.rows = [
      row({ id: 'a', email: 'a@x.com' }),
      row({ id: 'b', email: 'b@x.com', stand_option: 'have-black' }),
      row({ id: 'c', email: '' }),
    ]
    const res = await POST(req({ batchSize: 50, campaignStartedAt: CAMPAIGN }))
    expect(await res.json()).toEqual({ sent: 1, remaining: 0, failures: [] })
    expect(sendMail.mock.calls.map(c => c[0].to)).toEqual(['a@x.com'])
  })

  it('reports a whitespace-only address as a failure instead of sending to it', async () => {
    state.rows = [row({ id: 'a', email: '   ' }), row({ id: 'b', email: 'b@x.com' })]
    const res = await POST(req({ batchSize: 50, campaignStartedAt: CAMPAIGN }))
    const body = (await res.json()) as { sent: number; failures: { email: string; error: string }[] }
    expect(body.sent).toBe(1)
    expect(body.failures).toEqual([{ email: '   ', error: 'blank email address' }])
    expect(sendMail.mock.calls.map(c => c[0].to)).toEqual(['b@x.com'])
  })

  it('defaults the batch size to 25 and caps it at 50', async () => {
    await POST(req({ campaignStartedAt: CAMPAIGN }))
    await POST(req(undefined, { raw: '' }))
    await POST(req({ batchSize: 500, campaignStartedAt: CAMPAIGN }))
    await POST(req({ batchSize: 0, campaignStartedAt: CAMPAIGN }))
    expect(state.queries.filter(q => !q.head).map(q => q.limit)).toEqual([25, 25, 50, 1])
  })

  it('normalizes a parseable timestamp that contains a comma before filtering', async () => {
    state.rows = [row({ id: 'a', email: 'a@x.com' })]
    // RFC-2822 style: Date.parse accepts it, and its comma would otherwise split the
    // or() clause into a bogus extra condition.
    const res = await POST(req({ batchSize: 1, campaignStartedAt: 'Wed, 12 Aug 2026 00:00:00 GMT' }))
    expect(res.status).toBe(200)
    const clause = state.queries[0]!.or[0]!
    expect(clause).toBe(
      'stand_last_emailed_at.is.null,stand_last_emailed_at.lt.2026-08-12T00:00:00.000Z',
    )
    // Exactly one comma: the separator between the two intended conditions.
    expect(clause.split(',')).toHaveLength(2)
  })

  it('defaults a missing campaign timestamp to now rather than rejecting', async () => {
    state.rows = [row({ id: 'a', email: 'a@x.com' })]
    const res = await POST(req({ batchSize: 1 }))
    expect(res.status).toBe(200)
    expect(state.queries[0]!.or[0]).toMatch(/^stand_last_emailed_at\.is\.null,stand_last_emailed_at\.lt\./)
  })

  it('reports per-recipient failures without incrementing their counters', async () => {
    state.rows = [
      row({ id: 'a', email: 'a@x.com', calendar_date: '2027-01-01' }),
      row({ id: 'b', email: 'b@x.com', calendar_date: '2027-01-02' }),
    ]
    sendMail.mockImplementation(async options => {
      if (options.to === 'b@x.com') throw new Error('550 mailbox unavailable')
      return { accepted: ['a'] }
    })
    const res = await POST(req({ batchSize: 2, campaignStartedAt: CAMPAIGN }))
    expect(await res.json()).toEqual({
      sent: 1,
      // b was not marked as emailed, so it is still eligible in this campaign.
      remaining: 1,
      failures: [{ email: 'b@x.com', error: '550 mailbox unavailable' }],
    })
    expect(state.updates.map(u => u.id)).toEqual(['a'])
  })

  it('surfaces a failed counter update instead of swallowing it', async () => {
    state.rows = [row({ id: 'a', email: 'a@x.com' })]
    state.updateError = { message: 'permission denied' }
    const res = await POST(req({ batchSize: 1, campaignStartedAt: CAMPAIGN }))
    const body = (await res.json()) as { sent: number; failures: { error: string }[] }
    expect(body.sent).toBe(1)
    expect(body.failures[0]!.error).toContain('permission denied')
  })

  it('returns a clean 500 when the recipient query fails', async () => {
    state.selectError = { message: 'relation "orders" does not exist' }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(req({ campaignStartedAt: CAMPAIGN }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Could not load recipients' })
    expect(err).toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })
})
