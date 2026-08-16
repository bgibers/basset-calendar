import { getSupabaseAdmin } from '@/lib/db'
import { resolveCurrentYear } from '@/lib/year'

/** Server-only app_settings accessors. Client-safe year logic lives in @/lib/year. */

const CURRENT_YEAR_KEY = 'current_year'

/**
 * Never throws on a missing/malformed row — every caller (public form, admin
 * defaults) is better served by the fallback year than by a 500.
 */
export async function getCurrentYear(): Promise<string> {
  const { data, error } = await getSupabaseAdmin()
    .from('app_settings')
    .select('value')
    .eq('key', CURRENT_YEAR_KEY)
    .maybeSingle()
  if (error) {
    console.error('[settings] could not read current_year:', error)
    return resolveCurrentYear(null)
  }
  return resolveCurrentYear(data?.value ?? null)
}

export async function setCurrentYear(year: string): Promise<void> {
  if (!/^\d{4}$/.test(year)) throw new Error('year must be 4 digits')
  const { error } = await getSupabaseAdmin()
    .from('app_settings')
    .upsert({ key: CURRENT_YEAR_KEY, value: year })
  if (error) throw new Error(`could not save current_year: ${error.message}`)
}
