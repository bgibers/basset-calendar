import { describe, it, expect } from 'vitest'
import { groupDatesTaken } from '@/lib/dates-taken'

describe('groupDatesTaken', () => {
  it('groups days under 1-based month keys, stripping leading zeros', () => {
    const grouped = groupDatesTaken([
      { calendar_date: '2028-01-05' },
      { calendar_date: '2028-01-12' },
      { calendar_date: '2028-11-03' },
    ])
    expect(grouped['1']).toEqual(['5', '12'])
    expect(grouped['11']).toEqual(['3'])
  })

  it('always contains all 12 month keys, even with no orders', () => {
    const grouped = groupDatesTaken([])
    expect(Object.keys(grouped)).toHaveLength(12)
    expect(grouped['7']).toEqual([])
  })

  it('ignores rows with unparseable dates', () => {
    expect(groupDatesTaken([{ calendar_date: 'garbage' }])['1']).toEqual([])
  })
})
