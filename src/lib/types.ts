export type StandOption = 'have-black' | 'have-clear' | 'ordered'

export interface Order {
  id: string
  calendar_date: string
  owner_name: string
  city: string
  state: string
  email: string
  dog_name: string
  is_rescue: boolean
  caption: string
  image_url: string | null
  thumb_url: string | null
  stand_option: StandOption | null
  stand_option_source: 'customer' | 'admin' | null
  stand_token: string
  stand_emails_sent: number
  stand_last_emailed_at: string | null
  source: 'migrated' | 'web'
  created_at: string
}

export const STAND_LABELS: Record<StandOption, string> = {
  'have-black': 'Has black stand',
  'have-clear': 'Has clear stand',
  'ordered': 'Ordered a stand',
}
