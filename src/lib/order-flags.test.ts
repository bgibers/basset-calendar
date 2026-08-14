import { describe, it, expect } from 'vitest'
import type { Order } from '@/lib/types'
import {
  duplicateDates,
  filterOrders,
  formatCalendarDate,
  hasDuplicateDate,
  hasNoEmail,
  hasNoPhoto,
  isFlagged,
  isMissingStand,
} from '@/lib/order-flags'

function order(overrides: Partial<Order> & { id: string; calendar_date: string }): Order {
  return {
    owner_name: 'Owner',
    city: 'Baltimore',
    state: 'MD',
    email: 'owner@example.com',
    dog_name: 'Dog',
    is_rescue: false,
    caption: 'caption',
    image_url: 'https://example.com/a.jpg',
    thumb_url: 'https://example.com/a-thumb.jpg',
    stand_option: 'ordered',
    stand_option_source: 'customer',
    stand_token: 'tok',
    stand_emails_sent: 0,
    stand_last_emailed_at: null,
    source: 'migrated',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('duplicateDates', () => {
  it('returns only dates appearing more than once', () => {
    const dupes = duplicateDates([
      { calendar_date: '2027-02-11' },
      { calendar_date: '2027-02-11' },
      { calendar_date: '2027-08-27' },
    ])
    expect(Array.from(dupes)).toEqual(['2027-02-11'])
  })

  it('is empty when every date is unique', () => {
    expect(duplicateDates([{ calendar_date: '2027-01-01' }]).size).toBe(0)
  })
})

describe('row predicates', () => {
  const dupes = new Set(['2027-02-11'])

  it('flags duplicate dates', () => {
    expect(hasDuplicateDate({ calendar_date: '2027-02-11' }, dupes)).toBe(true)
    expect(hasDuplicateDate({ calendar_date: '2027-03-01' }, dupes)).toBe(false)
  })

  it('flags missing photos for null and empty image_url', () => {
    expect(hasNoPhoto({ image_url: null })).toBe(true)
    expect(hasNoPhoto({ image_url: '' })).toBe(true)
    expect(hasNoPhoto({ image_url: 'https://example.com/a.jpg' })).toBe(false)
  })

  it('isFlagged is duplicate-date OR no-photo', () => {
    expect(isFlagged({ calendar_date: '2027-02-11', image_url: 'x' }, dupes)).toBe(true)
    expect(isFlagged({ calendar_date: '2027-03-01', image_url: null }, dupes)).toBe(true)
    expect(isFlagged({ calendar_date: '2027-03-01', image_url: 'x' }, dupes)).toBe(false)
  })

  it('detects missing stand option and missing email', () => {
    expect(isMissingStand({ stand_option: null })).toBe(true)
    expect(isMissingStand({ stand_option: 'ordered' })).toBe(false)
    expect(hasNoEmail({ email: '' })).toBe(true)
    expect(hasNoEmail({ email: '   ' })).toBe(true)
    expect(hasNoEmail({ email: 'a@b.com' })).toBe(false)
  })
})

describe('filterOrders', () => {
  const orders: Order[] = [
    order({ id: '1', calendar_date: '2027-02-11' }),
    order({ id: '2', calendar_date: '2027-02-11', stand_option: null, stand_option_source: null }),
    order({ id: '3', calendar_date: '2027-08-27', image_url: null, thumb_url: null }),
    order({ id: '4', calendar_date: '2027-09-01', email: '' }),
    order({ id: '5', calendar_date: '2027-10-01' }),
  ]

  it('all returns everything', () => {
    expect(filterOrders(orders, 'all')).toHaveLength(5)
  })

  it('missing-stand returns rows with a null stand_option', () => {
    expect(filterOrders(orders, 'missing-stand').map(o => o.id)).toEqual(['2'])
  })

  it('no-email returns rows with a blank email', () => {
    expect(filterOrders(orders, 'no-email').map(o => o.id)).toEqual(['4'])
  })

  it('flagged returns both duplicate-date rows plus the photoless row', () => {
    expect(filterOrders(orders, 'flagged').map(o => o.id)).toEqual(['1', '2', '3'])
  })

  it('does not mutate the input array', () => {
    const copy = [...orders]
    filterOrders(orders, 'flagged')
    expect(orders).toEqual(copy)
  })
})

describe('formatCalendarDate', () => {
  it('formats ISO dates as month + day', () => {
    expect(formatCalendarDate('2027-02-11')).toBe('February 11')
    expect(formatCalendarDate('2027-12-01')).toBe('December 1')
  })

  it('falls back to the raw value for unparseable input', () => {
    expect(formatCalendarDate('nonsense')).toBe('nonsense')
    expect(formatCalendarDate('2027-13-01')).toBe('2027-13-01')
  })
})
