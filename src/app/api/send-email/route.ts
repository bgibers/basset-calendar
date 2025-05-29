import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.json()

    const transporter = nodemailer.createTransport({
      host: 'barcsebasset-a-daycalendar.org',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    })

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
        `Need Calendar Stand: ${formData.isCalendarStand}\n` +
        `Caption: ${formData.caption}\n`
    }

    await transporter.sendMail(mailOptions)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error sending email:', error)
    return NextResponse.json(
      { error: 'Failed to send email' },
      { status: 500 }
    )
  }
} 