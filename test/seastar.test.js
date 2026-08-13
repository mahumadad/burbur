import { describe, it, expect } from 'vitest'
import { createSeastar, updateSeastar, SEASTAR_CFG } from '../src/sim/seastar.js'

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

describe('updateSeastar', () => {
  it('se acerca al parche de choritos (quimiotaxis)', () => {
    const star = createSeastar(0, 0)
    const patches = [{ x: 20, z: 0, count: 5 }]
    const d0 = dist(star, patches[0])
    for (let i = 0; i < 20; i++) updateSeastar(star, patches, 0.1, SEASTAR_CFG)
    expect(dist(star, patches[0])).toBeLessThan(d0)
  })

  it('prefiere el parche más denso aunque esté algo más lejos', () => {
    const star = createSeastar(0, 0)
    const patches = [{ x: 10, z: 0, count: 1 }, { x: -14, z: 0, count: 40 }]
    for (let i = 0; i < 20; i++) updateSeastar(star, patches, 0.1, SEASTAR_CFG)
    expect(star.x).toBeLessThan(0) // se fue hacia el parche denso (−x)
  })

  it('come al llegar y consume una unidad del parche', () => {
    const star = createSeastar(0, 0)
    const patches = [{ x: 3, z: 0, count: 5 }]
    let ate = -1
    for (let i = 0; i < 200 && ate < 0; i++) ate = updateSeastar(star, patches, 0.1, SEASTAR_CFG)
    expect(ate).toBe(0)
    expect(patches[0].count).toBe(4)
  })

  it('tras comer respeta el refractario antes de volver a comer', () => {
    const star = createSeastar(0, 0)
    const patches = [{ x: 1, z: 0, count: 9 }]
    let ate = -1
    for (let i = 0; i < 200 && ate < 0; i++) ate = updateSeastar(star, patches, 0.1, SEASTAR_CFG)
    expect(ate).toBe(0)
    // Justo después NO puede comer de nuevo aunque esté encima.
    let second = -1
    for (let i = 0; i < 50; i++) {
      const r = updateSeastar(star, patches, 0.1, SEASTAR_CFG)
      if (r >= 0) second = r
    }
    expect(second).toBe(-1)
    expect(patches[0].count).toBe(8)
  })

  it('ignora parches vacíos y los que están fuera del radio de olfato', () => {
    const star = createSeastar(0, 0)
    const patches = [{ x: 5, z: 0, count: 0 }, { x: 500, z: 0, count: 30 }]
    const before = { x: star.x, z: star.z }
    for (let i = 0; i < 30; i++) updateSeastar(star, patches, 0.1, SEASTAR_CFG)
    expect(star.x).toBeCloseTo(before.x, 6)
    expect(star.z).toBeCloseTo(before.z, 6)
  })
})
