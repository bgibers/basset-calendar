'use client'

import { useMemo, useRef, useState } from 'react'
import type { Order } from '@/lib/types'
import {
  allEligibleAlreadyEmailed,
  browserCampaignStampStorage,
  createCampaignTracker,
  isStandEmailEligible,
  runStandEmailCampaign,
  standEmailText,
  STAND_EMAIL_SUBJECT,
  DEFAULT_BATCH_SIZE,
  type CampaignBatchResult,
  type StandSkip,
} from '@/lib/stand-email'

function plural(n: number): string {
  return `${n} email${n === 1 ? '' : 's'}`
}

interface Failure {
  email: string
  error: string
}

/** A stand-in order so the preview shows the real template, never a hand-copied version. */
const SAMPLE_ORDER: Order = {
  id: 'sample',
  calendar_date: '2027-02-11',
  owner_name: 'Jane Doe',
  city: 'Baltimore',
  state: 'MD',
  email: 'jane@example.com',
  dog_name: 'Gus',
  is_rescue: true,
  caption: '',
  image_url: null,
  thumb_url: null,
  stand_option: null,
  stand_option_source: null,
  stand_token: '00000000-0000-0000-0000-000000000000',
  stand_emails_sent: 0,
  stand_last_emailed_at: null,
  source: 'migrated',
  created_at: '',
}

