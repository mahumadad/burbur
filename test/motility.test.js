import { describe, it, expect } from 'vitest'
import { createMotility, updateMotility, migrationSpeed } from '../src/sim/motility.js'

const CFG = {
  turnRate: 1.5,      // cuán rápido puede reorientar el frente (rad/s)
  bias: 1.0,          // fuerza del sesgo quimiotáctico
  noise: 1.2,         // deriva aleatoria del rumbo
  maxSpeed: 0.09,     // velocidad máxima de migración (normalizada/s)
  protrusionGain: 3,  // rapidez con que la protrusión sigue al ATP
  atpFloor: 0.25,     // por debajo de esto no alcanza para lamelipodio
}

function seeded(seed = 1) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

const FED = { atp: 1, adhesion: 0.5, rounding: 0 }

/** Corre `secs` a 60 fps y devuelve el estado. */
function run(mot, secs, input, rand = seeded(5)) {
  const dt = 1 / 60
  for (let i = 0; i < secs * 60; i++) updateMotility(mot, CFG, dt, rand, input)
  return mot
}

/** Diferencia angular más corta, en [-π, π]. */
function angDiff(a, b) {
  let d = (a - b) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  else if (d < -Math.PI) d += Math.PI * 2
  return d
}

describe('motilidad', () => {
  it('nace polarizada: tiene un frente definido', () => {
    const mot = createMotility(CFG, seeded(1))
    expect(Number.isFinite(mot.frontAngle)).toBe(true)
  })

  it('persigue el gradiente: el frente se reorienta hacia la fuente', () => {
    const mot = createMotility(CFG, seeded(2))
    mot.frontAngle = Math.PI // arranca dándole la espalda a la fuente
    run(mot, 20, { ...FED, source: { x: 1, z: 0 } })
    expect(Math.abs(angDiff(mot.frontAngle, 0))).toBeLessThan(0.8)
  })

  it('sin fuente el rumbo deriva en vez de congelarse', () => {
    const mot = createMotility(CFG, seeded(3))
    const start = mot.frontAngle
    run(mot, 20, { ...FED, source: null })
    expect(Math.abs(angDiff(mot.frontAngle, start))).toBeGreaterThan(0.05)
  })

  it('no gira de golpe: la reorientación tiene inercia', () => {
    const mot = createMotility(CFG, seeded(4))
    mot.frontAngle = 0
    const dt = 1 / 60
    updateMotility(mot, CFG, dt, seeded(9), { ...FED, source: { x: -1, z: 0 } })
    // La fuente está a 180°, pero en un frame solo puede girar turnRate*dt.
    expect(Math.abs(angDiff(mot.frontAngle, 0))).toBeLessThanOrEqual(CFG.turnRate * dt + 1e-9)
  })

  it('la velocidad es bifásica en la adhesión: patina o se ancla', () => {
    const loose = migrationSpeed(CFG, 1, 0.02)
    const optimal = migrationSpeed(CFG, 1, 0.5)
    const stuck = migrationSpeed(CFG, 1, 0.98)
    expect(optimal).toBeGreaterThan(loose)
    expect(optimal).toBeGreaterThan(stuck)
  })

  it('sin protrusión no hay avance por mucha adhesión que haya', () => {
    expect(migrationSpeed(CFG, 0, 0.5)).toBe(0)
  })

  it('sin ATP la protrusión se apaga y la célula se detiene', () => {
    const mot = createMotility(CFG, seeded(5))
    run(mot, 10, { ...FED, atp: 1, source: { x: 1, z: 0 } })
    expect(mot.protrusion).toBeGreaterThan(0.5)
    run(mot, 10, { ...FED, atp: 0, source: { x: 1, z: 0 } })
    expect(mot.protrusion).toBeLessThan(0.1)
    expect(mot.speed).toBeLessThan(0.01)
  })

  it('con poco ATP cambia de lamelipodio a blebbing', () => {
    const mot = createMotility(CFG, seeded(6))
    run(mot, 10, { ...FED, atp: 1 })
    expect(mot.blebbing).toBeLessThan(0.2)
    run(mot, 10, { ...FED, atp: 0.1 })
    expect(mot.blebbing).toBeGreaterThan(0.5)
    expect(mot.protrusion).toBeLessThan(0.3)
  })

  it('el sustrato se desliza en sentido contrario al avance', () => {
    const mot = createMotility(CFG, seeded(7))
    mot.frontAngle = 0
    // Rumbo fijo hacia +x: sin ruido de rumbo el sustrato debe correr hacia -x.
    run(mot, 6, { ...FED, source: { x: 1, z: 0 } }, () => 0.5)
    expect(mot.subX).toBeLessThan(0)
    expect(Math.abs(mot.subZ)).toBeLessThan(Math.abs(mot.subX))
  })

  it('el redondeo mitótico detiene la migración', () => {
    const mot = createMotility(CFG, seeded(8))
    run(mot, 10, { ...FED, source: { x: 1, z: 0 } })
    expect(mot.speed).toBeGreaterThan(0)
    run(mot, 5, { ...FED, source: { x: 1, z: 0 }, rounding: 1 })
    expect(mot.speed).toBeLessThan(0.01)
    expect(mot.protrusion).toBeLessThan(0.1)
  })
})
