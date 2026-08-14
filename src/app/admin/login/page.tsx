'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminLogin() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const router = useRouter()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Trim so a pasted trailing space or newline can't turn the right
        // password into a 401 — the password itself never has edge whitespace.
        body: JSON.stringify({ password: password.trim() }),
      })
      if (res.ok) {
        router.push('/admin')
        return
      }
      setError(res.status === 401 ? 'Wrong password' : 'Login unavailable, try again later')
    } catch {
      setError('Login unavailable, try again later')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-lg shadow-md p-8">
          <h1 className="text-2xl font-bold text-gray-900 text-center">
            BaRCSE Basset-a-Day Calendar
          </h1>
          <p className="mt-1 text-sm text-gray-500 text-center">Admin sign in</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-red-500 focus:ring-red-500 focus:outline-none focus:ring-1"
                autoFocus
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {submitting ? 'Logging in…' : 'Log in'}
            </button>
          </form>
        </div>
        <p className="mt-4 text-center text-xs text-gray-400">
          For calendar volunteers only
        </p>
      </div>
    </main>
  )
}
