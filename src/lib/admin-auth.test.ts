import { describe, it, expect, beforeAll } from 'vitest'
import { createSessionToken, verifySessionToken } from './admin-auth'

beforeAll(() => { process.env.ADMIN_COOKIE_SECRET = 'test-secret' })

describe('admin session tokens', () => {
  it('round-trips a valid token', () => {
    expect(verifySessionToken(createSessionToken())).toBe(true)
  })
  it('rejects tampering', () => {
    expect(verifySessionToken(createSessionToken() + 'x')).toBe(false)
  })
  it('rejects expired tokens', () => {
    const past = Date.now() - 1000
    const crypto = require('node:crypto')
    const sig = crypto.createHmac('sha256', 'test-secret').update(String(past)).digest('hex')
    expect(verifySessionToken(`${past}.${sig}`)).toBe(false)
  })
  it('rejects undefined/garbage', () => {
    expect(verifySessionToken(undefined)).toBe(false)
    expect(verifySessionToken('nope')).toBe(false)
  })
})
