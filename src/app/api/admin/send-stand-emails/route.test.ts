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

const state = {
  rows: [] as Record<string, unknown>[],
  selectError: null as { message: string } | null,
  updates: [] as { id: unknown; values: Record<string, unknown> }[],
  updateError: null as { message: string } | null,
  remaining: 0,
  limits: [] as number[],
  orders: [] as { column: string; options?: unknown }[],
}

function selectBuilder(head: boolean) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.is = chain
  builder.neq = chain
  builder.order = (column: string, options?: unknown) => {
    state.orders.push({ column, options })
    return builder
  }
  builder.limit = (n: number) => {
    state.limits.push(n)
    return Promise.resolve({ data: state.rows, error: state.selectError })
  }
  // A head:true count query is awaited directly, with no limit() call.
  builder.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(
      head
        ? { count: state.remaining, error: state.selectError }
        : { data: state.rows, error: state.selectError },
    ).then(resolve)
  return builder
}

vi.mock('@/lib/db', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: (_cols: string, options?: { head?: boolean }) => selectBuilder(!!options?.head),
      update: (values: Record<string, unknown>) => ({
        eq: async (_col: string, id: unknown) => {
          state.updates.push({ id, values })
          return { error: state.updateError }
        },
      }),
    }),
  }),
}))

import { POST } from './route'

function row(overrides: Record<string, unknown> = {}) {
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

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.ADMIN_COOKIE_SECRET = 'test-secret'
  process.env.EMAIL_USER = 'order@example.org'
  process.env.APP_BASE_URL = 'https://calendar.example.org'
  Object.assign(state, {
    rows: [],
    selectError: null,
    updates: [],
    updateError: null,
    remaining: 0,
    limits: [],
    orders: [],
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

  it('sends a batch, records counters, and reports what remains', async () => {
    state.rows = [row({ id: 'a', email: 'a@x.com' }), row({ id: 'b', email: 'b@x.com' })]
    state.remaining = 7
    const res = await POST(req({ batchSize: 2 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: 2, remaining: 7, failures: [] })
    expect(sendMail.mock.calls.map(c => c[0].to)).toEqual([
      'a@x.com',
      'b@x.com',
    ])
    const first = sendMail.mock.calls[0]![0]
    expect(first.from).toBe('order@example.org')
    expect(first.replyTo).toBe('barcsemail@gmail.com')
    expect(first.text).toContain('https://calendar.example.org/stand/')
    expect(state.updates).toHaveLength(2)
    expect(state.updates[0].values.stand_emails_sent).toBe(1)
    expect(typeof state.updates[0].values.stand_last_emailed_at).toBe('string')
  })

  it('orders by last-emailed (nulls first) then calendar date', async () => {
    await POST(req({ batchSize: 1 }))
    expect(state.orders).toEqual([
      { column: 'stand_last_emailed_at', options: { ascending: true, nullsFirst: true } },
      { column: 'calendar_date', options: { ascending: true } },
    ])
  })

  it('defaults the batch size to 25 and caps it at 50', async () => {
    await POST(req({}))
    await POST(req(undefined, { raw: '' }))
    await POST(req({ batchSize: 500 }))
    await POST(req({ batchSize: 0 }))
    expect(state.limits).toEqual([25, 25, 50, 1])
  })

  it('reports per-recipient failures without incrementing their counters', async () => {
    state.rows = [row({ id: 'a', email: 'a@x.com' }), row({ id: 'b', email: 'b@x.com' })]
    state.remaining = 1
    sendMail.mockImplementation(async options => {
      if (options.to === 'b@x.com') throw new Error('550 mailbox unavailable')
      return { accepted: ['a'] }
    })
    const res = await POST(req({ batchSize: 2 }))
    expect(await res.json()).toEqual({
      sent: 1,
      remaining: 1,
      failures: [{ email: 'b@x.com', error: '550 mailbox unavailable' }],
    })
    expect(state.updates.map(u => u.id)).toEqual(['a'])
  })

  it('surfaces a failed counter update instead of swallowing it', async () => {
    state.rows = [row({ id: 'a', email: 'a@x.com' })]
    state.updateError = { message: 'permission denied' }
    const res = await POST(req({ batchSize: 1 }))
    const body = (await res.json()) as { sent: number; failures: { error: string }[] }
    expect(body.sent).toBe(1)
    expect(body.failures[0]!.error).toContain('permission denied')
  })

  it('returns a clean 500 when the recipient query fails', async () => {
    state.selectError = { message: 'relation "orders" does not exist' }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(req({}))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Could not load recipients' })
    expect(err).toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })
})
