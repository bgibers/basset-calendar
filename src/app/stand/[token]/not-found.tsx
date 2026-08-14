import StandMessage from '@/components/StandMessage'

/** Rendered with a real 404 status when the token matches no order. */
export default function StandNotFound() {
  return (
    <StandMessage
      heading="This link doesn't look right"
      body="We couldn't find a calendar entry for this link. It may have been copied incompletely out of your email — try clicking the link again."
    />
  )
}
