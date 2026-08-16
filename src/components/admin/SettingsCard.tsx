'use client'

import { useEffect, useState } from 'react'

/**
 * The one yearly admin action: bump the calendar year being sold. Saving reloads
 * the page so the orders table re-reads the setting — a full reload is fine for a
 * once-a-year operation and avoids coupling this card to OrdersTable's state.
 */
export default function SettingsCard() {
  const [year, setYear] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/settings')
      .then(async res => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        const body = await res.json()
        if (!cancelled) {
          setYear(String(body.current_year ?? ''))
          setStatus('ready')
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load settings')
          setStatus('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function save() {
    setStatus('saving')
    setError('')
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_year: year.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
      setStatus('ready')
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">Settings</h2>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="font-medium text-gray-700">
          Calendar year being sold{' '}
          <input
            value={year}
            onChange={e => setYear(e.target.value)}
            disabled={status === 'loading' || status === 'saving'}
            inputMode="numeric"
            className="ml-1 w-20 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          onClick={() => void save()}
          disabled={status !== 'ready' || !/^\d{4}$/.test(year.trim())}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
        >
          Save
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Controls which year the public order form sells and the default year across
        this dashboard. Bumping this once a year is the entire rollover.
      </p>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  )
}
