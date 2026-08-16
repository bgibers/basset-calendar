import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/db'
import { getCurrentYear } from '@/lib/settings'
import { getTransporter } from '@/lib/mailer'
import { uploadPhotoToLegacy } from '@/lib/legacy-upload'
import {
  parseSubmission,
  toOrderRow,
  legacyImageUrl,
  extensionForMime,
  STAND_OPTION_LABELS,
} from '@/lib/order-submit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// photo forward to cPanel + insert + SMTP can exceed the 10s default
export const maxDuration = 60

const MAX_IMAGE_BYTES = 4_000_000 // matches the form's client-side cap
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])

const FIELD_KEYS = [
  'ownerName', 'city', 'state', 'email', 'dogName', 'isRescue',
  'caption', 'standOption', 'isFreeClaim', 'year', 'month', 'day',
] as const

export async function POST(request: NextRequest) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'expected multipart form data' }, { status: 400 })
  }

  const fields: Record<string, string | undefined> = {}
  for (const key of FIELD_KEYS) {
    const value = form.get(key)
    if (typeof value === 'string') fields[key] = value
  }

  let currentYear: string
  try {
    currentYear = await getCurrentYear()
  } catch (err) {
    console.error('[orders] settings unavailable:', err)
    return NextResponse.json({ error: 'Database unavailable' }, { status: 500 })
  }

  const parsed = parseSubmission(fields, currentYear)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const s = parsed.value

  const image = form.get('image')
  if (!(image instanceof File) || !IMAGE_TYPES.has(image.type) || image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: 'image must be a JPEG or PNG up to 4 MB' },
      { status: 400 },
    )
  }

  // Photo first, but a failed upload never blocks the insert: a photo-less row is
  // visible and flagged in the admin dashboard; a lost row is invisible.
  let imageUrl: string | null = null
  try {
    await uploadPhotoToLegacy(
      image,
      {
        ownerName: s.ownerName,
        city: s.city,
        state: s.state,
        email: s.email,
        dogName: s.dogName,
        isRescue: String(s.isRescue),
        needCalendarStand: String(s.standOption === 'order'),
        standOption: s.standOption,
        caption: s.caption,
      },
      s.calendarDate,
    )
    imageUrl = legacyImageUrl(
      process.env.IMAGE_BASE_URL ?? '',
      s.calendarDate,
      extensionForMime(image.type),
    )
  } catch (err) {
    console.error('[orders] legacy photo upload failed:', err)
  }

  try {
    const { error } = await getSupabaseAdmin().from('orders').insert(toOrderRow(s, imageUrl))
    if (error) {
      console.error('[orders] insert failed:', error)
      return NextResponse.json({ error: 'Could not save order' }, { status: 500 })
    }
  } catch (err) {
    console.error('[orders] database unavailable:', err)
    return NextResponse.json({ error: 'Database unavailable' }, { status: 500 })
  }

  // Notification email (absorbed from the deleted /api/send-email route). Sent for
  // every order, free claims included. Failure logs but never fails a saved order.
  try {
    await getTransporter().sendMail({
      from: process.env.EMAIL_USER,
      to: 'barcsemail@gmail.com',
      subject: 'New order',
      text:
        'A new calendar order has been submitted. \n\n' +
        `Date: ${s.calendarDate}\n` +
        `Order type: ${s.isFreeClaim ? 'Free second-space claim' : 'Paid order'}\n` +
        `Owner Name: ${s.ownerName}\n` +
        `City: ${s.city}\n` +
        `State: ${s.state}\n` +
        `Email: ${s.email}\n` +
        `Dog Name: ${s.dogName}\n` +
        `Is Rescue: ${s.isRescue}\n` +
        `Calendar Stand: ${STAND_OPTION_LABELS[s.standOption]}\n` +
        `Caption: ${s.caption}\n` +
        (imageUrl
          ? ''
          : '\nNOTE: the photo upload to the legacy server FAILED; the order was saved without a photo.\n'),
    })
  } catch (err) {
    // nodemailer puts the server's rejection text on `response`
    const response = (err as { response?: unknown })?.response
    console.error(
      '[orders] notification email failed:',
      err,
      response ? `SMTP response: ${response}` : '',
    )
  }

  return NextResponse.json({ success: true })
}
