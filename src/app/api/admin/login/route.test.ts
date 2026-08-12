import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/admin-auth'

function loginRequest(body: unknown, raw?: string) {
  return new NextRequest('http://localhost/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  })
}

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.ADMIN_PASSWORD = 'dev-password'
  process.env.ADMIN_COOKIE_SECRET = 'test-secret'
})

afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe('POST /api/admin/login', () => {
  it('sets a valid session cookie for the correct password', async () => {
    const res = await POST(loginRequest({ password: 'dev-password' }))
    expect(res.status).toBe(200)
    const cookie = res.cookies.get(SESSION_COOKIE)
    expect(cookie).toBeTruthy()
    expect(cookie!.httpOnly).toBe(true)
    expect(cookie!.sameSite).toBe('lax')
    expect(cookie!.path).toBe('/')
    expect(verifySessionToken(cookie!.value)).toBe(true)
  })

  it('rejects a wrong password with 401 and no cookie', async () => {
    const res = await POST(loginRequest({ password: 'nope' }))
    expect(res.status).toBe(401)
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined()
    expect(await res.json()).toEqual({ error: 'Wrong password' })
  })

  it('rejects a missing/non-string password with 401', async () => {
    expect((await POST(loginRequest({}))).status).toBe(401)
    expect((await POST(loginRequest({ password: 123 }))).status).toBe(401)
  })

  it('rejects when ADMIN_PASSWORD is unset', async () => {
    delete process.env.ADMIN_PASSWORD
    const res = await POST(loginRequest({ password: '' }))
    expect(res.status).toBe(401)
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined()
  })

  it('returns 400 for a malformed JSON body', async () => {
    const res = await POST(loginRequest(null, '{not json'))
    expect(res.status).toBe(400)
  })

  it('returns a clean 500 when ADMIN_COOKIE_SECRET is unset', async () => {
    delete process.env.ADMIN_COOKIE_SECRET
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(loginRequest({ password: 'dev-password' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Server misconfigured' })
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined()
    expect(err).toHaveBeenCalled()
  })
})
