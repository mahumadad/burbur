import { describe, it, expect } from 'vitest'
import { barkCell } from '../src/render/bark.js'

const TAU = Math.PI * 2

describe('barkCell', () => {
  it('es determinista', () => {
    const a = barkCell(0.31, 1.7)
    const b = barkCell(0.31, 1.7)
    expect(a.edge).toBe(b.edge)
    expect(a.id).toBe(b.id)
  })

  it('devuelve edge en [0,1] e id en [0,1)', () => {
    for (let i = 0; i < 400; i++) {
      const u = (i / 400) * 2 - 1
      const th = (i * 0.137) % TAU
      const { edge, id } = barkCell(u, th)
      expect(edge).toBeGreaterThanOrEqual(0)
      expect(edge).toBeLessThanOrEqual(1)
      expect(id).toBeGreaterThanOrEqual(0)
      expect(id).toBeLessThan(1)
    }
  })

  // La corteza da la vuelta al tronco: sin envoltura en θ se vería una costura.
  it('cierra sin costura en θ = 0 y θ = 2π', () => {
    for (const u of [-0.4, 0, 0.23, 0.51]) {
      const a = barkCell(u, 0)
      const b = barkCell(u, TAU)
      expect(b.edge).toBeCloseTo(a.edge, 10)
      expect(b.id).toBeCloseTo(a.id, 10)
    }
  })

  // Las placas son regiones anchas: recorriendo el contorno se cruzan más o menos
  // tantas fisuras como celdas hay alrededor, no una por muestra.
  it('agrupa en placas anchas alrededor del tronco', () => {
    const N = 2000
    let changes = 0
    let prev = barkCell(0.1, 0).id
    for (let i = 1; i <= N; i++) {
      const id = barkCell(0.1, (i / N) * TAU).id
      if (id !== prev) changes++
      prev = id
    }
    expect(changes).toBeGreaterThan(6)
    expect(changes).toBeLessThan(60)
  })

  // La fisura vive donde cambia la placa: ahí el borde tiene que estar cerca de 0.
  it('baja edge a ~0 justo en la frontera entre dos placas', () => {
    const N = 4000
    let prev = barkCell(0.1, 0)
    let checked = 0
    for (let i = 1; i <= N; i++) {
      const th = (i / N) * TAU
      const cur = barkCell(0.1, th)
      if (cur.id !== prev.id) {
        expect(Math.min(prev.edge, cur.edge)).toBeLessThan(0.1)
        checked++
      }
      prev = cur
    }
    expect(checked).toBeGreaterThan(0)
  })

  // Placas más altas que anchas: a lo largo del eje se cruzan menos fisuras que
  // dando la vuelta, sobre el mismo largo de superficie.
  it('alarga las placas a lo largo del eje', () => {
    const count = (fn) => {
      let changes = 0, prev = fn(0)
      for (let i = 1; i <= 2000; i++) {
        const id = fn(i / 2000)
        if (id !== prev) changes++
        prev = id
      }
      return changes
    }
    const around = count((t) => barkCell(0.1, t * TAU).id)
    const along = count((t) => barkCell(-0.5 + t, 1.1).id)
    expect(along).toBeLessThan(around)
  })
})
