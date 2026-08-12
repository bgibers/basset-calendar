import { describe, it, expect, vi } from 'vitest'
import {
  STAND_EMAIL_SUBJECT,
  standEmailText,
  clampBatchSize,
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
    expect(result).toEqual({ sent: 2, failures: [] })
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
    })
    expect(delay).not.toHaveBeenCalled()
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
