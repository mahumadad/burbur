import { describe, it, expect } from 'vitest'
import { createSubstrate, resourceAt, consume, updateDecay, decayClass } from '../src/sim/decay.js'

// Cápsula angosta e inclinada, con hojarasca alrededor y algunos cadáveres
// (la única fuente real de nitrógeno).
const CFG = {
  logAngle: 0.35,
  logHalfLength: 0.6,
  logRadius: 0.22,
  barkFrac: 0.12,
  sapwoodFrac: 0.38, // el resto del radio (0.5) es duramen
  carcasses: 3,
  litterDensity: 1,
  gridSize: 48,
  hardness: { bark: 0.5, sapwood: 0.25, heartwood: 0.9 },
}

function seeded(seed = 1) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

describe('sustrato: el tronco podrido y su despensa', () => {
  it('crea la grilla de agotamiento y dispersa los cadáveres con el PRNG dado', () => {
    const sub = createSubstrate(CFG, seeded(1))
    expect(sub.grid).toHaveLength(CFG.gridSize * CFG.gridSize)
    expect(sub.cfg.carcasses).toHaveLength(CFG.carcasses)
    // Nada consumido todavía.
    expect(Array.from(sub.grid).every((v) => v === 0)).toBe(true)
  })

  it('el eje del tronco es duramen; alejándose radialmente aparece albura y después corteza', () => {
    const sub = createSubstrate(CFG, seeded(2))
    const ax = Math.cos(CFG.logAngle), az = Math.sin(CFG.logAngle)
    const px = -az, pz = ax // perpendicular al eje

    expect(resourceAt(sub, 0, 0).layer).toBe('heartwood')

    const sap = resourceAt(sub, px * CFG.logRadius * 0.75, pz * CFG.logRadius * 0.75)
    expect(sap.layer).toBe('sapwood')

    const bark = resourceAt(sub, px * CFG.logRadius * 0.95, pz * CFG.logRadius * 0.95)
    expect(bark.layer).toBe('bark')
  })

  it('bien afuera del tronco hay hojarasca, y más lejos todavía no hay nada', () => {
    const sub = createSubstrate(CFG, seeded(3))
    const ax = Math.cos(CFG.logAngle), az = Math.sin(CFG.logAngle)
    const px = -az, pz = ax

    const litter = resourceAt(sub, px * (CFG.logRadius + 0.1), pz * (CFG.logRadius + 0.1))
    expect(litter.layer).toBe('litter')

    const none = resourceAt(sub, px * 5, pz * 5)
    expect(none.layer).toBe('none')
  })

  it('el duramen es más duro que la albura, y da más carbono', () => {
    const sub = createSubstrate(CFG, seeded(4))
    const ax = Math.cos(CFG.logAngle), az = Math.sin(CFG.logAngle)
    const px = -az, pz = ax

    const heart = resourceAt(sub, 0, 0)
    const sap = resourceAt(sub, px * CFG.logRadius * 0.75, pz * CFG.logRadius * 0.75)

    expect(heart.hardness).toBeGreaterThan(sap.hardness)
    expect(heart.carbon).toBeGreaterThan(sap.carbon)
  })

  it('la madera casi no da nitrógeno; un cadáver sí — es la única fuente real', () => {
    const sub = createSubstrate(CFG, seeded(5))
    const wood = resourceAt(sub, 0, 0)
    expect(wood.nitrogen).toBeLessThan(0.05)

    const c = sub.cfg.carcasses[0]
    const carcassSpot = resourceAt(sub, c.x, c.z)
    expect(carcassSpot.nitrogen).toBeGreaterThan(wood.nitrogen * 5)
  })

  it('consumir agota: dos consumos seguidos en el mismo punto rinden cada vez menos', () => {
    const sub = createSubstrate(CFG, seeded(6))
    const first = consume(sub, 0, 0, 0.5)
    const second = consume(sub, 0, 0, 0.5)
    expect(first.carbon).toBeGreaterThan(0)
    expect(second.carbon).toBeGreaterThan(0)
    expect(second.carbon).toBeLessThan(first.carbon)
  })

  it('consume nunca devuelve más de lo que queda, ni valores negativos', () => {
    const sub = createSubstrate(CFG, seeded(7))
    for (let i = 0; i < 50; i++) {
      const got = consume(sub, 0, 0, 10) // pide muchísimo cada vez
      expect(got.carbon).toBeGreaterThanOrEqual(0)
      expect(got.nitrogen).toBeGreaterThanOrEqual(0)
    }
    const after = resourceAt(sub, 0, 0)
    expect(after.carbon).toBeGreaterThanOrEqual(0)
    expect(after.carbon).toBeLessThan(0.01) // prácticamente agotado
  })

  it('decayClass arranca en 1 y sube hacia 5 al consumir, sin pasarse nunca de 5', () => {
    const sub = createSubstrate(CFG, seeded(8))
    expect(decayClass(sub)).toBe(1)

    const rand = seeded(9)
    for (let i = 0; i < 4000; i++) {
      const x = rand() * 2 - 1, z = rand() * 2 - 1
      const cls = decayClass(sub)
      expect(cls).toBeGreaterThanOrEqual(1)
      expect(cls).toBeLessThanOrEqual(5)
      consume(sub, x, z, 5)
    }
    const finalCls = decayClass(sub)
    expect(finalCls).toBeGreaterThan(1)
    expect(finalCls).toBeLessThanOrEqual(5)
  })

  it('la clase de descomposición NO avanza sola con el tiempo: es por consumo, no por reloj', () => {
    const sub = createSubstrate(CFG, seeded(10))
    expect(decayClass(sub)).toBe(1)
    for (let i = 0; i < 6000; i++) updateDecay(sub, CFG, 1 / 60)
    expect(decayClass(sub)).toBe(1)
  })

  it('sin NaN en ningún resultado', () => {
    const sub = createSubstrate(CFG, seeded(11))
    const r = resourceAt(sub, 0.9, -0.4)
    expect(Number.isNaN(r.carbon)).toBe(false)
    expect(Number.isNaN(r.nitrogen)).toBe(false)
    expect(Number.isNaN(r.hardness)).toBe(false)

    const c = consume(sub, 0.9, -0.4, 1)
    expect(Number.isNaN(c.carbon)).toBe(false)
    expect(Number.isNaN(c.nitrogen)).toBe(false)

    expect(Number.isNaN(decayClass(sub))).toBe(false)
  })
})
