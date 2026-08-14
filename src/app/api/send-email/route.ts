import { NextRequest, NextResponse } from 'next/server'
import { getTransporter } from '@/lib/mailer'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.json()

    // Shared transport: host/port/credentials come from env, not hardcoded literals.
    const transporter = getTransporter()

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: 'barcsemail@gmail.com',
      subject: 'New order',
      text: 'A new calendar order has been submitted. \n\n' +
        `Date: ${formData.date}\n` +
        `Owner Name: ${formData.ownerName}\n` +
        `City: ${formData.city}\n` +
        `State: ${formData.state}\n` +
        `Email: ${formData.email}\n` +
        `Dog Name: ${formData.dogName}\n` +
        `Is Rescue: ${formData.isRescue}\n` +
        `Calendar Stand: ${formData.standOptionLabel ?? formData.standOption}\n` +
        `Caption: ${formData.caption}\n`
    }

    await transporter.sendMail(mailOptions)

    return NextResponse.json({ success: true })
  } catch (error) {
    // nodemailer puts the server's rejection text on `response` — log it, since the
    // generic client-facing message below deliberately says nothing useful.
    const response = (error as { response?: unknown })?.response
    console.error('Error sending email:', error, response ? `SMTP response: ${response}` : '')
    return NextResponse.json(
      { error: 'Failed to send email' },
      { status: 500 }
    )
  }
} 