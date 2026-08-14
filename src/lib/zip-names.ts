/**
 * Filename helpers for the monthly photo ZIP export.
 */

/**
 * Extension of the last path segment of a URL, lowercased and without the dot.
 * Query strings and fragments are ignored, as are dots in earlier segments.
 * Anything that isn't purely alphanumeric is dropped rather than trusted into a
 * filename. Returns '' when there is no usable extension.
 */
export function extensionFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0]
  const segment = path.split('/').pop() ?? ''
  const dot = segment.lastIndexOf('.')
  if (dot <= 0 || dot === segment.length - 1) return ''
  const ext = segment.slice(dot + 1).toLowerCase()
  return /^[a-z0-9]+$/.test(ext) ? ext : ''
}

/**
 * `{Month}-{day}-{DogName}.{ext}`, with the dog name reduced to [a-zA-Z0-9-].
 *
 * Two orders can share a calendar_date (the legacy data has a Feb 11 duplicate),
 * so a name already in `taken` gets a `-2`, `-3`, … suffix. The returned name is
 * added to `taken`, making repeated calls with the same set collision-free.
 */
export function zipEntryName(
  month: string,
  day: number,
  dogName: string,
  ext: string,
  taken: Set<string>,
): string {
  const safeDog = dogName.replace(/[^a-zA-Z0-9-]+/g, '') || 'dog'
  const suffix = ext ? `.${ext}` : ''
  const base = `${month}-${day}-${safeDog}`
  let name = `${base}${suffix}`
  let n = 1
  while (taken.has(name)) {
    n += 1
    name = `${base}-${n}${suffix}`
  }
  taken.add(name)
  return name
}
