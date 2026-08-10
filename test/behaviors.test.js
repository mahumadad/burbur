import { describe, it, expect } from 'vitest'
import { createBugs, updateBugs, nearestBug } from '../src/sim/behaviors.js'

const CFG = {
  count: 30, speed: 0.1, arrive: 0.02, hoverMin: 0.6, hoverMax: 2.2,
  jitter: 0.45, fleeRadius: 0.06, respawn: 2.5,
}
const flowers = [{ x: 0.4, z: 0.2 }, { x: -0.3, z: -0.5 }, { x: 0.1, z: 0.6 }]

describe('bichitos', () => {
  it('vuelan acercándose a su flor objetivo', () => {
    const bugs = createBugs(CFG, flowers, () => 0.5)
    const b = bugs[0]
    b.x = -0.9; b.z = -0.9; b.tx = 0.4; b.tz = 0.2; b.state = 'fly'
    const d0 = Math.hypot(b.tx - b.x, b.tz - b.z)
    for (let i = 0; i < 60; i++) updateBugs([b], flowers, { ...CFG, jitter: 0 }, 0.05)
    const d1 = Math.hypot(b.tx - b.x, b.tz - b.z)
    expect(d1).toBeLessThan(d0)
  })

  it('nearestBug encuentra al bicho vivo más cercano y omite a los muertos', () => {
    const bugs = createBugs(CFG, flowers, () => 0.5)
    bugs.forEach((b) => { b.alive = true })
    bugs[0].x = 0; bugs[0].z = 0
    const idx = nearestBug(bugs, 0.005, 0.005, 0.1)
    expect(idx).toBe(0)
    bugs[0].alive = false
    expect(nearestBug(bugs, 0.005, 0.005, 0.02)).toBe(-1)
  })

  it('un bicho comido reaparece tras su tiempo de respawn', () => {
    const bugs = createBugs(CFG, flowers, () => 0.5)
    const b = bugs[0]
    b.alive = false; b.respawn = 1.0
    updateBugs([b], flowers, CFG, 0.5)
    expect(b.alive).toBe(false)
    updateBugs([b], flowers, CFG, 0.6)
    expect(b.alive).toBe(true)
  })
})
