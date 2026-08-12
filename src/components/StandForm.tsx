'use client'

import { useState } from 'react'
import standBlackImg from '@/assets/stand-black.jpg'
import standClearImg from '@/assets/stand-clear.jpg'
import type { StandOption } from '@/lib/types'

const OPTIONS: { value: StandOption; label: string; image?: { src: string }; alt?: string }[] = [
  {
    value: 'have-black',
    label: 'I have a black acrylic stand',
    image: standBlackImg,
    alt: 'Black acrylic calendar stand',
  },
  {
    value: 'have-clear',
    label: 'I have a clear acrylic stand',
    image: standClearImg,
    alt: 'Clear acrylic calendar stand',
  },
  { value: 'ordered', label: 'I ordered a stand' },
]

export default function StandForm({
  token,
  initialOption,
}: {
  token: string
  initialOption: StandOption | null
}) {
  const [selected, setSelected] = useState<StandOption | null>(initialOption)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!selected || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/stand/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ standOption: selected }),
      })
      if (!res.ok) throw new Error(`save failed: ${res.status}`)
      setSaved(true)
    } catch {
      setError('Sorry — we could not save that. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-3">
        {OPTIONS.map(option => (
          <label
            key={option.value}
            className={`flex items-center p-3 border rounded-md cursor-pointer hover:bg-gray-50 ${
              selected === option.value ? 'border-red-500 bg-red-50' : 'border-gray-300'
            }`}
          >
            <input
              type="radio"
              name="standOption"
              value={option.value}
              checked={selected === option.value}
              onChange={() => {
                setSelected(option.value)
                // A new choice is not saved until they submit again.
                setSaved(false)
                setError(null)
              }}
              className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300"
            />
            {option.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={option.image.src}
                alt={option.alt ?? ''}
                className="ml-3 h-20 w-20 object-contain"
              />
            )}
            <span className="ml-3 text-sm text-gray-700">{option.label}</span>
          </label>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {saved ? (
        <p className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">
          Thanks! Your answer is saved. You can change it any time with this same link.
        </p>
      ) : (
        <button
          type="submit"
          disabled={!selected || saving}
          className={`w-full px-6 py-3 rounded-md text-white ${
            selected && !saving ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-300 cursor-not-allowed'
          }`}
        >
          {saving ? 'Saving…' : 'Save my answer'}
        </button>
      )}
    </form>
  )
}
