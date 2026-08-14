import { describe, it, expect, vi } from 'vitest'
import {
  STAND_EMAIL_SUBJECT,
  standEmailText,
  clampBatchSize,
  createCampaignTracker,
  CAMPAIGN_STAMP_STORAGE_KEY,
  isValidCampaignStart,
  runStandEmailCampaign,
  sendStandBatch,
  type StandMailer,
} from './stand-email'
import type { Order } from './types'

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'id-1',
    calendar_date: '2027-02-11',
    owner_name: 'Kim',
    city: 'Baltimore',
    state: 'MD',
    email: 'kim@example.com',
    dog_name: 'Gus',
    is_rescue: true,
    caption: 'good boy',
    image_url: null,
    thumb_url: null,
    stand_option: null,
    stand_option_source: null,
    stand_token: '11111111-2222-3333-4444-555555555555',
    stand_emails_sent: 0,
    stand_last_emailed_at: null,
    source: 'migrated',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('standEmailText', () => {
  const base = 'https://calendar.example.org'

  it('greets the owner by name', () => {
    expect(standEmailText(order({ owner_name: 'Dana' }), base)).toContain('Hi Dana,')
  })

  it('renders the calendar date long-form without timezone drift', () => {
    // 2027-01-01 must not render as December 31 in a negative-offset timezone.
    expect(standEmailText(order({ calendar_date: '2027-01-01' }), base)).toContain(
      'January 1, 2027',
    )
    expect(standEmailText(order({ calendar_date: '2027-02-11' }), base)).toContain(
      'February 11, 2027',
    )
  })

  it('names the dog', () => {
    expect(standEmailText(order({ dog_name: 'Waffles' }), base)).toContain('Waffles is featured on')
  })

  it('includes a personal link built from the base URL and the stand token', () => {
    const text = standEmailText(order(), base)
    expect(text).toContain(`${base}/stand/11111111-2222-3333-4444-555555555555`)
  })

  it('does not double the slash when the base URL has a trailing one', () => {
    const text = standEmailText(order(), 'https://calendar.example.org/')
    expect(text).toContain('https://calendar.example.org/stand/11111111-2222-3333-4444-555555555555')
    expect(text).not.toContain('.org//stand/')
  })

  it('falls back to APP_BASE_URL when no base URL is passed', () => {
    const previous = process.env.APP_BASE_URL
    process.env.APP_BASE_URL = 'https://env.example.org'
    try {
      expect(standEmailText(order())).toContain('https://env.example.org/stand/')
    } finally {
      if (previous === undefined) delete process.env.APP_BASE_URL
      else process.env.APP_BASE_URL = previous
    }
  })

  it('matches the approved copy', () => {
    const text = standEmailText(order(), base)
    expect(text).toContain(
      'Thank you for ordering a spot in the BARCS Basset-a-Day calendar — Gus is featured on February 11, 2027!',
    )
    expect(text).toContain(
      "Due to a technical mixup on our end, we didn't record which calendar stand you have.",
    )
    expect(text).toContain(
      'The hole-punch placement is different for the black and clear acrylic stands, so we need to know before printing.',
    )
    expect(text).toContain('Could you take 10 seconds to tell us here?')
    expect(text).toContain(
      'That link is personal to your order — no login needed. If anything looks wrong, just reply to this email.',
    )
    expect(text.endsWith('Thank you!\nBARCS Basset-a-Day Calendar')).toBe(true)
  })

  it('has a stable subject', () => {
    expect(STAND_EMAIL_SUBJECT).toBe('Your Basset-a-Day calendar — one quick question')
  })
})

