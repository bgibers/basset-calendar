import { describe, it, expect } from 'vitest'
import { parseOrderData } from './parse-order-data'

const sample = `
    Owner Name Hannah and Michael Young

    City Spring Lake

    State NC

    Email hantasticgrace@yahoo.com

    Dog Name Clyde and Fred

    IsRescue true

    Caption Two peas in a pod. 
    `

describe('parseOrderData', () => {
  it('parses a standard order', () => {
    expect(parseOrderData(sample)).toEqual({
      ownerName: 'Hannah and Michael Young',
      city: 'Spring Lake',
      state: 'NC',
      email: 'hantasticgrace@yahoo.com',
      dogName: 'Clyde and Fred',
      isRescue: true,
      caption: 'Two peas in a pod.',
    })
  })

  it('handles empty email', () => {
    const s = sample.replace('Email hantasticgrace@yahoo.com', 'Email ')
    expect(parseOrderData(s).email).toBe('')
  })

  it('preserves multi-line captions', () => {
    const s = sample.replace(
      'Caption Two peas in a pod. ',
      'Caption Line one\nLine two'
    )
    expect(parseOrderData(s).caption).toBe('Line one\nLine two')
  })

  it('throws on garbage', () => {
    expect(() => parseOrderData('hello world')).toThrow('unrecognized')
  })
})
