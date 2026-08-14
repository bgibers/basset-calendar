import { describe, it, expect } from 'vitest'
import { createLatestOnly, isAbortError } from '@/lib/latest-request'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createLatestOnly', () => {
  it('returns the value when nothing supersedes the run', async () => {
    const latest = createLatestOnly()
    await expect(latest.run(async () => 'ok')).resolves.toEqual({ stale: false, value: 'ok' })
  })

  it('marks an out-of-order earlier response stale and keeps the newest', async () => {
    const latest = createLatestOnly()
    const first = deferred<string>()
    const second = deferred<string>()

    const a = latest.run(() => first.promise) // started first…
    const b = latest.run(() => second.promise)

    second.resolve('2027') // …but resolves last
    first.resolve('2026')

    expect(await a).toEqual({ stale: true })
    expect(await b).toEqual({ stale: false, value: '2027' })
  })

  it('aborts the previous request when a new one starts', async () => {
    const latest = createLatestOnly()
    let firstSignal: AbortSignal | undefined
    const pending = deferred<string>()

    const a = latest.run(signal => {
      firstSignal = signal
      return pending.promise
    })
    expect(firstSignal?.aborted).toBe(false)

    const b = latest.run(async () => 'second')
    expect(firstSignal?.aborted).toBe(true)

    pending.resolve('first')
    expect(await a).toEqual({ stale: true })
    expect(await b).toEqual({ stale: false, value: 'second' })
  })

  it('surfaces the error of the newest run', async () => {
    const latest = createLatestOnly()
    const boom = new Error('Database unavailable')
    const result = await latest.run(async () => {
      throw boom
    })
    expect(result).toEqual({ stale: false, error: boom })
  })

  it('swallows an abort error as stale rather than surfacing it', async () => {
    const latest = createLatestOnly()
    const err = new Error('aborted')
    err.name = 'AbortError'
    await expect(
      latest.run(async () => {
        throw err
      }),
    ).resolves.toEqual({ stale: true })
  })

  it('discards the error of a superseded run', async () => {
    const latest = createLatestOnly()
    const first = deferred<string>()
    const a = latest.run(() => first.promise)
    const b = latest.run(async () => 'newer')
    first.reject(new Error('old failure'))
    expect(await a).toEqual({ stale: true })
    expect(await b).toEqual({ stale: false, value: 'newer' })
  })

  it('abort() cancels the in-flight signal', async () => {
    const latest = createLatestOnly()
    let signal: AbortSignal | undefined
    const pending = deferred<string>()
    const run = latest.run(s => {
      signal = s
      return pending.promise
    })
    latest.abort()
    expect(signal?.aborted).toBe(true)
    pending.resolve('late')
    // Nothing newer started, so the late value still resolves; the caller unmounted.
    await run
  })
})

describe('isAbortError', () => {
  it('recognises AbortError only', () => {
    const err = new Error('x')
    err.name = 'AbortError'
    expect(isAbortError(err)).toBe(true)
    expect(isAbortError(new Error('x'))).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
  })
})
