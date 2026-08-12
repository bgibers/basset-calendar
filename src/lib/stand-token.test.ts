import { describe, expect, it } from 'vitest'
import { isStandOption, isValidStandToken, VALID_STAND_OPTIONS } from './stand-token'

describe('isValidStandToken', () => {
  it('accepts a canonical lowercase uuid', () => {
    expect(isValidStandToken('4a1c2b3d-1111-4222-8333-444455556666')).toBe(true)
  })

  it('accepts an uppercase uuid', () => {
    expect(isValidStandToken('4A1C2B3D-1111-4222-8333-444455556666')).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['garbage', 'not-a-token'],
    ['missing hyphens', '4a1c2b3d11114222833344445555 6666'.replace(' ', '')],
    ['too short', '4a1c2b3d-1111-4222-8333-44445555666'],
    ['too long', '4a1c2b3d-1111-4222-8333-4444555566667'],
    ['non-hex characters', '4a1c2b3g-1111-4222-8333-444455556666'],
    ['leading whitespace', ' 4a1c2b3d-1111-4222-8333-444455556666'],
    ['trailing newline', '4a1c2b3d-1111-4222-8333-444455556666\n'],
    ['sql-ish injection attempt', "' OR 1=1 --"],
    ['path traversal', '../../etc/passwd'],
  ])('rejects %s', (_label, token) => {
    expect(isValidStandToken(token)).toBe(false)
  })

  it.each([null, undefined, 42, {}, []])('rejects non-string %s', value => {
    expect(isValidStandToken(value)).toBe(false)
  })
})

describe('isStandOption', () => {
  it('accepts every advertised option', () => {
    for (const option of VALID_STAND_OPTIONS) expect(isStandOption(option)).toBe(true)
  })

  it.each(['order', 'HAVE-BLACK', '', null, undefined, 1, {}])(
    'rejects %s',
    value => {
      expect(isStandOption(value)).toBe(false)
    },
  )
})
