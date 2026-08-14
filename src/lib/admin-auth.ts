import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'

export const SESSION_COOKIE = 'admin_session'
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function sign(exp: string): string {
  const secret = process.env.ADMIN_COOKIE_SECRET
  if (!secret) throw new Error('ADMIN_COOKIE_SECRET not set')
  return createHmac('sha256', secret).update(exp).digest('hex')
}

export function createSessionToken(): string {
  const exp = String(Date.now() + THIRTY_DAYS_MS)
  return `${exp}.${sign(exp)}`
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [exp, sig] = parts
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false
  const expected = sign(exp)
  // Buffer.from(..., 'hex') silently stops at the first invalid character, so a
  // malformed signature could decode to the same bytes as a valid one. Require
  // an exact-length hex string before the constant-time comparison.
  if (sig.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

export function isAdminRequest(req: NextRequest): boolean {
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)
}
