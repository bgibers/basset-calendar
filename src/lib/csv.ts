/**
 * Minimal RFC-4180 CSV writer.
 *
 * Columns come from the keys of the first row, so every row is rendered with the
 * same header order; keys only present on later rows are ignored and missing keys
 * render as empty fields. Lines are CRLF-terminated per RFC-4180.
 */
function escapeField(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = typeof value === 'string' ? value : String(value)
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
