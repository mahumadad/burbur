import { describe, it, expect } from 'vitest'
import { createRails, updateRails } from '../src/sim/rails.js'
import { createMotors, updateMotors, motorPosition } from '../src/sim/motors.js'

// Misma red que test/rails.test.js.
const RAILCFG = {
  count: 10, originX: 0.08, originZ: -0.05,
  minLen: 0.25, maxLen: 0.80,
  growRate: 0.05, shrinkRate: 0.28,
  catastrophe: 0.15, rescue: 0.45,
}

const CFG = { count: 20, speed: 0.3, detachChance: 0.15, cargoChance: 0.4 }

function seeded(seed = 1) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

/** Distancia perpendicular de (x,z) a la recta infinita del riel i (pasa por el origen, ángulo ang). */
function distToRailLine(net, i, x, z) {
  const r = net.rails[i]
  const dx = x - net.origin.x, dz = z - net.origin.z
  return Math.abs(dx * Math.sin(r.ang) - dz * Math.cos(r.ang))
}

describe('motores moleculares (kinesina/dineína)', () => {
  it('crea cfg.count motores, todos con riel válido y t en [0,1]', () => {
    const motors = createMotors(CFG, RAILCFG.count, seeded(1))
    expect(motors).toHaveLength(CFG.count)
    for (const m of motors) {
      expect(m.rail).toBeGreaterThanOrEqual(0)
      expect(m.rail).toBeLessThan(RAILCFG.count)
      expect(m.t).toBeGreaterThanOrEqual(0)
      expect(m.t).toBeLessThanOrEqual(1)
      expect([1, -1]).toContain(m.dir)
      expect(m.attached).toBe(true)
    }
  })

  it('kinesina (dir=+1) avanza hacia la periferia: su t crece en un riel estable', () => {
    const net = createRails(RAILCFG, seeded(2))
    const m = { rail: 0, t: 0.3, dir: 1, speed: 0.2, cargo: false, attached: true }
    const cfg = { ...CFG, detachChance: 0 }
    updateMotors([m], net, cfg, 0.1, () => 0.999) // rand alto: nunca dispara desprendimiento
    expect(m.t).toBeGreaterThan(0.3)
  })

  it('dineína (dir=-1) avanza hacia el centrosoma: su t decrece', () => {
    const net = createRails(RAILCFG, seeded(3))
    const m = { rail: 0, t: 0.7, dir: -1, speed: 0.2, cargo: false, attached: true }
    const cfg = { ...CFG, detachChance: 0 }
    updateMotors([m], net, cfg, 0.1, () => 0.999)
    expect(m.t).toBeLessThan(0.7)
  })

  it('motorPosition cae sobre la recta del riel (distancia ~0)', () => {
    const net = createRails(RAILCFG, seeded(4))
    const motors = createMotors(CFG, RAILCFG.count, seeded(5))
    for (const m of motors) {
      const p = motorPosition(m, net)
      expect(distToRailLine(net, m.rail, p.x, p.z)).toBeLessThan(1e-9)
    }
  })

  it('nunca queda un motor con t fuera de [0,1] tras miles de pasos, con red dinámica', () => {
    const net = createRails(RAILCFG, seeded(6))
    const motors = createMotors(CFG, RAILCFG.count, seeded(7))
    const rand = seeded(8)
    for (let i = 0; i < 5000; i++) {
      updateRails(net, RAILCFG, 1 / 60, rand)
      updateMotors(motors, net, CFG, 1 / 60, rand)
      for (const m of motors) {
        expect(m.t).toBeGreaterThanOrEqual(0)
        expect(m.t).toBeLessThanOrEqual(1)
        expect(m.rail).toBeGreaterThanOrEqual(0)
        expect(m.rail).toBeLessThan(net.rails.length)
      }
    }
  })

  it('si el riel colapsa por debajo del motor, se suelta, reengancha y su posición vuelve a ser válida', () => {
    const net = createRails({ ...RAILCFG, count: 1 }, seeded(9))
    const m = { rail: 0, t: 0.5, dir: 1, speed: 0.05, cargo: false, attached: true }
    const cfg = { ...CFG, detachChance: 0 }

    // primer paso: sincroniza referencia interna contra el largo real (riel intacto), camina normal.
    updateMotors([m], net, cfg, 0.001, () => 0.999)
    expect(m.t).toBeCloseTo(0.50005, 5)

    // el riel colapsa de golpe, muy por debajo de donde está el motor.
    net.rails[0].len = 0.001
    updateMotors([m], net, cfg, 0.001, () => 0.999)

    // se reenganchó: quedó en un extremo (0 o 1), no en su vieja posición intermedia.
    expect([0, 1]).toContain(m.t)
    const p = motorPosition(m, net)
    expect(distToRailLine(net, m.rail, p.x, p.z)).toBeLessThan(1e-9)
  })

  it('detachChance alto: el motor se suelta y reengancha espontáneamente', () => {
    const net = createRails({ ...RAILCFG, count: 1 }, seeded(10))
    const m = { rail: 0, t: 0.5, dir: 1, speed: 0.2, cargo: false, attached: true }
    const cfg = { ...CFG, detachChance: 1000 } // garantiza el desprendimiento en el primer paso
    updateMotors([m], net, cfg, 0.1, seeded(11))
    expect([0, 1]).toContain(m.t)
  })
})
