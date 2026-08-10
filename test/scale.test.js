import { describe, it, expect } from 'vitest'
import { PENTATONIC, flashToFreq } from '../src/audio/scale.js'

describe('flashToFreq', () => {
  it('la raíz cae en el fondo del rango', () => {
    expect(flashToFreq(-7, 7, 220, 3)).toBeCloseTo(220, 3)
  })
  it('más arriba = más agudo (monótono no decreciente)', () => {
    let prev = 0
    for (let y = -7; y <= 7; y += 0.5) {
      const f = flashToFreq(y, 7, 220, 3)
      expect(f).toBeGreaterThanOrEqual(prev)
      prev = f
    }
  })
  it('todas las notas pertenecen a la pentatónica', () => {
    const root = 220
    for (let y = -7; y <= 7; y += 0.3) {
      const f = flashToFreq(y, 7, root, 3)
      const semis = Math.round(12 * Math.log2(f / root))
      expect(PENTATONIC.includes(((semis % 12) + 12) % 12)).toBe(true)
    }
  })
})