describe('clampBatchSize', () => {
  it('defaults to 25', () => {
    expect(clampBatchSize(undefined)).toBe(25)
    expect(clampBatchSize(null)).toBe(25)
  })

  it('keeps values in range', () => {
    expect(clampBatchSize(1)).toBe(1)
    expect(clampBatchSize(25)).toBe(25)
    expect(clampBatchSize(50)).toBe(50)
  })

  it('caps at 50', () => {
    expect(clampBatchSize(51)).toBe(50)
    expect(clampBatchSize(100000)).toBe(50)
  })

  it('floors at 1', () => {
    expect(clampBatchSize(0)).toBe(1)
    expect(clampBatchSize(-5)).toBe(1)
  })

  it('truncates fractions', () => {
    expect(clampBatchSize(3.9)).toBe(3)
  })

  it('falls back to the default for non-numeric input', () => {
    expect(clampBatchSize('10')).toBe(25)
    expect(clampBatchSize(NaN)).toBe(25)
    expect(clampBatchSize({})).toBe(25)
  })
})

describe('sendStandBatch', () => {
  function fakeMailer(behaviour: (to: string) => void = () => {}) {
    const sent: { to: string; subject: string; text: string; from?: string; replyTo?: string }[] = []
    const mailer: StandMailer = {
      async sendMail(options) {
        behaviour(String(options.to))
        sent.push(options as (typeof sent)[number])
        return { accepted: [options.to] }
      },
    }
    return { mailer, sent }
  }

  const noDelay = vi.fn(async () => {})

  it('sends one email per order, in order, and marks each as sent', async () => {
    const { mailer, sent } = fakeMailer()
    const marked: string[] = []
    const orders = [order({ id: 'a', email: 'a@x.com' }), order({ id: 'b', email: 'b@x.com' })]

    const result = await sendStandBatch(orders, {
      mailer,
      markSent: async o => {
        marked.push(o.id)
      },
      delay: noDelay,
      from: 'order@example.org',
      baseUrl: 'https://calendar.example.org',
    })

    expect(sent.map(s => s.to)).toEqual(['a@x.com', 'b@x.com'])
    expect(marked).toEqual(['a', 'b'])
    expect(result).toEqual({ sent: 2, failures: [], skipped: [] })
    expect(sent[0].subject).toBe(STAND_EMAIL_SUBJECT)
    expect(sent[0].from).toBe('order@example.org')
    expect(sent[0].replyTo).toBe('barcsemail@gmail.com')
    expect(sent[0].text).toContain('https://calendar.example.org/stand/')
  })

  it('waits between sends but not after the last one', async () => {
    const { mailer } = fakeMailer()
    const delay = vi.fn(async () => {})
    await sendStandBatch([order({ id: 'a' }), order({ id: 'b' }), order({ id: 'c' })], {
      mailer,
      markSent: async () => {},
      delay,
    })
    expect(delay).toHaveBeenCalledTimes(2)
    expect(delay).toHaveBeenCalledWith(500)
  })

  it('collects failures without marking them sent, and keeps going', async () => {
    const { mailer, sent } = fakeMailer(to => {
      if (to === 'b@x.com') throw new Error('550 mailbox unavailable')
    })
    const marked: string[] = []
    const result = await sendStandBatch(
      [
        order({ id: 'a', email: 'a@x.com' }),
        order({ id: 'b', email: 'b@x.com' }),
        order({ id: 'c', email: 'c@x.com' }),
      ],
      {
        mailer,
        markSent: async o => {
          marked.push(o.id)
        },
        delay: noDelay,
      },
    )

    expect(sent.map(s => s.to)).toEqual(['a@x.com', 'c@x.com'])
    expect(marked).toEqual(['a', 'c'])
    expect(result.sent).toBe(2)
    expect(result.failures).toEqual([{ email: 'b@x.com', error: '550 mailbox unavailable' }])
  })

  it('reports a bookkeeping failure without hiding the delivered email', async () => {
    const { mailer } = fakeMailer()
    const result = await sendStandBatch([order({ id: 'a', email: 'a@x.com' })], {
      mailer,
      markSent: async () => {
        throw new Error('update failed')
      },
      delay: noDelay,
    })
    expect(result.sent).toBe(1)
    expect(result.failures).toEqual([
      { email: 'a@x.com', error: 'email sent but the send count could not be updated: update failed' },
    ])
  })

  it('stringifies non-Error throws', async () => {
    const mailer: StandMailer = {
      async sendMail() {
        throw 'socket hang up'
      },
    }
    const result = await sendStandBatch([order({ email: 'a@x.com' })], {
      mailer,
      markSent: async () => {},
      delay: noDelay,
    })
    expect(result.failures).toEqual([{ email: 'a@x.com', error: 'socket hang up' }])
  })

  it('returns zero for an empty batch and never delays', async () => {
    const { mailer } = fakeMailer()
    const delay = vi.fn(async () => {})
    expect(await sendStandBatch([], { mailer, markSent: async () => {}, delay })).toEqual({
      sent: 0,
      failures: [],
      skipped: [],
    })
    expect(delay).not.toHaveBeenCalled()
  })
})

