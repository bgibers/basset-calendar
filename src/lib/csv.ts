/**
 * Minimal RFC-4180 CSV writer.
 *
 * Columns come from the keys of the first row, so every row is rendered with the
 * same header order; keys only present on later rows are ignored and missing keys
 * render as empty fields. Lines are CRLF-terminated per RFC-4180.
 */
function escapeField(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s: string
  if (typeof value === 'string') {
    // Formula injection: Excel/Sheets execute a cell that opens with = + - or @.
    // Prefix an apostrophe so the spreadsheet treats it as literal text. Only
    // strings are neutralized — a real number like -5 cannot be a formula, and
    // prefixing it would corrupt the numeric column.
    s = /^[=+\-@]/.test(value) ? `'${value}` : value
  } else {
    s = String(value)
  }
  // A field must be quoted if it contains the delimiter, a quote, or a line break.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const columns = Object.keys(rows[0])
  const lines = [columns.map(escapeField).join(',')]
  for (const row of rows) {
    lines.push(columns.map(col => escapeField(row[col])).join(','))
  }
  return lines.join('\r\n')
}
