import { describe, it, expect } from 'vitest'
import { extensionFromUrl, zipEntryName } from './zip-names'

describe('zipEntryName', () => {
  it('builds Month-day-DogName.ext', () => {
    expect(zipEntryName('March', 14, 'Biscuit', 'jpg', new Set())).toBe('March-14-Biscuit.jpg')
  })

  it('strips characters outside [a-zA-Z0-9-] from the dog name', () => {
    expect(zipEntryName('February', 11, 'Sir Barks-a-Lot!', 'png', new Set())).toBe(
      'February-11-SirBarks-a-Lot.png',
    )
  })

  it('suffixes -2 when the name is already taken', () => {
    const taken = new Set(['February-11-Daisy.jpg'])
    expect(zipEntryName('February', 11, 'Daisy', 'jpg', taken)).toBe('February-11-Daisy-2.jpg')
  })

  it('keeps counting past -2 for further collisions', () => {
    const taken = new Set<string>()
    expect(zipEntryName('May', 1, 'Rex', 'jpg', taken)).toBe('May-1-Rex.jpg')
    expect(zipEntryName('May', 1, 'Rex', 'jpg', taken)).toBe('May-1-Rex-2.jpg')
    expect(zipEntryName('May', 1, 'Rex', 'jpg', taken)).toBe('May-1-Rex-3.jpg')
  })

  it('records each returned name in the taken set', () => {
    const taken = new Set<string>()
    zipEntryName('July', 4, 'Bo', 'jpg', taken)
    expect(taken.has('July-4-Bo.jpg')).toBe(true)
  })

  it('falls back to "dog" when the sanitized name is empty', () => {
    expect(zipEntryName('June', 2, '???', 'jpg', new Set())).toBe('June-2-dog.jpg')
  })

  it('omits the dot when there is no extension', () => {
    expect(zipEntryName('June', 2, 'Ace', '', new Set())).toBe('June-2-Ace')
  })
})

describe('extensionFromUrl', () => {
  it('reads the extension from a plain url path', () => {
    expect(extensionFromUrl('https://example.com/a/b/photo.JPG')).toBe('jpg')
  })

  it('ignores query strings and fragments', () => {
    expect(extensionFromUrl('https://example.com/photo.png?width=100#x')).toBe('png')
  })

  it('returns an empty string when the path has no extension', () => {
    expect(extensionFromUrl('https://example.com/photo')).toBe('')
  })

  it('ignores dots in earlier path segments', () => {
    expect(extensionFromUrl('https://example.com/v1.2/photo')).toBe('')
  })

  it('drops non-alphanumeric extensions rather than trusting them', () => {
    expect(extensionFromUrl('https://example.com/photo.j pg')).toBe('')
  })

  it('handles a bare relative path', () => {
    expect(extensionFromUrl('/uploads/dog.jpeg')).toBe('jpeg')
  })
})
