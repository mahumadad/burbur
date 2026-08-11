import { describe, it, expect } from 'vitest'
import { leafShape } from '../src/render/tree/leafShape.js'
import { SPECIES } from '../src/render/tree/species.js'

const ESPECIES = Object.keys(SPECIES)

describe('leafShape', () => {
  it('devuelve un polígono cerrado con suficientes puntos', () => {
    for (const e of ESPECIES) {
      const p = leafShape(e, 'leaf')
      expect(p.length, `${e}`).toBeGreaterThanOrEqual(8)
      for (const [x, y] of p) {
        expect(Number.isFinite(x) && Number.isFinite(y), `${e}`).toBe(true)
      }
    }
  })

  it('cabe en el cuadrado unitario centrado en el origen', () => {
    for (const e of ESPECIES) {
      for (const [x, y] of leafShape(e, 'leaf')) {
        expect(Math.abs(x), `${e}`).toBeLessThanOrEqual(0.5)
        expect(Math.abs(y), `${e}`).toBeLessThanOrEqual(0.5)
      }
    }
  })

  it('las especies no comparten todas la misma silueta', () => {
    const firmas = new Set(ESPECIES.map((e) => JSON.stringify(leafShape(e, 'leaf'))))
    expect(firmas.size).toBeGreaterThan(1)
  })

  it('la flor es más redonda que la hoja', () => {
    // Relación ancho/alto: la hoja es alargada, la flor tiende a 1.
    const razon = (pts) => {
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
      const w = Math.max(...xs) - Math.min(...xs)
      const h = Math.max(...ys) - Math.min(...ys)
      return w / h
    }
    expect(razon(leafShape('manzano', 'flower')))
      .toBeGreaterThan(razon(leafShape('manzano', 'leaf')))
  })
})
