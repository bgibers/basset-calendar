export type ParsedOrder = {
  ownerName: string
  city: string
  state: string
  email: string
  dogName: string
  isRescue: boolean
  caption: string
}

type FieldKey = keyof Omit<ParsedOrder, 'isRescue'> | 'isRescue'

/** Field labels exactly as they appear at the start of a line in legacy data.txt files. */
const FIELDS: Array<[FieldKey, string]> = [
  ['ownerName', 'Owner Name'],
  ['city', 'City'],
  ['state', 'State'],
  ['email', 'Email'],
  ['dogName', 'Dog Name'],
  ['isRescue', 'IsRescue'],
  ['caption', 'Caption'],
]

/** Matches a line that begins a new field, returning the field key and its inline value. */
function matchField(line: string): [FieldKey, string] | null {
  for (const [key, label] of FIELDS) {
    if (line === label) return [key, '']
    if (line.startsWith(`${label} `)) return [key, line.slice(label.length).trim()]
  }
  return null
}

/**
 * Parses a legacy `data.txt` order file exported from the old server.
 *
 * Each field sits on its own (usually indented) line as `Label value`, separated by
 * blank lines. Values may be empty, and the caption — the only multi-line field —
 * continues onto any following lines that do not start a new field.
 */
export function parseOrderData(raw: string): ParsedOrder {
  const values: Partial<Record<FieldKey, string>> = {}
  let current: FieldKey | null = null

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    const match = matchField(trimmed)

    if (match) {
      const [key, value] = match
      values[key] = value
      current = key
    } else if (current === 'caption' && trimmed !== '') {
      values.caption += `\n${trimmed}`
    }
  }

  if (current === null) throw new Error('unrecognized data.txt format')

  return {
    ownerName: values.ownerName ?? '',
    city: values.city ?? '',
    state: values.state ?? '',
    email: values.email ?? '',
    dogName: values.dogName ?? '',
    isRescue: values.isRescue === 'true',
    caption: (values.caption ?? '').trim(),
  }
}
