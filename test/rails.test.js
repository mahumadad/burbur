import { describe, it, expect } from 'vitest'
import { createRails, updateRails, nearestOnRails } from '../src/sim/rails.js'
import { createRoamers, updateRoamers } from '../src/sim/wander.js'

// El centrosoma no está en el centro exacto del mundo: se apoya junto al núcleo.
const CFG = {
  count: 14, originX: 0.08, originZ: -0.05,
  minLen: 0.25, maxLen: 0.80,
  growRate: 0.05, shrinkRate: 0.28,   // el colapso es MUCHO más rápido que el crecimiento
  catastrophe: 0.15, rescue: 0.45,    // probabilidad por segundo
}

// Config de deambular calcada del bosque, para probar que el core sirve igual.
const WANDER = {
  density: 0.66, wanderTurn: 2.2, wanderPush: 0.02,
  kickMin: 0.085, kickRange: 0.085, separation: 0.05, sepRadius: 0.06,
  drag: 0.965, maxSpeed: 0.075, softR: 0.58, centerPull: 1.0, bound: 0.84,
  flowFreq: 5.1, flowPush: 0.03, pathPull: 0, pathRadius: 0.14,
}

function seeded(seed = 1) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

/** Distancia media de los individuos al riel más cercano. */
function meanDistToRails(rs, net) {
  let sum = 0
  for (const r of rs) sum += Math.sqrt(nearestOnRails(net, r.x, r.z).d2)
  return sum / rs.length
}

describe('rieles del citoesqueleto', () => {
  it('los microtúbulos irradian desde el centrosoma', () => {
    const net = createRails(CFG, seeded(1))
    expect(net.rails).toHaveLength(CFG.count)
    expect(net.origin.x).toBe(CFG.originX)
    expect(net.origin.z).toBe(CFG.originZ)
    for (const r of net.rails) {
      expect(r.len).toBeGreaterThanOrEqual(CFG.minLen)
      expect(r.len).toBeLessThanOrEqual(CFG.maxLen)
    }
  })

  it('reparte los rieles en direcciones distintas', () => {
    const net = createRails(CFG, seeded(2))
    const angles = new Set(net.rails.map((r) => Math.round(r.ang * 100)))
    expect(angles.size).toBeGreaterThan(CFG.count * 0.7)
  })

  it('nearestOnRails cumple el contrato de wander.js: {x, z, d2}', () => {
    const net = createRails(CFG, seeded(3))
    const got = nearestOnRails(net, 0.3, 0.2)
    expect(got).toHaveProperty('x')
    expect(got).toHaveProperty('z')
    expect(got).toHaveProperty('d2')
    expect(got.d2).toBeGreaterThanOrEqual(0)
  })

  it('un punto sobre un riel está a distancia ~0 de la red', () => {
    const net = createRails(CFG, seeded(4))
    const r = net.rails[0]
    const mid = r.len * 0.5
    const x = net.origin.x + Math.cos(r.ang) * mid
    const z = net.origin.z + Math.sin(r.ang) * mid
    expect(nearestOnRails(net, x, z).d2).toBeLessThan(1e-6)
  })

  it('proyecta sobre el segmento: más allá de la punta, lo cercano es la punta', () => {
    const net = createRails({ ...CFG, count: 1 }, seeded(5))
    const r = net.rails[0]
    const beyond = r.len + 0.5
    const x = net.origin.x + Math.cos(r.ang) * beyond
    const z = net.origin.z + Math.sin(r.ang) * beyond
    const got = nearestOnRails(net, x, z)
    const tipX = net.origin.x + Math.cos(r.ang) * r.len
    const tipZ = net.origin.z + Math.sin(r.ang) * r.len
    expect(got.x).toBeCloseTo(tipX, 6)
    expect(got.z).toBeCloseTo(tipZ, 6)
  })

  it('inestabilidad dinámica: crecen, colapsan y se rescatan', () => {
    const net = createRails(CFG, seeded(6))
    const rand = seeded(21)
    const seen = new Set()
    for (let i = 0; i < 3000; i++) {
      updateRails(net, CFG, 1 / 60, rand)
      for (const r of net.rails) seen.add(r.state)
    }
    expect(seen.has('grow')).toBe(true)
    expect(seen.has('shrink')).toBe(true)
  })

  it('nunca se pasan de largo ni desaparecen del todo', () => {
    const net = createRails(CFG, seeded(7))
    const rand = seeded(22)
    let min = Infinity, max = -Infinity
    for (let i = 0; i < 6000; i++) {
      updateRails(net, CFG, 1 / 60, rand)
      for (const r of net.rails) {
        if (r.len < min) min = r.len
        if (r.len > max) max = r.len
      }
    }
    expect(min).toBeGreaterThan(0)
    expect(max).toBeLessThanOrEqual(CFG.maxLen)
  })

  it('el colapso es más rápido que el crecimiento', () => {
    const net = createRails({ ...CFG, count: 1, catastrophe: 0, rescue: 0 }, seeded(8))
    const rail = net.rails[0]
    rail.len = 0.5
    rail.state = 'grow'
    const before = rail.len
    updateRails(net, CFG, 1, () => 1) // rand=1: nunca dispara transición
    const grew = rail.len - before

    rail.len = 0.5
    rail.state = 'shrink'
    updateRails(net, CFG, 1, () => 1)
    const shrank = 0.5 - rail.len

    expect(grew).toBeGreaterThan(0)
    expect(shrank).toBeGreaterThan(grew)
  })

  it('los organelos viajan SOBRE los rieles: el core del bosque sirve sin cambios', () => {
    const net = createRails(CFG, seeded(9))
    const free = createRoamers(WANDER, 18, seeded(31))
    const railed = createRoamers(WANDER, 18, seeded(31))
    // pathPull alto = rieles de verdad, no sendas sugeridas (como las calles).
    const onRails = { ...WANDER, pathPull: 1.8, pathRadius: 0.5 }
    for (let i = 0; i < 2000; i++) {
      const t = i * 0.05
      updateRoamers(free, WANDER, 0.05, seeded(41 + i), t, net, nearestOnRails)
      updateRoamers(railed, onRails, 0.05, seeded(41 + i), t, net, nearestOnRails)
    }
    expect(meanDistToRails(railed, net)).toBeLessThan(meanDistToRails(free, net))
  })
})
