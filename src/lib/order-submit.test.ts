import { describe, it, expect } from 'vitest'
import {
  parseSubmission,
  toOrderRow,
  legacyImageUrl,
  extensionForMime,
} from '@/lib/order-submit'

const valid = {
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

describe('parseSubmission', () => {
  it('parses a valid submission into a YYYY-MM-DD calendar date', () => {
    const result = parseSubmission(valid, '2028')
    expect(result).toMatchObject({
      ok: true,
      value: {
        ownerName: 'Pat Smith',
        isRescue: true,
        isFreeClaim: false,
        standOption: 'order',
        calendarDate: '2028-03-05',
      },
    })
  })

  it('rejects a missing required field', () => {
    const result = parseSubmission({ ...valid, email: ' ' }, '2028')
    expect(result).toEqual({ ok: false, error: 'missing field: email' })
  })

  it('rejects a malformed email', () => {
    expect(parseSubmission({ ...valid, email: 'nope' }, '2028')).toEqual({
      ok: false,
      error: 'invalid email',
    })
  })

  it('rejects an unknown stand option', () => {
    expect(parseSubmission({ ...valid, standOption: 'gold' }, '2028')).toEqual({
      ok: false,
      error: 'invalid standOption',
    })
  })

  it('allows an empty stand option (free claims skip the stand step)', () => {
    const result = parseSubmission({ ...valid, standOption: '', isFreeClaim: 'true' }, '2028')
    expect(result.ok).toBe(true)
  })

  it('rejects a year that is not the currently-sold year', () => {
    expect(parseSubmission(valid, '2027')).toEqual({ ok: false, error: 'invalid year' })
  })

  it('rejects an impossible day for the month', () => {
    expect(parseSubmission({ ...valid, month: '2', day: '30' }, '2028')).toEqual({
      ok: false,
      error: 'invalid day',
    })
    // 2028 is a leap year, so Feb 29 is fine
    expect(parseSubmission({ ...valid, month: '2', day: '29' }, '2028').ok).toBe(true)
  })
})

describe('toOrderRow', () => {
  const submission = (parseSubmission(valid, '2028') as { ok: true; value: never }).value

  it("maps the form's 'order' to the DB's 'ordered' with customer source", () => {
    const row = toOrderRow(submission, 'https://img.example/photo.jpg')
    expect(row).toMatchObject({
      calendar_date: '2028-03-05',
      owner_name: 'Pat Smith',
      dog_name: 'Waffles',
      is_rescue: true,
      stand_option: 'ordered',
      stand_option_source: 'customer',
      source: 'web',
      image_url: 'https://img.example/photo.jpg',
      thumb_url: 'https://img.example/photo.jpg',
    })
  })

  it('maps an empty stand option to nulls and a failed upload to null URLs', () => {
    const free = (
      parseSubmission({ ...valid, standOption: '', isFreeClaim: 'true' }, '2028') as {
        ok: true
        value: never
      }
    ).value
    expect(toOrderRow(free, null)).toMatchObject({
      stand_option: null,
      stand_option_source: null,
      image_url: null,
      thumb_url: null,
    })
  })

  it.each(['have-black', 'have-clear'] as const)(
    'passes %s through unchanged, still sourced from the customer',
    option => {
      const owned = (
        parseSubmission({ ...valid, standOption: option }, '2028') as {
          ok: true
          value: never
        }
      ).value
      expect(toOrderRow(owned, null)).toMatchObject({
        stand_option: option,
        stand_option_source: 'customer',
      })
    },
  )
})

describe('legacyImageUrl / extensionForMime', () => {
  it('builds the migration-script path pattern', () => {
    expect(legacyImageUrl('https://example.org/calendar-images', '2028-03-05', '.jpg')).toBe(
      'https://example.org/calendar-images/2028/March/5/photo.jpg',
    )
  })

  it('maps mime types to extensions', () => {
    expect(extensionForMime('image/jpeg')).toBe('.jpg')
    expect(extensionForMime('image/png')).toBe('.png')
  })
})