describe('sendStandBatch delay bookkeeping', () => {
  it('does not spend a pause on a row skipped for a blank address', async () => {
    const mailer: StandMailer = { async sendMail() { return {} } }
    const delay = vi.fn(async () => {})
    // blank, real, blank, real -> exactly one pause, between the two real sends.
    await sendStandBatch(
      [
        order({ id: 'a', email: '  ' }),
        order({ id: 'b', email: 'b@x.com' }),
        order({ id: 'c', email: '' }),
        order({ id: 'd', email: 'd@x.com' }),
      ],
      { mailer, markSent: async () => {}, delay },
    )
    expect(delay).toHaveBeenCalledTimes(1)
  })

  it('does not pause at all when every row is skipped', async () => {
    const mailer: StandMailer = { async sendMail() { return {} } }
    const delay = vi.fn(async () => {})
    await sendStandBatch([order({ email: ' ' }), order({ email: '' })], {
      mailer,
      markSent: async () => {},
      delay,
    })
    expect(delay).not.toHaveBeenCalled()
  })

  it('still pauses after a send that failed — the server was contacted', async () => {
    const mailer: StandMailer = {
      async sendMail() {
        throw new Error('550 nope')
      },
    }
    const delay = vi.fn(async () => {})
    await sendStandBatch([order({ email: 'a@x.com' }), order({ email: 'b@x.com' })], {
      mailer,
      markSent: async () => {},
      delay,
    })
    expect(delay).toHaveBeenCalledTimes(1)
  })
})

describe('sendStandBatch blank addresses', () => {
  it('skips a whitespace-only address, stamps it, and never contacts SMTP for it', async () => {
    const sends: string[] = []
    const mailer: StandMailer = {
      async sendMail(options) {
        sends.push(options.to)
        return {}
      },
    }
    const marked: string[] = []
    const stamped: string[] = []
    const result = await sendStandBatch(
      [order({ id: 'a', email: '   ', owner_name: 'Dana' }), order({ id: 'b', email: 'b@x.com' })],
      {
        mailer,
        markSent: async o => void marked.push(o.id),
        markSkipped: async o => void stamped.push(o.id),
        delay: async () => {},
      },
    )
    expect(sends).toEqual(['b@x.com'])
    expect(marked).toEqual(['b'])
    // The blank row is stamped so it leaves the eligible set instead of heading every batch.
    expect(stamped).toEqual(['a'])
    expect(result.sent).toBe(1)
    // A blank address is not a delivery failure — it is a row nobody can ever reach.
    expect(result.failures).toEqual([])
    expect(result.skipped).toEqual([{ email: '   ', ownerName: 'Dana' }])
  })

  it('reports a failure when the skip stamp cannot be written', async () => {
    const mailer: StandMailer = { async sendMail() { return {} } }
    const result = await sendStandBatch([order({ id: 'a', email: ' ', owner_name: 'Dana' })], {
      mailer,
      markSent: async () => {},
      markSkipped: async () => {
        throw new Error('permission denied')
      },
      delay: async () => {},
    })
    expect(result.sent).toBe(0)
    expect(result.skipped).toEqual([{ email: ' ', ownerName: 'Dana' }])
    expect(result.failures[0]!.error).toContain('permission denied')
  })

  it('still skips blank rows when no markSkipped hook is supplied', async () => {
    const mailer: StandMailer = { async sendMail() { return {} } }
    const result = await sendStandBatch([order({ id: 'a', email: '' })], {
      mailer,
      markSent: async () => {},
      delay: async () => {},
    })
    expect(result).toEqual({ sent: 0, failures: [], skipped: [{ email: '', ownerName: 'Kim' }] })
  })
})

