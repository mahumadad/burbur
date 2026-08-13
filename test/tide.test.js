import { describe, it, expect } from 'vitest'
import { tideLevel } from '../src/sim/tide.js'

describe('tideLevel', () => {
  it('marca dos bajamares (fases 0 y 6) y dos pleamares (fases 3 y 9)', () => {
    expect(tideLevel(0)).toBeCloseTo(0, 6)
    expect(tideLevel(3)).toBeCloseTo(1, 6)
    expect(tideLevel(6)).toBeCloseTo(0, 6)
    expect(tideLevel(9)).toBeCloseTo(1, 6)
  })

  it('siempre devuelve un valor en [0,1]', () => {
    for (let i = 0; i < 12; i++) {
      for (let t = 0; t < 1; t += 0.1) {
        const v = tideLevel(i, t)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('tiene exactamente 2 máximos y 2 mínimos locales en una vuelta', () => {
    const N = 240
    const s = []
    for (let k = 0; k < N; k++) {
      const x = (k / N) * 12
      s.push(tideLevel(Math.floor(x), x - Math.floor(x)))
    }
    let maxs = 0, mins = 0
    for (let k = 0; k < N; k++) {
      const prev = s[(k - 1 + N) % N], cur = s[k], next = s[(k + 1) % N]
      if (cur > prev && cur >= next) maxs++
      if (cur < prev && cur <= next) mins++
    }
    expect(maxs).toBe(2)
    expect(mins).toBe(2)
  })

  it('es continua en el wrap de la fase 11 a la 0', () => {
    expect(tideLevel(11, 0.999)).toBeCloseTo(tideLevel(0, 0), 2)
  })

  it('normaliza índices fuera de rango (envuelve)', () => {
    expect(tideLevel(12)).toBeCloseTo(tideLevel(0), 6)
    expect(tideLevel(15)).toBeCloseTo(tideLevel(3), 6)
  })
})
