/**
 * Groups orders' calendar dates into the shape the public form's date picker
 * expects: month index ("1"–"12") -> array of day-of-month strings. All 12 keys are
 * always present so the client never needs existence checks.
 */
export function groupDatesTaken(
  rows: { calendar_date: string }[],
): Record<string, string[]> {
  const grouped: Record<string, string[]> = {}
  for (let m = 1; m <= 12; m++) grouped[String(m)] = []
  for (const row of rows) {
    const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(row.calendar_date)
    if (!match) continue
    grouped[String(Number(match[1]))].push(String(Number(match[2])))
  }
  return grouped
}