describe('createCampaignTracker', () => {
  const t1 = '2026-08-12T10:00:00.000Z'
  const t2 = '2026-08-12T10:05:00.000Z'
  const t3 = '2026-08-12T10:09:00.000Z'

  it('reuses the stamp on a retry after a failed run, so nobody is emailed twice', () => {
    const tracker = createCampaignTracker()
    // First press: fresh campaign, run ends with failures.
    expect(tracker.current(t1)).toBe(t1)
    tracker.settle('failures')
    // Second press (the retry after fixing an address): same campaign continues.
    expect(tracker.current(t2)).toBe(t1)
    tracker.settle('failures')
    // A third press keeps continuing it — the stamp never drifts while work is unfinished.
    expect(tracker.current(t3)).toBe(t1)
    expect(tracker.pending()).toBe(t1)
  })

  it('keeps the stamp when a run stalls', () => {
    const tracker = createCampaignTracker()
    tracker.current(t1)
    tracker.settle('stalled')
    expect(tracker.current(t2)).toBe(t1)
  })

  it('starts a fresh campaign on the next press after a completed run', () => {
    const tracker = createCampaignTracker()
    expect(tracker.current(t1)).toBe(t1)
    tracker.settle('complete')
    expect(tracker.pending()).toBeNull()
    // The follow-up is a genuinely new campaign, so previously emailed rows are included.
    expect(tracker.current(t2)).toBe(t2)
    expect(tracker.pending()).toBe(t2)
  })

  it('recovers to a fresh campaign after a failed run is eventually completed', () => {
    const tracker = createCampaignTracker()
    tracker.current(t1)
    tracker.settle('failures')
    expect(tracker.current(t2)).toBe(t1)
    tracker.settle('complete')
    expect(tracker.current(t3)).toBe(t3)
  })
})

describe('createCampaignTracker persistence', () => {
  const t1 = '2026-08-12T10:00:00.000Z'
  const t2 = '2026-08-12T10:05:00.000Z'

  /** Stands in for localStorage; a reload is modelled as a brand-new tracker over it. */
  function fakeStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial))
    return {
      map,
      get: (key: string) => map.get(key) ?? null,
      set: (key: string, value: string) => void map.set(key, value),
      remove: (key: string) => void map.delete(key),
    }
  }

  it('carries an unfinished campaign across a reload', () => {
    const storage = fakeStorage()
    const before = createCampaignTracker(storage)
    expect(before.current(t1)).toBe(t1)
    expect(storage.get(CAMPAIGN_STAMP_STORAGE_KEY)).toBe(t1)

    // The admin reloads the tab mid-campaign: fresh tracker, no in-memory stamp.
    const after = createCampaignTracker(storage)
    expect(after.pending()).toBe(t1)
    expect(after.current(t2)).toBe(t1)
  })

  it('clears the stored stamp when a campaign completes', () => {
    const storage = fakeStorage()
    const tracker = createCampaignTracker(storage)
    tracker.current(t1)
    tracker.settle('complete')
    expect(storage.get(CAMPAIGN_STAMP_STORAGE_KEY)).toBeNull()
    // A reload after a completed campaign starts a genuinely new one — the follow-up.
    expect(createCampaignTracker(storage).current(t2)).toBe(t2)
  })

  it('retains the stored stamp when a campaign ends in failures or stalls', () => {
    for (const outcome of ['failures', 'stalled'] as const) {
      const storage = fakeStorage()
      const tracker = createCampaignTracker(storage)
      tracker.current(t1)
      tracker.settle(outcome)
      expect(storage.get(CAMPAIGN_STAMP_STORAGE_KEY), outcome).toBe(t1)
      expect(createCampaignTracker(storage).current(t2), outcome).toBe(t1)
    }
  })

  it('ignores a malformed stored value and mints a fresh stamp', () => {
    for (const junk of ['not-a-date', '', '   ', '{}']) {
      const storage = fakeStorage({ [CAMPAIGN_STAMP_STORAGE_KEY]: junk })
      const tracker = createCampaignTracker(storage)
      expect(tracker.pending(), junk).toBeNull()
      expect(tracker.current(t1), junk).toBe(t1)
      expect(storage.get(CAMPAIGN_STAMP_STORAGE_KEY), junk).toBe(t1)
    }
  })

  it('ignores a stored stamp from the future, which the server would reject anyway', () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString()
    const storage = fakeStorage({ [CAMPAIGN_STAMP_STORAGE_KEY]: future })
    const now = new Date().toISOString()
    expect(createCampaignTracker(storage).current(now)).toBe(now)
  })

  it('works without any storage, and survives a storage that throws', () => {
    expect(createCampaignTracker().current(t1)).toBe(t1)
    const hostile = {
      get: () => {
        throw new Error('SecurityError')
      },
      set: () => {
        throw new Error('QuotaExceededError')
      },
      remove: () => {
        throw new Error('SecurityError')
      },
    }
    const tracker = createCampaignTracker(hostile)
    expect(tracker.current(t1)).toBe(t1)
    expect(tracker.current(t2)).toBe(t1)
    expect(() => tracker.settle('complete')).not.toThrow()
  })
})

