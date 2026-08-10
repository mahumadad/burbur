// test/cityLayout.test.js
import { describe, it, expect } from 'vitest'
import { cityLayout } from '../src/render/cityLayout.js'

describe('cityLayout', () => {
  const Wt = 62, Gt = 13
  it('con streets=2 genera una grilla de bloques dentro del semilado', () => {
    const { blocks } = cityLayout({ Wt, Gt, streets: 2 }, mulberry(1))
    expect(blocks.length).toBeGreaterThanOrEqual(4) // 2x2 mínimo
    for (const b of blocks) {
      expect(b.hx).toBeGreaterThan(0); expect(b.hz).toBeGreaterThan(0)
      expect(Math.abs(b.cx) + b.hx).toBeLessThanOrEqual(Wt + 1e-6)
      expect(Math.abs(b.cz) + b.hz).toBeLessThanOrEqual(Wt + 1e-6)
    }
  })
  it('clampa el nº de calles a [1,4]', () => {
    const many = cityLayout({ Wt, Gt, streets: 99 }, mulberry(2))
    expect(many.blocks.length).toBeLessThanOrEqual(6 * 6)
  })
})
// PRNG determinista para el test
function mulberry(seed) {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
