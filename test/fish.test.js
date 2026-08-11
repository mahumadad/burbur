import { describe, it, expect } from 'vitest'
import { createSchools, updateSchools, scatterFish } from '../src/sim/fish.js'

// LCG determinista para reproducibilidad.
function seeded(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
const CFG = {
  schools: 2, perSchool: 20, spread: 0.82, yMin: -13.5, yMax: -3.9,
  maxSpeed: 0.06, sep: 0.9, align: 0.5, cohesion: 0.4,
  sepRadius: 0.05, neighborRadius: 0.14, wander: 0.5, turn: 2.0,
}

function meanSpread(fish, school) {
  const g = fish.filter((f) => f.school === school)
  const cx = g.reduce((a, f) => a + f.x, 0) / g.length
  const cz = g.reduce((a, f) => a + f.z, 0) / g.length
  return g.reduce((a, f) => a + Math.hypot(f.x - cx, f.z - cz), 0) / g.length
}
function meanSpeed(fish) {
  return fish.reduce((a, f) => a + Math.hypot(f.vx, f.vz, f.vy), 0) / fish.length
}

describe('createSchools', () => {
  it('crea schools*perSchool peces dentro del disco y la banda de profundidad', () => {
    const { fish } = createSchools(CFG, seeded(1))
    expect(fish.length).toBe(CFG.schools * CFG.perSchool)
    for (const f of fish) {
      expect(Math.hypot(f.x, f.z)).toBeLessThanOrEqual(CFG.spread + 1e-9)
      expect(f.y).toBeGreaterThanOrEqual(CFG.yMin - 1e-9)
      expect(f.y).toBeLessThanOrEqual(CFG.yMax + 1e-9)
      expect(f.school).toBeGreaterThanOrEqual(0)
      expect(f.school).toBeLessThan(CFG.schools)
    }
  })
})

describe('updateSchools', () => {
  it('mantiene a los peces dentro del disco y la banda tras 300 frames', () => {
    const rand = seeded(7)
    const state = createSchools(CFG, rand)
    for (let i = 0; i < 300; i++) updateSchools(state, CFG, 0.05, rand)
    for (const f of state.fish) {
      expect(Math.hypot(f.x, f.z)).toBeLessThanOrEqual(CFG.spread + 0.02)
      expect(f.y).toBeGreaterThanOrEqual(CFG.yMin - 0.05)
      expect(f.y).toBeLessThanOrEqual(CFG.yMax + 0.05)
    }
  })
})

describe('cohesión y scatter', () => {
  it('la cohesión reduce la dispersión media de un banco', () => {
    const rand = seeded(3)
    const cfg = { ...CFG, sep: 0, wander: 0, cohesion: 1.2, align: 0.2 }
    const state = createSchools(cfg, rand)
    const before = meanSpread(state.fish, 0)
    for (let i = 0; i < 120; i++) updateSchools(state, cfg, 0.05, rand)
    const after = meanSpread(state.fish, 0)
    expect(after).toBeLessThan(before)
  })
  it('scatterFish sube la velocidad media', () => {
    const rand = seeded(5)
    const state = createSchools(CFG, rand)
    const before = meanSpeed(state.fish)
    scatterFish(state, 1, rand)
    expect(meanSpeed(state.fish)).toBeGreaterThan(before)
  })
})