describe('isValidCampaignStart', () => {
  const now = Date.parse('2026-08-12T10:00:00.000Z')

  it('accepts an ISO timestamp at or before now', () => {
    expect(isValidCampaignStart('2026-08-12T10:00:00.000Z', now)).toBe(true)
    expect(isValidCampaignStart('2026-08-12T09:00:00.000Z', now)).toBe(true)
  })

  it('tolerates small clock skew but rejects a clearly future stamp', () => {
    expect(isValidCampaignStart(new Date(now + 30_000).toISOString(), now)).toBe(true)
    expect(isValidCampaignStart(new Date(now + 10 * 60_000).toISOString(), now)).toBe(false)
  })

  it('rejects blanks, non-strings and unparseable values', () => {
    expect(isValidCampaignStart('', now)).toBe(false)
    expect(isValidCampaignStart('   ', now)).toBe(false)
    expect(isValidCampaignStart('not-a-date', now)).toBe(false)
    expect(isValidCampaignStart(123, now)).toBe(false)
    expect(isValidCampaignStart(null, now)).toBe(false)
    expect(isValidCampaignStart(undefined, now)).toBe(false)
  })
})

describe('runStandEmailCampaign', () => {
  const campaignStartedAt = '2026-08-12T10:00:00.000Z'

  it('loops until remaining reaches 0 and reports progress as it goes', async () => {
    const batches = [
      { sent: 25, remaining: 30, failures: [] },
      { sent: 25, remaining: 5, failures: [] },
      { sent: 5, remaining: 0, failures: [] },
    ]
    const seen: { batchSize: number; campaignStartedAt: string }[] = []
    const progress: number[] = []
    const result = await runStandEmailCampaign(
      async body => {
        seen.push(body)
        return batches.shift()!
      },
      { campaignStartedAt, onProgress: n => void progress.push(n) },
    )
    expect(result).toEqual({ sent: 55, remaining: 0, failures: [], skipped: [], outcome: 'complete' })
    expect(seen).toHaveLength(3)
    // Every batch carries the same campaign stamp — that is what makes it terminate.
    expect(seen.every(b => b.campaignStartedAt === campaignStartedAt)).toBe(true)
    expect(seen.every(b => b.batchSize === 25)).toBe(true)
    expect(progress).toEqual([25, 50, 55])
  })

  it('stops on the first batch that reports failures', async () => {
    const batches = [
      { sent: 2, remaining: 9, failures: [] },
      { sent: 1, remaining: 8, failures: [{ email: 'b@x.com', error: 'nope' }] },
      { sent: 5, remaining: 0, failures: [] },
    ]
    const result = await runStandEmailCampaign(async () => batches.shift()!, {
      campaignStartedAt,
    })
    expect(result.outcome).toBe('failures')
    expect(result.sent).toBe(3)
    expect(result.failures).toEqual([{ email: 'b@x.com', error: 'nope' }])
    expect(batches).toHaveLength(1) // the third batch was never requested
  })

  it('stops instead of spinning when a batch sends nothing but work remains', async () => {
    let calls = 0
    const result = await runStandEmailCampaign(
      async () => {
        calls++
        return { sent: 0, remaining: 4, failures: [] }
      },
      { campaignStartedAt },
    )
    expect(result.outcome).toBe('stalled')
    expect(result.remaining).toBe(4)
    expect(calls).toBe(1)
  })

  it('gives up after maxBatches rather than looping forever', async () => {
    let calls = 0
    const result = await runStandEmailCampaign(
      async () => {
        calls++
        return { sent: 1, remaining: 99, failures: [] }
      },
      { campaignStartedAt, batchSize: 1, maxBatches: 4 },
    )
    expect(calls).toBe(4)
    expect(result.outcome).toBe('stalled')
  })

  it('completes a campaign whose batch contained an unreachable address', async () => {
    // The blank-address row is stamped as it is skipped, so it leaves the eligible set and
    // `remaining` can reach 0. Before the fix it reappeared in every batch forever.
    const batches = [
      { sent: 2, remaining: 0, failures: [], skipped: [{ email: '  ', ownerName: 'Dana' }] },
    ]
    const result = await runStandEmailCampaign(async () => batches.shift()!, {
      campaignStartedAt,
    })
    expect(result.outcome).toBe('complete')
    expect(result.sent).toBe(2)
    expect(result.failures).toEqual([])
    expect(result.skipped).toEqual([{ email: '  ', ownerName: 'Dana' }])
  })

  it('keeps looping when a batch only skipped rows, and gathers every skip', async () => {
    const batches = [
      { sent: 0, remaining: 2, failures: [], skipped: [{ email: ' ', ownerName: 'Dana' }] },
      { sent: 2, remaining: 0, failures: [], skipped: [{ email: '', ownerName: 'Sam' }] },
    ]
    const result = await runStandEmailCampaign(async () => batches.shift()!, { campaignStartedAt })
    expect(result.outcome).toBe('complete')
    expect(result.skipped).toEqual([
      { email: ' ', ownerName: 'Dana' },
      { email: '', ownerName: 'Sam' },
    ])
  })

  it('still stalls when a batch neither sent nor skipped anything', async () => {
    const result = await runStandEmailCampaign(
      async () => ({ sent: 0, remaining: 4, failures: [], skipped: [] }),
      { campaignStartedAt },
    )
    expect(result.outcome).toBe('stalled')
  })

  it('lets a transport error out of the loop for the caller to report', async () => {
    await expect(
      runStandEmailCampaign(
        async () => {
          throw new Error('Request failed (500)')
        },
        { campaignStartedAt },
      ),
    ).rejects.toThrow('Request failed (500)')
  })
})

describe('eligible-recipient helpers', () => {
  it('counts only orders with no stand option and a non-blank email', async () => {
    const { isStandEmailEligible, allEligibleAlreadyEmailed } = await import('./stand-email')
    expect(isStandEmailEligible(order())).toBe(true)
    expect(isStandEmailEligible(order({ stand_option: 'have-black' }))).toBe(false)
    expect(isStandEmailEligible(order({ email: '' }))).toBe(false)
    expect(isStandEmailEligible(order({ email: '   ' }))).toBe(false)

    expect(allEligibleAlreadyEmailed([])).toBe(false)
    expect(allEligibleAlreadyEmailed([order({ stand_emails_sent: 1 })])).toBe(true)
    expect(
      allEligibleAlreadyEmailed([order({ stand_emails_sent: 1 }), order({ stand_emails_sent: 0 })]),
    ).toBe(false)
  })
})
