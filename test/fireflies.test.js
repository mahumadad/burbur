import { describe, it, expect } from 'vitest'
import { stepPhases, phaseVariance, createSwarm, updateSwarm } from '../src/sim/fireflies.js'
import { CONFIG } from '../src/config.js'

describe('stepPhases (Kuramoto)', () => {
  it('dos osciladores acoplados convergen en fase', () => {
    const phases = [0.2, 2.9]      // muy desfasados
    const omegas = [1.0, 1.0]      // misma frecuencia natural
    const adjacency = [[1], [0]]   // mutuamente vecinos
    const K = 3.0
    const dt = 0.02
    const before = phaseVariance(phases)
    for (let i = 0; i < 2000; i++) stepPhases(phases, omegas, adjacency, K, dt)
    const after = phaseVariance(phases)
    expect(after).toBeLessThan(before)
    expect(after).toBeLessThan(0.02) // prácticamente sincronizados
  })

  it('marca cruce de 2π como destello', () => {
    const phases = [6.2]           // cerca de 2π (~6.283)
    const omegas = [2.0]
    const adjacency = [[]]
    const crossed = stepPhases(phases, omegas, adjacency, 0, 0.1)
    expect(crossed).toEqual([0])
    expect(phases[0]).toBeLessThan(1) // wrapeó
  })

  it('phaseVariance es 0 con fases idénticas', () => {
    expect(phaseVariance([1.3, 1.3, 1.3])).toBeCloseTo(0, 6)
  })
})

describe('swarm', () => {
  it('createSwarm respeta el count y llena arrays', () => {
    const s = createSwarm(CONFIG.fireflies, () => 0.5)
    expect(s.count).toBe(CONFIG.fireflies.count)
    expect(s.pos.length).toBe(CONFIG.fireflies.count * 3)
    expect(s.phases.length).toBe(CONFIG.fireflies.count)
  })

  it('updateSwarm retorna destellos con coordenadas', () => {
    const cfg = { ...CONFIG.fireflies, count: 40 }
    const s = createSwarm(cfg, () => 0.9) // fases altas → cruzan pronto
    let seen = 0
    for (let f = 0; f < 200; f++) {
      const flashes = updateSwarm(s, cfg, 0.05)
      for (const fl of flashes) {
        expect(typeof fl.x).toBe('number')
        expect(fl.intensity).toBeGreaterThan(0)
        seen++
      }
    }
    expect(seen).toBeGreaterThan(0)
  })
})
