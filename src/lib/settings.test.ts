import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The accessors must never touch a real database in tests.
const state = {
  row: null as { value: string } | null,
  selectError: null as { message: string } | null,
  upsertError: null as { message: string } | null,
  selects: [] as { table: string; columns: string; eq: [string, unknown][] }[],
  upserts: [] as { table: string; values: unknown }[],
  clientThrows: null as Error | null,
}

vi.mock('@/lib/db', () => ({
  getSupabaseAdmin: () => {
    if (state.clientThrows) throw state.clientThrows
    return {
      from: (table: string) => ({
        select: (columns: string) => {
          const recorded = { table, columns, eq: [] as [string, unknown][] }
          state.selects.push(recorded)
          const builder = {
            eq: (column: string, value: unknown) => {
              recorded.eq.push([column, value])
              return builder
            },
            maybeSingle: async () =>
              state.selectError
                ? { data: null, error: state.selectError }
                : { data: state.row, error: null },
          }
          return builder
        },
        upsert: async (values: unknown) => {
          state.upserts.push({ table, values })
          return { error: state.upsertError }
        },
      }),
    }
  },
}))

import { getCurrentYear, setCurrentYear } from './settings'

beforeEach(() => {
  state.row = null
  state.selectError = null
  state.upsertError = null
  state.selects = []
  state.upserts = []
  state.clientThrows = null
  // resolveCurrentYear's fallback is wall-clock year + 1, so pin the clock.
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2030-06-15T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('getCurrentYear', () => {
  it('returns the stored value when the query succeeds', async () => {
    state.row = { value: '2028' }
    expect(await getCurrentYear()).toBe('2028')
  })

  it('reads the current_year row from app_settings', async () => {
    state.row = { value: '2028' }
    await getCurrentYear()
    expect(state.selects).toEqual([
      { table: 'app_settings', columns: 'value', eq: [['key', 'current_year']] },
    ])
  })

  it('falls back to next calendar year when there is no row', async () => {
    state.row = null
    expect(await getCurrentYear()).toBe('2031')
  })

  it('falls back to next calendar year when the query errors', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.selectError = { message: 'relation "app_settings" does not exist' }
    expect(await getCurrentYear()).toBe('2031')
    // Logged server-side with the [settings] prefix, never surfaced to a caller.
    expect(error).toHaveBeenCalledWith('[settings] could not read current_year:', state.selectError)
  })

  it('falls back when the stored value is malformed', async () => {
    state.row = { value: 'twenty-thirty' }
    expect(await getCurrentYear()).toBe('2031')
  })

  it('propagates a missing-env failure from getSupabaseAdmin', async () => {
    state.clientThrows = new Error('Supabase env vars not set')
    // Callers (the admin routes) catch this and return their own JSON error.
    await expect(getCurrentYear()).rejects.toThrow('Supabase env vars not set')
  })
})

describe('setCurrentYear', () => {
  it('upserts the current_year row', async () => {
    await setCurrentYear('2029')
    expect(state.upserts).toEqual([
      { table: 'app_settings', values: { key: 'current_year', value: '2029' } },
    ])
  })

  it.each(['203', '20299', 'abcd', '', '2029 ', '20.9'])(
    'rejects %o without touching the database',
    async bad => {
      await expect(setCurrentYear(bad)).rejects.toThrow('year must be 4 digits')
      expect(state.upserts).toEqual([])
    },
  )

  it('throws when the upsert returns an error', async () => {
    state.upsertError = { message: 'permission denied for table app_settings' }
    await expect(setCurrentYear('2029')).rejects.toThrow(
      'could not save current_year: permission denied for table app_settings',
    )
  })
})
