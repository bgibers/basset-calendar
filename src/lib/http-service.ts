export interface DatesTaken {
  [key: string]: string[]
}

export interface OrderFormData {
  ownerName: string
  city: string
  state: string
  email: string
  dogName: string
  isRescue: boolean
  caption: string
  standOption: 'have-black' | 'have-clear' | 'order' | ''
}

/**
 * The form's only backend is our own API now — the legacy PHP host is reached
 * solely server-side (src/lib/legacy-upload.ts).
 */
export const httpService = {
  /** The currently-sold calendar year and its taken dates, both admin-controlled. */
  async getDatesTaken(): Promise<{ year: string; datesTaken: DatesTaken }> {
    const res = await fetch('/api/dates-taken')
    if (!res.ok) throw new Error(`Failed to load dates (${res.status})`)
    return res.json()
  },

  /**
   * One call replaces the old uploadToServer + sendEmail pair. Sends local date
   * parts (year/month/day), never an ISO string — UTC conversion would shift
   * US-timezone dates to the previous day. Throws on failure.
   */
  async submitOrder(
    file: File,
    formData: OrderFormData,
    date: Date,
    isFreeClaim: boolean,
  ): Promise<void> {
    const body = new FormData()
    body.append('ownerName', formData.ownerName)
    body.append('city', formData.city)
    body.append('state', formData.state)
    body.append('email', formData.email)
    body.append('dogName', formData.dogName)
    body.append('isRescue', String(formData.isRescue))
    body.append('caption', formData.caption)
    body.append('standOption', formData.standOption)
    body.append('isFreeClaim', String(isFreeClaim))
    body.append('year', String(date.getFullYear()))
    body.append('month', String(date.getMonth() + 1))
    body.append('day', String(date.getDate()))
    body.append('image', file)

    const res = await fetch('/api/orders', { method: 'POST', body })
    if (!res.ok) {
      const payload = await res.json().catch(() => null)
      throw new Error(payload?.error ?? `Order submission failed (${res.status})`)
    }
  },
}
