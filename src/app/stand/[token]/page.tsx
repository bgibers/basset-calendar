import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import StandForm from '@/components/StandForm'
import StandMessage, { StandShell } from '@/components/StandMessage'
import { formatCalendarDate } from '@/lib/order-flags'
import { findOrderByStandToken } from '@/lib/stand-token'
import type { Order } from '@/lib/types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your calendar stand — BaRCSE Basset Calendar',
  robots: { index: false, follow: false },
}

/** `2027-04-09` → `April 9, 2027`; anything unparseable falls back to the raw value. */
function headerDate(calendarDate: string): string {
  const formatted = formatCalendarDate(calendarDate)
  const year = /^(\d{4})-/.exec(calendarDate ?? '')?.[1]
  return year ? `${formatted}, ${year}` : formatted
}

export default async function StandPage({ params }: { params: { token: string } }) {
  let order: Order | null
  try {
    // Called directly rather than fetched over HTTP: same process, no base URL needed.
    order = await findOrderByStandToken(params.token)
  } catch (err) {
    // Database unavailable/misconfigured — never surface the reason to the public.
    console.error('[stand page] lookup failed:', err)
    return (
      <StandMessage
        heading="Something went wrong"
        body="We couldn't load your calendar entry just now. Please try again in a few minutes."
      />
    )
  }

  // Malformed or unknown token: renders not-found.tsx with a 404 status.
  if (!order) notFound()

  return (
    <StandShell>
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-gray-900">
          <span className="font-extrabold">{order.dog_name}</span> —{' '}
          {headerDate(order.calendar_date)}
        </h1>
        <p className="text-sm text-gray-600">
          Hi {order.owner_name}! Which calendar stand do you have?
        </p>
      </header>

      <p className="text-sm text-gray-700">
        The calendar uses a 4&quot; by 6&quot; stand. The hole-punch locations are different for the
        black and clear stands, so your answer tells us how to punch your calendar — please
        double-check which one you have.
      </p>

      <StandForm token={params.token} initialOption={order.stand_option} />
    </StandShell>
  )
}
