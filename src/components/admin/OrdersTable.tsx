'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { createLatestOnly } from '@/lib/latest-request'
import { MONTHS } from '@/lib/months'
import { yearWindow } from '@/lib/year'
import StandEmailPanel from '@/components/admin/StandEmailPanel'

const FILTERS: OrderFilter[] = ['all', 'missing-stand', 'no-email', 'flagged']
const STAND_VALUES = Object.keys(STAND_LABELS) as StandOption[]

export default function OrdersTable() {
  // null until /api/admin/settings answers; the orders load waits for it so the
  // table always opens on the admin-configured year.
  const [year, setYear] = useState<number | null>(null)
  const [yearOptions, setYearOptions] = useState<number[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [filter, setFilter] = useState<OrderFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set())
  // Export lives here so the download links always use the year shown in the table.
  const [exportMonth, setExportMonth] = useState<string>(MONTHS[0])

  // Guards against a slow response for an earlier year resolving after a newer one and
  // rendering the wrong year's rows: superseded loads are aborted and their results
  // discarded. See src/lib/latest-request.ts (unit-tested).
  const latest = useRef(createLatestOnly())

  const load = useCallback(async (targetYear: number) => {
    setLoading(true)
    setError('')
    const result = await latest.current.run(async signal => {
      const res = await fetch(`/api/admin/orders?year=${targetYear}`, { signal })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }
      return (await res.json()) as { orders?: unknown }
    })
    if (result.stale) return // a newer load owns the UI now, including `loading`
    if (result.error) {
      setOrders([])
      setError(result.error instanceof Error ? result.error.message : 'Could not load orders')
    } else {
      setOrders(Array.isArray(result.value?.orders) ? (result.value!.orders as Order[]) : [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/settings')
      .then(res => (res.ok ? res.json() : null))
      .catch(() => null)
      .then(body => {
        if (cancelled) return
        const current = Number(body?.current_year)
        // Settings unreachable: fall back to next wall-clock year rather than a
        // dead dashboard.
        const resolved = Number.isInteger(current) ? current : new Date().getFullYear() + 1
        setYearOptions(yearWindow(resolved))
        setYear(resolved)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (year !== null) void load(year)
  }, [load, year])

  // Abort any request still in flight when the table unmounts.
  useEffect(() => {
    const controller = latest.current
    return () => controller.abort()
  }, [])

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
    setSavingIds(current => new Set(current).add(order.id))
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
      // Per-row: clearing a shared slot would re-enable a different row still saving.
      setSavingIds(current => {
        const next = new Set(current)
        next.delete(order.id)
        return next
      })
    }
  }

  if (year === null) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <p className="py-12 text-center text-gray-500">Loading settings…</p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-sm">
        <label className="text-sm font-medium text-gray-700">
          Year{' '}
          <select
            value={year ?? ''}
            onChange={e => setYear(Number(e.target.value))}
            className="ml-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          >
            {yearOptions.map(y => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <span className="text-sm text-gray-500">
          {loading ? 'Loading…' : `${visible.length} of ${orders.length} orders`}
        </span>
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Exports</h2>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {/* Plain links: the admin session cookie rides along with the download. */}
          <a
            href={`/api/admin/export/csv?year=${year}`}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Download CSV ({year})
          </a>
          <label className="font-medium text-gray-700">
            Photos for{' '}
            <select
              value={exportMonth}
              onChange={e => setExportMonth(e.target.value)}
              className="ml-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            >
              {MONTHS.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <a
            href={`/api/admin/export/zip?year=${year}&month=${exportMonth}`}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Download photos ZIP
          </a>
        </div>
        <p className="text-xs text-gray-500">
          The ZIP can take a minute to build. It always includes a manifest.txt listing the photos
          inside, orders with no photo, and any photo that failed to download.
        </p>
      </div>

      {/* Lives here so the eligible count follows the year loaded in the table. */}
      <StandEmailPanel orders={orders} onSent={() => void load(year)} />

      <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900">Orders</h2>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1 text-sm font-medium ${
                  filter === f
                    ? 'border-red-600 bg-red-600 text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {FILTER_LABELS[f]} ({counts[f] ?? 0})
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p className="font-medium">Could not load orders.</p>
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void load(year)}
              className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1 font-medium text-red-700 hover:bg-red-100"
            >
              Retry
            </button>
          </div>
        )}

        {loading && !error && <p className="py-12 text-center text-gray-500">Loading orders…</p>}

        {!loading && !error && visible.length === 0 && (
          <p className="py-12 text-center text-gray-500">No orders match this filter.</p>
        )}

        {visible.length > 0 && (
        <div className="-mx-5 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Photo</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Dog</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">City/State</th>
                <th className="px-3 py-2">Rescue</th>
                <th className="px-3 py-2">Caption</th>
                <th className="px-3 py-2">Stand option</th>
                <th className="px-3 py-2">Nudges</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-gray-700">
              {visible.map(o => {
                const duplicate = hasDuplicateDate(o, dupes)
                const noPhoto = hasNoPhoto(o)
                return (
                  <tr
                    key={o.id}
                    className={`align-top ${
                      isFlagged(o, dupes) ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-gray-900">
                      {formatCalendarDate(o.calendar_date)}
                      {duplicate && (
                        <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                          ⚠ duplicate date
                        </span>
                      )}
                      {noPhoto && (
                        <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                          ⚠ no photo
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {o.thumb_url ? (
                        o.image_url ? (
                          <a href={o.image_url} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={o.thumb_url}
                              alt={o.dog_name}
                              width={48}
                              height={48}
                              loading="lazy"
                              className="rounded ring-1 ring-gray-200"
                            />
                          </a>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={o.thumb_url}
                            alt={o.dog_name}
                            width={48}
                            height={48}
                            loading="lazy"
                            className="rounded ring-1 ring-gray-200"
                          />
                        )
                      ) : (
                        <span className="text-xs text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{o.owner_name}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">{o.dog_name}</td>
                    <td className="break-all px-3 py-2 text-gray-500">{o.email || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500">
                      {[o.city, o.state].filter(Boolean).join(', ')}
                    </td>
                    <td className="px-3 py-2 text-center text-gray-700">
                      {o.is_rescue ? '✓' : ''}
                    </td>
                    <td className="max-w-xs truncate px-3 py-2 text-gray-500" title={o.caption}>
                      {o.caption}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <select
                        value={o.stand_option ?? ''}
                        disabled={savingIds.has(o.id)}
                        onChange={e => void updateStand(o, e.target.value)}
                        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-50"
                      >
                        <option value="">—</option>
                        {STAND_VALUES.map(v => (
                          <option key={v} value={v}>
                            {STAND_LABELS[v]}
                          </option>
                        ))}
                      </select>
                      {o.stand_option_source && (
                        <span className="ml-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                          ({o.stand_option_source})
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">
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
      </div>
    </section>
  )
}