export default function StandEmailPanel({
  orders,
  onSent,
}: {
  orders: Order[]
  /** Reload the table so the nudge counts shown next to each row stay accurate. */
  onSent?: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [sentCount, setSentCount] = useState(0)
  const [total, setTotal] = useState(0)
  const [failures, setFailures] = useState<Failure[]>([])
  const [skipped, setSkipped] = useState<StandSkip[]>([])
  const [status, setStatus] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  // Survives re-renders so a retry after a failure continues the same campaign instead of
  // re-emailing everyone the failed run already reached. Backed by localStorage so a tab
  // reload mid-campaign resumes it too, rather than minting a fresh stamp.
  const campaign = useRef(createCampaignTracker(browserCampaignStampStorage()))

  const eligible = useMemo(() => orders.filter(isStandEmailEligible), [orders])
  const followUp = useMemo(() => allEligibleAlreadyEmailed(eligible), [eligible])

  // APP_BASE_URL is server-only, so the preview uses a readable placeholder host. The
  // wording, subject and link shape all come from the shared template.
  const preview = standEmailText(SAMPLE_ORDER, 'https://your-calendar-site')

  async function sendAll() {
    // Two overlapping presses would share one campaign stamp and therefore select the very
    // same rows, emailing them twice. One run at a time.
    if (sending) return
    setConfirming(false)
    setSending(true)
    setFailures([])
    setSkipped([])
    setStatus('')
    const target = eligible.length
    setTotal(target)
    setSentCount(0)

    // One press of the button is one campaign: every batch below is scoped to "not yet
    // emailed since this instant", so nobody is emailed twice and the loop terminates.
    // A press that follows an incomplete run *continues* that campaign (so a retry after
    // fixing an address skips everyone already reached); only after a campaign completes
    // does the next press start a new one — the follow-up.
    const campaignStartedAt = campaign.current.current(new Date().toISOString())

    let lastSent = 0
    try {
      const result = await runStandEmailCampaign(
        async body => {
          const res = await fetch('/api/admin/send-stand-emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (!res.ok) {
            const errorBody = await res.json().catch(() => null)
            throw new Error(errorBody?.error ?? `Request failed (${res.status})`)
          }
          return (await res.json()) as CampaignBatchResult
        },
        {
          campaignStartedAt,
          batchSize: DEFAULT_BATCH_SIZE,
          onProgress: sent => {
            lastSent = sent
            setSentCount(sent)
          },
        },
      )
      campaign.current.settle(result.outcome)
      setFailures(result.failures)
      setSkipped(result.skipped)
      // Skips are not failures — nobody could ever have received these — but they must be
      // visible, because the only fix is a human correcting the address on the order.
      const skipNote =
        result.skipped.length === 0
          ? ''
          : ` Skipped ${result.skipped.length} order${
              result.skipped.length === 1 ? '' : 's'
            } with unusable email addresses.`
      if (result.outcome === 'complete') {
        setStatus(`Done — sent ${plural(result.sent)}.${skipNote}`)
      } else if (result.outcome === 'failures') {
        setStatus(
          `Stopped after ${plural(result.sent)} because some sends failed. Fix the addresses below, then run it again — everyone already emailed is skipped.${skipNote}`,
        )
      } else {
        setStatus(
          `Stopped: ${result.remaining} recipient${result.remaining === 1 ? '' : 's'} remain but the last batch sent nothing.${skipNote}`,
        )
      }
    } catch (err) {
      setStatus(
        `Sending stopped: ${err instanceof Error ? err.message : 'unknown error'}. ${plural(lastSent)} went out before the error.`,
      )
    } finally {
      setSending(false)
      onSent?.()
    }
  }

  const label = `${followUp ? 'Send follow-up to' : 'Send to'} ${eligible.length} ${
    eligible.length === 1 ? 'person' : 'people'
  }`
  // The count shown comes from the year loaded in the table, while the server sends to
  // every eligible order in the database, so the bar is clamped rather than overflowing.
  const progress = total > 0 ? Math.min(100, Math.round((sentCount / total) * 100)) : 0

  return (
    <div className="rounded border p-3 space-y-3">
      <h2 className="font-semibold">Stand-request emails</h2>
      <p className="text-sm text-gray-600">
        {eligible.length === 0
          ? 'No one to email for this year — every order with an email address already has a stand option recorded.'
          : `${eligible.length} order${eligible.length === 1 ? '' : 's'} in this year have no stand option and a working email address.`}
        {followUp && eligible.length > 0 && ' Everyone left has already been emailed at least once.'}
      </p>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={sending || eligible.length === 0 || confirming}
          className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
        >
          {sending ? 'Sending…' : label}
        </button>
        <button
          type="button"
          onClick={() => setShowPreview(v => !v)}
          className="rounded border px-3 py-1 hover:bg-gray-50"
        >
          {showPreview ? 'Hide preview' : 'Preview email'}
        </button>
      </div>

      {showPreview && (
        <div className="rounded border bg-gray-50 p-3 text-xs">
          <p className="font-medium">Subject: {STAND_EMAIL_SUBJECT}</p>
          <p className="text-gray-600">
            Sample values shown; each real email uses that owner&apos;s own name, dog, date and
            personal link.
          </p>
          <pre className="mt-2 whitespace-pre-wrap font-mono">{preview}</pre>
        </div>
      )}

      {confirming && (
        <div className="rounded border border-blue-300 bg-blue-50 p-3 text-sm space-y-2">
          <p className="font-medium">
            Send this email to {eligible.length} {eligible.length === 1 ? 'person' : 'people'}?
          </p>
          <p className="text-gray-700">
            Emails go out in batches of {DEFAULT_BATCH_SIZE}, about two per second, and cover every
            order in the database that is still missing a stand option — not only the year shown
            above. This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void sendAll()}
              disabled={sending}
              className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Yes, send now'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded border px-3 py-1 bg-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {(sending || sentCount > 0) && total > 0 && (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
            <div className="h-2 bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-gray-600">
            {sentCount} of {total} sent
          </p>
        </div>
      )}

      {status && <p className="text-sm text-gray-800">{status}</p>}

      {skipped.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">
            {skipped.length} order{skipped.length === 1 ? '' : 's'} skipped — the email address is
            unusable, so nothing was sent:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {skipped.map((s, i) => (
              <li key={`${s.ownerName}-${i}`} className="break-all">
                {s.ownerName} — <span className="font-mono">{s.email.trim() || '(blank)'}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">
            Fix the address on the order, then run this again to include them.
          </p>
        </div>
      )}

      {failures.length > 0 && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">
            {failures.length} email{failures.length === 1 ? '' : 's'} could not be sent:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {failures.map((f, i) => (
              <li key={`${f.email}-${i}`} className="break-all">
                <span className="font-mono">{f.email || '(no address)'}</span> — {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
