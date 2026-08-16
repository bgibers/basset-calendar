/**
 * Pure year logic, client-safe (no Supabase import — the admin dropdown uses
 * yearWindow in a client component).
 *
 * "Current year" means the calendar year currently being sold (the dates printed on
 * the calendar), not the wall-clock year: selling the 2028 calendar during 2027
 * means current_year is 2028.
 */

/** A valid stored value wins; otherwise next calendar year (the form's old behavior). */
export function resolveCurrentYear(
  stored: string | null | undefined,
  now?: Date,
): string {
  if (stored && /^\d{4}$/.test(stored)) return stored
  return String((now ?? new Date()).getFullYear() + 1)
}

/** Admin dropdown choices: last year's orders, this year's, and one ahead. */
export function yearWindow(current: number): number[] {
  return [current - 1, current, current + 1]
}
