const CONTACT = 'barcsemail@gmail.com'

/** Card wrapper shared by the stand form and its error states. */
export function StandShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-6 rounded-lg bg-white p-6 shadow-sm">
        {children}
      </div>
    </main>
  )
}

/**
 * Friendly dead end for a customer whose link didn't work. Never explains *why*
 * beyond what a customer can act on — these routes are public.
 */
export default function StandMessage({ heading, body }: { heading: string; body: string }) {
  return (
    <StandShell>
      <h1 className="text-xl font-bold text-gray-900">{heading}</h1>
      <p className="text-sm text-gray-700">{body}</p>
      <p className="text-sm text-gray-700">
        Please email{' '}
        <a className="text-red-600 underline" href={`mailto:${CONTACT}`}>
          {CONTACT}
        </a>{' '}
        and we&apos;ll get you sorted out.
      </p>
    </StandShell>
  )
}
