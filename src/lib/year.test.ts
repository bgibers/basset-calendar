import { describe, it, expect } from 'vitest'
import { resolveCurrentYear, yearWindow } from '@/lib/year'

describe('resolveCurrentYear', () => {
  it('returns a valid stored 4-digit year as-is', () => {
    expect(resolveCurrentYear('2028', new Date(2026, 7, 16))).toBe('2028')
  })

  it('falls back to next calendar year when nothing is stored', () => {
    expect(resolveCurrentYear(null, new Date(2026, 7, 16))).toBe('2027')
    expect(resolveCurrentYear(undefined, new Date(2026, 7, 16))).toBe('2027')
  })

  it('falls back when the stored value is malformed', () => {
    expect(resolveCurrentYear('20x8', new Date(2026, 7, 16))).toBe('2027')
    expect(resolveCurrentYear('', new Date(2026, 7, 16))).toBe('2027')
    expect(resolveCurrentYear('28', new Date(2026, 7, 16))).toBe('2027')
  })

  it('treats `now` as optional and defaults to the wall clock', () => {
    expect(resolveCurrentYear('2028')).toBe('2028')
    expect(resolveCurrentYear(null)).toBe(String(new Date().getFullYear() + 1))
  })
})

describe('yearWindow', () => {
  it('is a three-year window centered on the current year', () => {
    expect(yearWindow(2028)).toEqual([2027, 2028, 2029])
  })
})
