import { describe, it, expect } from 'vitest'
import { anemoneOpen } from '../src/sim/anemone.js'

describe('anemoneOpen', () => {
  it('emersa (sin agua) se cierra del todo', () => {
    expect(anemoneOpen(0, 0)).toBeCloseTo(0, 6)
  })

  it('sumergida y en calma se abre del todo', () => {
    expect(anemoneOpen(1, 0)).toBeCloseTo(1, 6)
  })

  it('abre más cuanto más sumergida está (monótona creciente)', () => {
    let prev = -1
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const v = anemoneOpen(s, 0)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('se retrae cuanto más fuerte el oleaje (monótona decreciente)', () => {
    let prev = 2
    for (let a = 0; a <= 1.0001; a += 0.05) {
      const v = anemoneOpen(1, a)
      expect(v).toBeLessThanOrEqual(prev)
      prev = v
    }
  })

  it('nunca sale del rango [0,1]', () => {
    for (let s = -0.5; s <= 1.5; s += 0.1) {
      for (let a = -0.5; a <= 1.5; a += 0.1) {
        const v = anemoneOpen(s, a)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('con marejada fuerte queda a medio retraer, no cerrada', () => {
    const v = anemoneOpen(1, 1)
    expect(v).toBeGreaterThan(0.15)
    expect(v).toBeLessThan(0.6)
  })
})
