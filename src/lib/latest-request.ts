/**
 * Runs async requests such that only the most recently started one can produce a result.
 *
 * Without this, switching the dashboard year while a fetch is in flight can let the older
 * response resolve last and render the wrong year's rows. Each `run` takes a ticket and
 * aborts the previous request; a superseded run resolves to `{ stale: true }` and its
 * value (or error) must be discarded by the caller.
 */
export interface LatestResult<T> {
  stale: boolean
  value?: T
  error?: unknown
}

export interface LatestOnly {
  run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<LatestResult<T>>
  abort(): void
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

export function createLatestOnly(): LatestOnly {
  let seq = 0
  let controller: AbortController | null = null

  return {
    async run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<LatestResult<T>> {
      const ticket = ++seq
      controller?.abort()
      const current = new AbortController()
      controller = current
      try {
        const value = await fn(current.signal)
        if (ticket !== seq) return { stale: true }
        return { stale: false, value }
      } catch (error) {
        if (ticket !== seq || isAbortError(error)) return { stale: true }
        return { stale: false, error }
      }
    },
    abort() {
      controller?.abort()
      controller = null
    },
  }
}
