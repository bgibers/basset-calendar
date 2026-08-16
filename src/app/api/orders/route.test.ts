import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The route must never touch the legacy host, a real database, or a real SMTP
// server in tests. Each mock records what the route handed it so the assertions
// can be about the actual row / email, not just "a mock was called".
// vi.hoisted, because this one is re-exported directly (not behind a factory
// function like getTransporter), so the mock factory reads it at import time.
const { uploadPhotoToLegacy } = vi.hoisted(() => ({
  uploadPhotoToLegacy: vi.fn<[File, Record<string, string>, string], Promise<void>>(
    async () => {},
  ),
}))
vi.mock('@/lib/legacy-upload', () => ({ uploadPhotoToLegacy }))

interface MailOptions {
  from?: string
  to: string
  subject: string
  text: string
}
const sendMail = vi.fn(async (_options: MailOptions) => ({ accepted: ['x'] }))
vi.mock('@/lib/mailer', () => ({ getTransporter: () => ({ sendMail }) }))

const state = {
  currentYear: '2028' as string,
  yearThrows: null as Error | null,
  insertError: null as { message: string } | null,
  insertThrows: null as Error | null,
  inserts: [] as { table: string; row: Record<string, unknown> }[],
}

vi.mock('@/lib/settings', () => ({
  getCurrentYear: async () => {
    if (state.yearThrows) throw state.yearThrows
    return state.currentYear
  },
}))

vi.mock('@/lib/db', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        state.inserts.push({ table, row })
        if (state.insertThrows) throw state.insertThrows
        return { error: state.insertError }
      },
    }),
  }),
}))

import { POST } from './route'

const IMAGE_BASE_URL = 'https://example.org/calendar-images'
// Matches state.currentYear; month/day give calendar_date 2028-03-05.
const VALID_FIELDS: Record<string, string> = {
  ownerName: 'Pat Smith',
  city: 'Baltimore',
  state: 'MD',
  email: 'pat@example.com',
  dogName: 'Waffles',
  isRescue: 'true',
  caption: 'Longest ears in town',
  standOption: 'order',
  isFreeClaim: 'false',
  year: '2028',
  month: '3',
  day: '5',
}
const EXPECTED_IMAGE_URL = `${IMAGE_BASE_URL}/2028/March/5/photo.jpg`

function jpeg(bytes = 1024, type = 'image/jpeg', name = 'dog.jpg'): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

function req(
  fields: Record<string, string> = VALID_FIELDS,
  image: File | null = jpeg(),
): NextRequest {
  const body = new FormData()
  for (const [key, value] of Object.entries(fields)) body.append(key, value)
  if (image) body.append('image', image)
  return new NextRequest('http://localhost/api/orders', { method: 'POST', body })
}

const originalEnv = { ...process.env }
// The route logs every swallowed failure; keep the suite output readable.
const silenceConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {})
let errorSpy: ReturnType<typeof silenceConsoleError>

beforeEach(() => {
  process.env.IMAGE_BASE_URL = IMAGE_BASE_URL
  process.env.EMAIL_USER = 'order@example.org'
  Object.assign(state, {
    currentYear: '2028',
    yearThrows: null,
    insertError: null,
    insertThrows: null,
    inserts: [],
  })
  uploadPhotoToLegacy.mockClear()
  uploadPhotoToLegacy.mockImplementation(async () => {})
  sendMail.mockClear()
  sendMail.mockImplementation(async () => ({ accepted: ['x'] }))
  errorSpy = silenceConsoleError()
})

afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe('POST /api/orders', () => {
  it('still inserts the order when the legacy photo upload times out', async () => {
    // What AbortSignal.timeout() produces once the legacy host stops answering.
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    uploadPhotoToLegacy.mockRejectedValueOnce(timeout)

    const res = await POST(req())

    // The paid order survives the failed upload — that is the whole guarantee.
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]!.table).toBe('orders')
    expect(state.inserts[0]!.row).toEqual({
      calendar_date: '2028-03-05',
      owner_name: 'Pat Smith',
      city: 'Baltimore',
      state: 'MD',
      email: 'pat@example.com',
      dog_name: 'Waffles',
      is_rescue: true,
      caption: 'Longest ears in town',
      image_url: null,
      thumb_url: null,
      stand_option: 'ordered',
      stand_option_source: 'customer',
      source: 'web',
    })

    // …and the notification still goes out, flagged so a human can chase the photo.
    expect(sendMail).toHaveBeenCalledTimes(1)
    const mail = sendMail.mock.calls[0]![0]
    expect(mail.to).toBe('barcsemail@gmail.com')
    expect(mail.text).toContain('NOTE: the photo upload to the legacy server FAILED')
    expect(mail.text).toContain('Date: 2028-03-05')
    expect(errorSpy).toHaveBeenCalled()
  })

  it('inserts the legacy photo URLs when the upload succeeds', async () => {
    const res = await POST(req())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })

    // The upload got the customer's photo and the calendar date it belongs to.
    expect(uploadPhotoToLegacy).toHaveBeenCalledTimes(1)
    const [file, fields, calendarDate] = uploadPhotoToLegacy.mock.calls[0]!
    expect(file).toBeInstanceOf(File)
    expect(calendarDate).toBe('2028-03-05')
    expect(fields).toMatchObject({
      ownerName: 'Pat Smith',
      email: 'pat@example.com',
      standOption: 'order',
      needCalendarStand: 'true',
      isRescue: 'true',
    })

    expect(state.inserts[0]!.row).toMatchObject({
      calendar_date: '2028-03-05',
      image_url: EXPECTED_IMAGE_URL,
      thumb_url: EXPECTED_IMAGE_URL,
    })
    const mail = sendMail.mock.calls[0]![0]
    expect(mail.text).not.toContain('NOTE:')
    expect(mail.text).toContain('Calendar Stand: Ordering a stand')
  })

  it('returns 500 and sends no email when the insert reports an error', async () => {
    state.insertError = { message: 'duplicate key value violates unique constraint' }

    const res = await POST(req())

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Could not save order' })
    // No confirmation for an order that was never saved.
    expect(sendMail).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
  })

  it('still reports success when the notification email fails after a saved insert', async () => {
    sendMail.mockRejectedValueOnce(
      Object.assign(new Error('SMTP connection closed'), { response: '421 try later' }),
    )

    const res = await POST(req())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(state.inserts).toHaveLength(1)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('rejects an invalid submission before uploading or inserting anything', async () => {
    const res = await POST(req({ ...VALID_FIELDS, email: 'nope' }))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid email' })
    expect(uploadPhotoToLegacy).not.toHaveBeenCalled()
    expect(state.inserts).toEqual([])
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('rejects a missing or oversized image before inserting anything', async () => {
    for (const image of [null, jpeg(4_000_001), jpeg(10, 'application/pdf', 'x.pdf')]) {
      uploadPhotoToLegacy.mockClear()
      const res = await POST(req(VALID_FIELDS, image))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'image must be a JPEG or PNG up to 4 MB' })
      expect(uploadPhotoToLegacy).not.toHaveBeenCalled()
    }
    expect(state.inserts).toEqual([])
    expect(sendMail).not.toHaveBeenCalled()
  })
})
