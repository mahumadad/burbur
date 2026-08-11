import { describe, it, expect } from 'vitest'
import { ROLE, roleFor, applyRoleBias } from '../src/sim/traffic.js'
import { createRoamers, updateRoamers } from '../src/sim/wander.js'

// Config de deambular calcada del bosque (ver rails.test.js), para tener un
// escenario realista de fondo sobre el que se suma el sesgo de tráfico.
const WANDER = {
  density: 0.66, wanderTurn: 2.2, wanderPush: 0.02,
  kickMin: 0.085, kickRange: 0.085, separation: 0.05, sepRadius: 0.06,
  drag: 0.965, maxSpeed: 0.075, softR: 0.58, centerPull: 1.0, bound: 0.84,
  flowFreq: 5.1, flowPush: 0.03, pathPull: 0, pathRadius: 0.14,
}

const CFG = { bias: 0.06, innerR: 0.12, outerR: 0.66 }

function seeded(seed = 1) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

function meanRadius(rs) {
  let sum = 0
  for (const r of rs) sum += Math.hypot(r.x, r.z)
  return sum / rs.length
}

describe('tráfico dirigido de la célula', () => {
  it('roleFor mapea kinesina/dineína/libre correctamente', () => {
    expect(roleFor('vesicle')).toBe(ROLE.OUT)
    expect(roleFor('secretory')).toBe(ROLE.OUT)
    expect(roleFor('lysosome')).toBe(ROLE.IN)
    expect(roleFor('endosome')).toBe(ROLE.IN)
    expect(roleFor('mitochondrion')).toBe(ROLE.FREE)
    expect(roleFor('peroxisome')).toBe(ROLE.FREE)
    expect(roleFor('algo-desconocido')).toBe(ROLE.FREE)
  })

  it('con el mismo radio de partida, los OUT terminan más lejos que los IN', () => {
    const rand = seeded(11)
    const n = 40
    const roamers = []
    const roles = []
    const r0 = 0.3
    for (let i = 0; i < n; i++) {
      const ang = rand() * 6.2832
      roamers.push({
        x: Math.cos(ang) * r0, z: Math.sin(ang) * r0,
        vx: 0, vz: 0, wanderAng: rand() * 6.2832,
        state: 'move', stateT: 1 + rand() * 4,
        speedScale: 0.6 + rand() * 0.85, hx: 0, hz: 1, onPath: false,
      })
      roles.push(i % 2 === 0 ? ROLE.OUT : ROLE.IN)
    }

    for (let i = 0; i < 600; i++) {
      const t = i * 0.05
      applyRoleBias(roamers, roles, CFG, 0.05)
      updateRoamers(roamers, WANDER, 0.05, seeded(51 + i), t)
    }

    const outRs = roamers.filter((_, i) => roles[i] === ROLE.OUT)
    const inRs = roamers.filter((_, i) => roles[i] === ROLE.IN)
    expect(meanRadius(outRs)).toBeGreaterThan(meanRadius(inRs))
  })

  it('los FREE no reciben empuje: su velocidad no cambia', () => {
    const roamers = [
      { x: 0.3, z: 0.2, vx: 0.01, vz: -0.02, wanderAng: 0, state: 'move', stateT: 1, speedScale: 1, hx: 0, hz: 1, onPath: false },
    ]
    const roles = [ROLE.FREE]
    applyRoleBias(roamers, roles, CFG, 0.05)
    expect(roamers[0].vx).toBe(0.01)
    expect(roamers[0].vz).toBe(-0.02)
  })

  it('tope interior: un IN ya en el centro no sigue recibiendo empuje hacia adentro', () => {
    const roamers = [
      { x: 0.05, z: 0, vx: 0, vz: 0, wanderAng: 0, state: 'move', stateT: 1, speedScale: 1, hx: 0, hz: 1, onPath: false },
    ]
    // radio 0.05 < innerR 0.12
    const roles = [ROLE.IN]
    applyRoleBias(roamers, roles, CFG, 0.05)
    expect(roamers[0].vx).toBe(0)
    expect(roamers[0].vz).toBe(0)
  })

  it('tope exterior: un OUT más allá de outerR no sigue recibiendo empuje hacia afuera', () => {
    const roamers = [
      { x: 0.8, z: 0, vx: 0, vz: 0, wanderAng: 0, state: 'move', stateT: 1, speedScale: 1, hx: 0, hz: 1, onPath: false },
    ]
    // radio 0.8 > outerR 0.66
    const roles = [ROLE.OUT]
    applyRoleBias(roamers, roles, CFG, 0.05)
    expect(roamers[0].vx).toBe(0)
    expect(roamers[0].vz).toBe(0)
  })

  it('un IN a medio camino sí recibe empuje hacia el centro', () => {
    const roamers = [
      { x: 0.3, z: 0, vx: 0, vz: 0, wanderAng: 0, state: 'move', stateT: 1, speedScale: 1, hx: 0, hz: 1, onPath: false },
    ]
    const roles = [ROLE.IN]
    applyRoleBias(roamers, roles, CFG, 0.05)
    expect(roamers[0].vx).toBeLessThan(0) // empuja hacia el origen, x negativo
  })

  it('un OUT a medio camino sí recibe empuje hacia afuera', () => {
    const roamers = [
      { x: 0.3, z: 0, vx: 0, vz: 0, wanderAng: 0, state: 'move', stateT: 1, speedScale: 1, hx: 0, hz: 1, onPath: false },
    ]
    const roles = [ROLE.OUT]
    applyRoleBias(roamers, roles, CFG, 0.05)
    expect(roamers[0].vx).toBeGreaterThan(0)
  })

  it('sin NaN tras miles de pasos', () => {
    const rand = seeded(77)
    const n = 20
    const roamers = createRoamers(WANDER, n, rand)
    const roles = roamers.map((_, i) => (i % 3 === 0 ? ROLE.OUT : i % 3 === 1 ? ROLE.IN : ROLE.FREE))
    for (let i = 0; i < 4000; i++) {
      const t = i * 0.033
      applyRoleBias(roamers, roles, CFG, 0.033)
      updateRoamers(roamers, WANDER, 0.033, seeded(200 + i), t)
    }
    for (const r of roamers) {
      expect(Number.isFinite(r.x)).toBe(true)
      expect(Number.isFinite(r.z)).toBe(true)
      expect(Number.isFinite(r.vx)).toBe(true)
      expect(Number.isFinite(r.vz)).toBe(true)
    }
  })
})
