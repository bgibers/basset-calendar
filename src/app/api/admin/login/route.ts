import { NextRequest, NextResponse } from 'next/server'
import { createSessionToken, SESSION_COOKIE } from '@/lib/admin-auth'

export async function POST(request: NextRequest) {
  let password: unknown
  try {
    const body = await request.json()
    password = (body as { password?: unknown } | null)?.password
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (
    !process.env.ADMIN_PASSWORD ||
    typeof password !== 'string' ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
  }

  let token: string
  try {
    // createSessionToken throws if ADMIN_COOKIE_SECRET is unset (misconfigured
    // deployment). Log server-side; never leak the message or stack to the client.
    token = createSessionToken()
  } catch (err) {
    console.error('[admin login] session token creation failed:', err)
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  })
  return res
}
