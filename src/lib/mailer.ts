import nodemailer, { type Transporter } from 'nodemailer'

/**
 * Shared SMTP transport. Every sender in the app goes through here so host/port live in
 * one place (env), not scattered as hardcoded literals.
 *
 * Verified settings for the BARCS mailbox: port 465 with implicit TLS (`secure: true`).
 */
export function getTransporter(): Transporter {
  const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD } = process.env
  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASSWORD) throw new Error('email env vars not set')
  const port = Number(EMAIL_PORT ?? 465)
  if (!Number.isInteger(port) || port <= 0) throw new Error('EMAIL_PORT is not a valid port')
  return nodemailer.createTransport({
    host: EMAIL_HOST,
    port,
    // Implicit TLS on 465; STARTTLS (upgraded after connect) on 587 and friends.
    secure: port === 465,
    auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD },
  })
}
