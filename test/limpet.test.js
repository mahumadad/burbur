import { describe, it, expect } from 'vitest'
import { createLimpet, updateLimpet, LIMPET_CFG } from '../src/sim/limpet.js'

function seeded(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
const distToScar = (l) => Math.hypot(l.x - l.scarX, l.z - l.scarZ)

describe('createLimpet', () => {
  it('arranca exactamente sobre su cicatriz', () => {
    const l = createLimpet(3, -7)
    expect(l.x).toBe(3)
    expect(l.z).toBe(-7)
    expect(distToScar(l)).toBe(0)
  })
})

describe('updateLimpet', () => {
  it('sumergida, se aleja de la cicatriz a pastorear', () => {
    const rand = seeded(1)
    const l = createLimpet(0, 0)
    for (let i = 0; i < 200; i++) updateLimpet(l, 1, 0.05, LIMPET_CFG, rand)
    expect(distToScar(l)).toBeGreaterThan(0.2)
  })

  it('nunca se aleja más que maxRadius', () => {
    const rand = seeded(7)
    const l = createLimpet(0, 0)
    for (let i = 0; i < 2000; i++) {
      updateLimpet(l, 1, 0.05, LIMPET_CFG, rand)
      expect(distToScar(l)).toBeLessThanOrEqual(LIMPET_CFG.maxRadius + 1e-9)
    }
  })

  it('al bajar la marea vuelve a su cicatriz exacta', () => {
    const rand = seeded(3)
    const l = createLimpet(2, 5)
    // Pastorea sumergida…
    for (let i = 0; i < 300; i++) updateLimpet(l, 1, 0.05, LIMPET_CFG, rand)
    expect(distToScar(l)).toBeGreaterThan(0.1)
    // …y la marea se retira: debe volver a casa.
    for (let i = 0; i < 300; i++) updateLimpet(l, 0, 0.05, LIMPET_CFG, rand)
    expect(distToScar(l)).toBeLessThan(1e-6)
    expect(l.x).toBeCloseTo(2, 9)
    expect(l.z).toBeCloseTo(5, 9)
  })

  it('emersa se queda pegada a la cicatriz (no deriva)', () => {
    const rand = seeded(11)
    const l = createLimpet(-4, 1)
    for (let i = 0; i < 500; i++) updateLimpet(l, 0, 0.05, LIMPET_CFG, rand)
    expect(distToScar(l)).toBeLessThan(1e-6)
  })
})
