'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Order, StandOption } from '@/lib/types'
import { STAND_LABELS } from '@/lib/types'
import {
  duplicateDates,
  filterOrders,
  formatCalendarDate,
  hasDuplicateDate,
  hasNoPhoto,
  isFlagged,
  FILTER_LABELS,
  type OrderFilter,
} from '@/lib/order-flags'

const FILTERS: OrderFilter[] = ['all', 'missing-stand', 'no-email', 'flagged']
const YEARS = [2026, 2027, 2028]
const STAND_VALUES = Object.keys(STAND_LABELS) as StandOption[]

export default function OrdersTable() {
  const [year, setYear] = useState(2027)
  const [orders, setOrders] = useState<Order[]>([])
  const [filter, setFilter] = useState<OrderFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async (targetYear: number) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/orders?year=${targetYear}`)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }
      const body = await res.json()
      setOrders(Array.isArray(body.orders) ? body.orders : [])
    } catch (err) {
      setOrders([])
      setError(err instanceof Error ? err.message : 'Could not load orders')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(year)
  }, [load, year])

  const dupes = useMemo(() => duplicateDates(orders), [orders])
  const visible = useMemo(() => filterOrders(orders, filter), [orders, filter])

  const counts = useMemo(
    () =>
      FILTERS.reduce(
        (acc, f) => {
          acc[f] = filterOrders(orders, f).length
          return acc
        },
        {} as Record<OrderFilter, number>,
      ),
    [orders],
  )

  async function updateStand(order: Order, raw: string) {
    const next = (raw === '' ? null : raw) as StandOption | null
    const previous = { option: order.stand_option, source: order.stand_option_source }
    // Optimistic update; on failure revert just this row (other rows may have been
    // edited concurrently, so restoring the whole list would clobber them).
    setOrders(current =>
      current.map(o =>
        o.id === order.id
          ? { ...o, stand_option: next, stand_option_source: next ? 'admin' : null }
          : o,
      ),
    )
    setSavingId(order.id)
    try {
      const res = await fetch(`/api/admin/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stand_option: next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }
      const body = await res.json()
      if (body?.order) {
        setOrders(current => current.map(o => (o.id === order.id ? (body.order as Order) : o)))
      }
    } catch (err) {
      setOrders(current =>
        current.map(o =>
          o.id === order.id
            ? { ...o, stand_option: previous.option, stand_option_source: previous.source }
            : o,
        ),
      )
      alert(`Could not save stand option: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally {
      setSavingId(null)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium">
          Year{' '}
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="border rounded p-1"
          >
            {YEARS.map(y => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <span className="text-sm text-gray-600">
          {loading ? 'Loading…' : `${visible.length} of ${orders.length} orders`}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-sm ${
              filter === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700'
            }`}
          >
            {FILTER_LABELS[f]} ({counts[f] ?? 0})
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <p className="font-medium">Could not load orders.</p>
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void load(year)}
            className="mt-2 rounded border border-red-400 px-2 py-1"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <p className="text-sm text-gray-600">No orders match this filter.</p>
      )}

      {visible.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b">
                <th className="p-2">Date</th>
                <th className="p-2">Photo</th>
                <th className="p-2">Owner</th>
                <th className="p-2">Dog</th>
                <th className="p-2">Email</th>
                <th className="p-2">City/State</th>
                <th className="p-2">Rescue</th>
                <th className="p-2">Caption</th>
                <th className="p-2">Stand option</th>
                <th className="p-2">Nudges</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(o => {
                const duplicate = hasDuplicateDate(o, dupes)
                const noPhoto = hasNoPhoto(o)
                return (
                  <tr
                    key={o.id}
                    className={`border-b align-top ${isFlagged(o, dupes) ? 'bg-yellow-50' : ''}`}
                  >
                    <td className="p-2 whitespace-nowrap">
                      {formatCalendarDate(o.calendar_date)}
                      {duplicate && (
                        <span className="block text-xs text-yellow-800">⚠ duplicate date</span>
                      )}
                      {noPhoto && <span className="block text-xs text-yellow-800">⚠ no photo</span>}
                    </td>
                    <td className="p-2">
                      {o.thumb_url ? (
                        o.image_url ? (
                          <a href={o.image_url} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={o.thumb_url} alt={o.dog_name} width={48} height={48} />
                          </a>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={o.thumb_url} alt={o.dog_name} width={48} height={48} />
                        )
                      ) : (
                        <span className="text-xs text-gray-500">—</span>
                      )}
                    </td>
                    <td className="p-2">{o.owner_name}</td>
                    <td className="p-2">{o.dog_name}</td>
                    <td className="p-2 break-all">{o.email || '—'}</td>
                    <td className="p-2 whitespace-nowrap">
                      {[o.city, o.state].filter(Boolean).join(', ')}
                    </td>
                    <td className="p-2 text-center">{o.is_rescue ? '✓' : ''}</td>
                    <td className="p-2 max-w-xs truncate" title={o.caption}>
                      {o.caption}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      <select
                        value={o.stand_option ?? ''}
                        disabled={savingId === o.id}
                        onChange={e => void updateStand(o, e.target.value)}
                        className="border rounded p-1 disabled:opacity-50"
                      >
                        <option value="">—</option>
                        {STAND_VALUES.map(v => (
                          <option key={v} value={v}>
                            {STAND_LABELS[v]}
                          </option>
                        ))}
                      </select>
                      {o.stand_option_source && (
                        <span className="ml-1 text-xs text-gray-500">
                          ({o.stand_option_source})
                        </span>
                      )}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {o.stand_emails_sent}
                      {o.stand_last_emailed_at && (
                        <span className="block text-xs text-gray-500">
                          {o.stand_last_emailed_at.slice(0, 10)}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
