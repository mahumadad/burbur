import { describe, it, expect } from 'vitest'
import { createRoamers, updateRoamers } from '../src/sim/wander.js'
import { createPaths, nearestOnPaths } from '../src/sim/paths.js'

const BASE = {
  density: 0.66, wanderTurn: 2.2, wanderPush: 0.055,
  kickMin: 0.085, kickRange: 0.085, separation: 0.16, sepRadius: 0.10,
  drag: 0.965, maxSpeed: 0.075, bound: 0.80,
  flowFreq: 5.1, flowPush: 0.030, pathPull: 0, pathRadius: 0.14,
}
const PATHS_CFG = { loopCount: 3, minRadius: 0.34, maxRadius: 0.72, samples: 46 }

/** Distancia media de los individuos al camino más cercano. */
function meanDistToPath(rs, paths) {
  let sum = 0
  for (const r of rs) sum += Math.sqrt(nearestOnPaths(paths, r.x, r.z).d2)
  return sum / rs.length
}

describe('deambular', () => {
  it('se mantiene dentro de la isla', () => {
    const rs = createRoamers(BASE, 20, Math.random)
    for (let i = 0; i < 3000; i++) updateRoamers(rs, BASE, 0.05, Math.random, i * 0.05)
    for (const r of rs) expect(Math.hypot(r.x, r.z)).toBeLessThan(1)
  })

  it('con pathPull=0 los individuos NO quedan pegados a los caminos', () => {
    const paths = createPaths(PATHS_CFG, Math.random)
    const rs = createRoamers(BASE, 24, Math.random)
    for (let i = 0; i < 2000; i++) {
      updateRoamers(rs, BASE, 0.05, Math.random, i * 0.05, paths, nearestOnPaths)
    }
    expect(meanDistToPath(rs, paths)).toBeGreaterThan(0.05)
  })

  it('subir pathPull los acerca a los caminos (palanca para calles de ciudad)', () => {
    const paths = createPaths(PATHS_CFG, Math.random)
    const free = createRoamers(BASE, 24, Math.random)
    const bound = createRoamers(BASE, 24, Math.random)
    const strong = { ...BASE, pathPull: 1.6, pathRadius: 0.5 }
    for (let i = 0; i < 2000; i++) {
      const t = i * 0.05
      updateRoamers(free, BASE, 0.05, Math.random, t, paths, nearestOnPaths)
      updateRoamers(bound, strong, 0.05, Math.random, t, paths, nearestOnPaths)
    }
    expect(meanDistToPath(bound, paths)).toBeLessThan(meanDistToPath(free, paths))
  })
})
