import axios from 'axios'

export interface DatesTaken {
  [key: string]: string[]
}

export interface FormData {
  ownerName: string
  city: string
  state: string
  email: string
  dogName: string
  isRescue: boolean
  caption: string
  isCalendarStand?: boolean
}

const API_BASE_URL = 'https://www.barcsebasset-a-daycalendar.org/fs'

export const httpService = {
  months: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ],

  async getDatesTaken(year: string): Promise<DatesTaken> {
    const datesTaken: DatesTaken = {}

    const promises = this.months.map(async (month, index) => {
      const monthIndex = index + 1
      try {
        const response = await axios.get<string[]>(`${API_BASE_URL}/datestaken`, {
          params: { month, year }
        })
        datesTaken[monthIndex] = response.data
      } catch (error) {
        console.error(`Error fetching dates for ${month}:`, error)
        datesTaken[monthIndex] = []
      }
    })

    await Promise.all(promises)
    return datesTaken
  },

  async sendEmail(formData: FormData, date: Date): Promise<void> {
    try {
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ownerName: formData.ownerName,
          city: formData.city,
          state: formData.state,
          email: formData.email,
          dogName: formData.dogName,
          isRescue: formData.isRescue,
          isCalendarStand: formData.isCalendarStand,
          caption: formData.caption,
          date: date.toISOString()
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to send email')
      }
    } catch (error) {
      console.error('Error sending email:', error)
      throw error
    }
  },

  async uploadToServer(
    file: File,
    formData: FormData,
    date: Date
  ): Promise<void> {
    console.log('uploading to server')
    const uploadData = new FormData()
    uploadData.append('ownerName', formData.ownerName)
    uploadData.append('city', formData.city)
    uploadData.append('state', formData.state)
    uploadData.append('email', formData.email)
    uploadData.append('dogName', formData.dogName)
    uploadData.append('isRescue', formData.isRescue.toString())
    uploadData.append('needCalendarStand', formData.isCalendarStand?.toString() ?? 'false')
    uploadData.append('caption', formData.caption)
    uploadData.append('image', file)

    const params = {
      month: this.months[date.getMonth()],
      year: date.getFullYear().toString(),
      date: date.getDate().toString()
    }

    try {
      await axios.post(`${API_BASE_URL}/upload`, uploadData, {
        params,
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
    } catch (error) {
      console.error('Error uploading to server:', error)
    }
  }
}
