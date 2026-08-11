// test/cityGrid_real.test.js
// Puerto fiel de tn(): verifica invariantes reales de la retícula/manzanas.
import { describe, it, expect } from 'vitest'
import { cityGrid } from '../src/render/cityGrid.js'

const palette = [
  [0.99, 0.86, 0.66],
  [1, 0.58, 0.14],
  [0.985, 0.71, 0.52],
  [0.72, 0.55, 0.96],
  [1, 0.84, 0.79],
  [0.99, 0.45, 0.12],
]

describe('cityGrid (puerto fiel de tn)', () => {
  const Wt = 62, Gt = 13

  it('genera bloques no vacíos, dentro del semilado y con campos válidos', () => {
    const { blocks, cutsX, cutsZ } = cityGrid({ Wt, Gt, streets: 2, palette }, mulberry(1))
    expect(blocks.length).toBeGreaterThan(0)
    for (const b of blocks) {
      expect(b.hx).toBeGreaterThan(0)
      expect(b.hz).toBeGreaterThan(0)
      expect(b.cr).toBeGreaterThanOrEqual(0)
      expect(b.area).toBeGreaterThan(0)
      // margen pequeño por el radio de esquina cr
      expect(Math.abs(b.cx) + b.hx).toBeLessThanOrEqual(Wt + b.cr + 1e-6)
      expect(Math.abs(b.cz) + b.hz).toBeLessThanOrEqual(Wt + b.cr + 1e-6)
      expect(palette).toContainEqual(b.tint)
    }
    expect(Array.isArray(cutsX)).toBe(true)
    expect(Array.isArray(cutsZ)).toBe(true)
    expect(cutsX.length).toBeGreaterThan(0)
    expect(cutsZ.length).toBeGreaterThan(0)
  })

  it('clampa el nº de calles a [1,4] por eje', () => {
    const { cutsX, cutsZ } = cityGrid({ Wt, Gt, streets: 99, palette }, mulberry(2))
    expect(cutsX.length).toBeLessThanOrEqual(4)
    expect(cutsZ.length).toBeLessThanOrEqual(4)
  })

  it('la fusión de celdas produce, en al menos algún seed, un bloque bastante más grande que una celda mínima', () => {
    // Recorremos varios seeds: alguno debe fusionar celdas (groupCount>0) y producir
    // un bloque cuya área supere claramente la de una celda simple sin fusión.
    let sawBigMerge = false
    for (let seed = 1; seed <= 60 && !sawBigMerge; seed++) {
      const { blocks, groupCount } = cityGrid({ Wt, Gt, streets: 2, palette }, mulberry(seed))
      if (groupCount > 0 && blocks.some((b) => b.area > 2000)) sawBigMerge = true
    }
    expect(sawBigMerge).toBe(true)
  })
})

// PRNG determinista para el test (mismo estilo que test/cityLayout.test.js)
function mulberry(seed) {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
