import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/db'
import { findOrderByStandToken, isStandOption } from '@/lib/stand-token'

export const dynamic = 'force-dynamic'

function notFound() {
  return NextResponse.json({ error: 'not found' }, { status: 404 })
}

export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  let order
  try {
    order = await findOrderByStandToken(params.token)
  } catch (err) {
    // Unreachable/misconfigured database. Log the detail, return nothing specific:
    // this endpoint is public.
    console.error('[stand get] lookup failed:', err)
    return NextResponse.json({ error: 'Something went wrong, please try again' }, { status: 500 })
  }
  if (!order) return notFound()
  return NextResponse.json({
    dogName: order.dog_name,
    ownerName: order.owner_name,
    calendarDate: order.calendar_date,
    standOption: order.stand_option,
  })
}

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  let standOption: unknown
  try {
    const body: unknown = await request.json()
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'invalid option' }, { status: 400 })
    }
    standOption = (body as { standOption?: unknown }).standOption
  } catch {
    return NextResponse.json({ error: 'invalid option' }, { status: 400 })
  }
  if (!isStandOption(standOption)) {
    return NextResponse.json({ error: 'invalid option' }, { status: 400 })
  }

  try {
    const order = await findOrderByStandToken(params.token)
    if (!order) return notFound()

    const { error } = await getSupabaseAdmin()
      .from('orders')
      .update({ stand_option: standOption, stand_option_source: 'customer' })
      .eq('id', order.id)
    if (error) {
      console.error('[stand post] update failed:', error)
      return NextResponse.json({ error: 'Could not save, please try again' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[stand post] database unavailable:', err)
    return NextResponse.json({ error: 'Could not save, please try again' }, { status: 500 })
  }
}
