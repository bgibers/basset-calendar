import { describe, it, expect } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('')
  })

  it('writes a header from the first row keys, then one line per row', () => {
    const csv = toCsv([
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ])
    expect(csv).toBe('a,b\r\n1,x\r\n2,y')
  })

  it('quotes fields containing a comma', () => {
    expect(toCsv([{ a: 'one,two' }])).toBe('a\r\n"one,two"')
  })

  it('quotes fields containing a newline', () => {
    expect(toCsv([{ a: 'line1\nline2' }])).toBe('a\r\n"line1\nline2"')
  })

  it('quotes fields containing a double quote and doubles the inner quotes', () => {
    expect(toCsv([{ a: 'say "hi"' }])).toBe('a\r\n"say ""hi"""')
  })

  it('quotes a header containing a comma or quote', () => {
    expect(toCsv([{ 'a,b': 1, 'c"d': 2 }])).toBe('"a,b","c""d"\r\n1,2')
  })

  it('renders null and undefined as empty fields', () => {
    expect(toCsv([{ a: null, b: undefined, c: 0 }])).toBe('a,b,c\r\n,,0')
  })

  it('renders booleans and numbers via String()', () => {
    expect(toCsv([{ a: false, b: 3.5 }])).toBe('a,b\r\nfalse,3.5')
  })

  it('uses the first row for column order and tolerates rows missing keys', () => {
    const csv = toCsv([
      { a: 1, b: 2 },
      { b: 4 } as Record<string, unknown>,
    ])
    expect(csv).toBe('a,b\r\n1,2\r\n,4')
  })

  it('ignores keys that are absent from the first row', () => {
    const csv = toCsv([{ a: 1 }, { a: 2, extra: 'nope' }])
    expect(csv).toBe('a\r\n1\r\n2')
  })
})
