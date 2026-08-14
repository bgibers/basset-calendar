import type { Order } from '@/lib/types'
import { MONTHS } from '@/lib/months'

export type OrderFilter = 'all' | 'missing-stand' | 'no-email' | 'flagged'

export const FILTER_LABELS: Record<OrderFilter, string> = {
  all: 'All',
  'missing-stand': 'Missing stand option',
  'no-email': 'No email',
  flagged: 'Flagged',
}

/**
 * Calendar dates that appear more than once in the loaded set. Duplicates are a data
 * problem (two photos claiming the same calendar day), so both rows get flagged.
 */
export function duplicateDates(orders: Pick<Order, 'calendar_date'>[]): Set<string> {
  const counts = new Map<string, number>()
  for (const o of orders) {
    counts.set(o.calendar_date, (counts.get(o.calendar_date) ?? 0) + 1)
  }
  const dupes = new Set<string>()
  counts.forEach((count, date) => {
    if (count > 1) dupes.add(date)
  })
  return dupes
}

export function hasDuplicateDate(order: Pick<Order, 'calendar_date'>, dupes: Set<string>): boolean {
  return dupes.has(order.calendar_date)
}

export function hasNoPhoto(order: Pick<Order, 'image_url'>): boolean {
  return order.image_url === null || order.image_url === ''
}

export function isFlagged(
  order: Pick<Order, 'calendar_date' | 'image_url'>,
  dupes: Set<string>,
): boolean {
  return hasDuplicateDate(order, dupes) || hasNoPhoto(order)
}

export function isMissingStand(order: Pick<Order, 'stand_option'>): boolean {
  return order.stand_option === null
}

export function hasNoEmail(order: Pick<Order, 'email'>): boolean {
  return (order.email ?? '').trim() === ''
}

export function filterOrders<T extends Order>(orders: T[], filter: OrderFilter): T[] {
  if (filter === 'all') return orders
  if (filter === 'missing-stand') return orders.filter(isMissingStand)
  if (filter === 'no-email') return orders.filter(hasNoEmail)
  const dupes = duplicateDates(orders)
  return orders.filter(o => isFlagged(o, dupes))
}

/** `2027-02-11` -> `February 11`. Falls back to the raw string if unparseable. */
export function formatCalendarDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '')
  if (!match) return date ?? ''
  const monthIndex = Number(match[2]) - 1
  const month = MONTHS[monthIndex]
  if (!month) return date
  return `${month} ${Number(match[3])}`
}
