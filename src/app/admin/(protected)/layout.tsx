import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySessionToken, SESSION_COOKIE } from '@/lib/admin-auth'

export default function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  let valid = false
  try {
    valid = verifySessionToken(cookies().get(SESSION_COOKIE)?.value)
  } catch (err) {
    // verifySessionToken throws when ADMIN_COOKIE_SECRET is unset. Log it and treat
    // the request as unauthenticated so no secret or stack reaches the client.
    console.error('[admin guard] session verification failed:', err)
    valid = false
  }
  if (!valid) redirect('/admin/login')
  return <>{children}</>
}
