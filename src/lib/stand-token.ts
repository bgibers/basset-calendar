import { getSupabaseAdmin } from '@/lib/db'
import type { Order, StandOption } from '@/lib/types'

/**
 * Helpers for the tokenized public stand form.
 *
 * `stand_token` is a Postgres `uuid` column, so handing Postgres a non-UUID string
 * raises a cast error (22P02) rather than returning zero rows. A public route must
 * never turn a mistyped link into a 500, so the token is validated in JS *before*
 * any query runs and anything that isn't a UUID is treated as "no such order".
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const VALID_STAND_OPTIONS: StandOption[] = ['have-black', 'have-clear', 'ordered']

export function isValidStandToken(token: unknown): token is string {
  return typeof token === 'string' && UUID_RE.test(token)
}

export function isStandOption(value: unknown): value is StandOption {
  return VALID_STAND_OPTIONS.includes(value as StandOption)
}

/**
 * Look up the order behind a stand token.
 *
 * Returns `null` when the token is malformed or matches no row. Throws only when
 * the database itself is unreachable or misconfigured — callers translate that
 * into a generic 500 / error page and must not leak the underlying message.
 */
export async function findOrderByStandToken(token: string): Promise<Order | null> {
  if (!isValidStandToken(token)) return null
  const { data, error } = await getSupabaseAdmin()
    .from('orders')
    .select('*')
    .eq('stand_token', token)
    .maybeSingle()
  if (error) throw new Error(`stand token lookup failed: ${error.message}`)
  return (data as Order | null) ?? null
}
