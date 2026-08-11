import { describe, it, expect } from 'vitest'
import {
  createMembrane, updateMembrane, radiusAt, containsPoint,
} from '../src/sim/membrane.js'

const CFG = {
  verts: 96, baseR: 1, harmonics: 3, harmAmp: 0.05, harmSpeed: 0.12,
  protrusionAmp: 0.30, protrusionWidth: 0.85, tailPinch: 0.18,
  filoRate: 1.2, filoAmp: 0.16, filoWidth: 0.10, filoTtl: 2.2,
  blebRate: 2.5, blebAmp: 0.22, blebWidth: 0.30, blebRise: 0.12, blebFall: 0.9,
  relax: 0.14,
}

/** LCG determinista: los tests estocásticos no deben depender de la suerte. */
function seeded(seed = 1) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

/** Corre `secs` segundos de simulación a 60 fps. */
function run(mem, secs, input, rand = seeded(7)) {
  const dt = 1 / 60
  for (let i = 0; i < secs * 60; i++) updateMembrane(mem, CFG, dt, rand, i * dt, input)
  return mem
}

const REST = { frontAngle: 0, protrusion: 0, blebbing: 0, rounding: 0 }

describe('membrana', () => {
  it('nace como un contorno cerrado de radios positivos', () => {
    const mem = createMembrane(CFG, seeded(1))
    expect(mem.r).toHaveLength(CFG.verts)
    for (const r of mem.r) expect(r).toBeGreaterThan(0)
  })

  it('nunca colapsa ni explota, por mucho que se la deforme', () => {
    const mem = createMembrane(CFG, seeded(2))
    run(mem, 40, { frontAngle: 1.1, protrusion: 1, blebbing: 1, rounding: 0 })
    for (const r of mem.r) {
      expect(r).toBeGreaterThan(0.3)
      expect(r).toBeLessThan(2)
    }
  })

  it('en reposo el contorno es casi simétrico entre frente y cola', () => {
    const mem = createMembrane(CFG, seeded(3))
    run(mem, 10, REST)
    const front = radiusAt(mem, 0)
    const tail = radiusAt(mem, Math.PI)
    expect(Math.abs(front - tail)).toBeLessThan(0.2)
  })

  it('al protruir, el frente se adelanta y la cola se estrecha', () => {
    const mem = createMembrane(CFG, seeded(3))
    const front = 0.7
    run(mem, 10, { frontAngle: front, protrusion: 1, blebbing: 0, rounding: 0 })
    expect(radiusAt(mem, front)).toBeGreaterThan(radiusAt(mem, front + Math.PI) + 0.25)
  })

  it('el lamelipodio es ancho: la protrusión abarca un sector, no un pico', () => {
    const mem = createMembrane(CFG, seeded(4))
    run(mem, 10, { frontAngle: 0, protrusion: 1, blebbing: 0, rounding: 0 })
    // A media anchura del lóbulo el radio sigue claramente por encima del reposo.
    expect(radiusAt(mem, CFG.protrusionWidth * 0.5)).toBeGreaterThan(CFG.baseR + 0.08)
  })

  it('sin blebbing no aparecen ampollas; con blebbing sí', () => {
    const calm = createMembrane(CFG, seeded(5))
    run(calm, 12, REST, seeded(11))
    expect(calm.blebs).toHaveLength(0)

    const blebbing = createMembrane(CFG, seeded(5))
    run(blebbing, 12, { ...REST, blebbing: 1 }, seeded(11))
    expect(blebbing.blebs.length).toBeGreaterThan(0)
  })

  it('las ampollas se reabsorben: al cortar el blebbing el contorno se calma', () => {
    const mem = createMembrane(CFG, seeded(6))
    run(mem, 12, { ...REST, blebbing: 1 }, seeded(13))
    run(mem, 12, REST, seeded(13))
    expect(mem.blebs).toHaveLength(0)
  })

  it('los filopodios aparecen y se reabsorben solos', () => {
    const mem = createMembrane(CFG, seeded(7))
    run(mem, 6, { ...REST, protrusion: 1 })
    expect(mem.filo.length).toBeGreaterThan(0)
    // Cada uno vive lo suyo (no todos duran igual), pero ninguno pasa su ttl.
    for (const f of mem.filo) {
      expect(f.age).toBeLessThan(f.ttl)
      expect(f.ttl).toBeLessThanOrEqual(CFG.filoTtl * 1.4)
    }
  })

  it('el redondeo mitótico convierte el contorno en un círculo', () => {
    const mem = createMembrane(CFG, seeded(8))
    run(mem, 8, { frontAngle: 0, protrusion: 1, blebbing: 0, rounding: 0 })
    const spread = (m) => Math.max(...m.r) - Math.min(...m.r)
    const deformed = spread(mem)
    run(mem, 12, { frontAngle: 0, protrusion: 1, blebbing: 0, rounding: 1 })
    expect(spread(mem)).toBeLessThan(deformed * 0.35)
  })

  it('radiusAt es periódico y continuo entre vértices', () => {
    const mem = createMembrane(CFG, seeded(9))
    run(mem, 5, { frontAngle: 2.0, protrusion: 1, blebbing: 0, rounding: 0 })
    for (const a of [0, 0.37, 2.4, -1.1]) {
      expect(radiusAt(mem, a)).toBeCloseTo(radiusAt(mem, a + Math.PI * 2), 6)
    }
    // Entre dos vértices vecinos no hay saltos.
    const step = (Math.PI * 2) / CFG.verts
    for (let i = 0; i < CFG.verts; i++) {
      const d = Math.abs(radiusAt(mem, i * step) - radiusAt(mem, (i + 0.5) * step))
      expect(d).toBeLessThan(0.15)
    }
  })

  it('containsPoint distingue el interior del exterior de la forma deformada', () => {
    const mem = createMembrane(CFG, seeded(10))
    const front = 0
    run(mem, 10, { frontAngle: front, protrusion: 1, blebbing: 0, rounding: 0 })
    expect(containsPoint(mem, 0, 0)).toBe(true)
    // Un punto adelantado cae DENTRO por el lamelipodio, y su simétrico en la
    // cola cae FUERA: es exactamente la asimetría que produce la polarización.
    const rf = radiusAt(mem, front)
    const rt = radiusAt(mem, front + Math.PI)
    const probe = (rt + rf) / 2
    expect(containsPoint(mem, probe, 0)).toBe(true)
    expect(containsPoint(mem, -probe, 0)).toBe(false)
  })

  it('el margen de containsPoint mantiene a los organelos despegados del borde', () => {
    const mem = createMembrane(CFG, seeded(10))
    run(mem, 6, REST)
    const r = radiusAt(mem, 0)
    const justInside = r - 0.02
    expect(containsPoint(mem, justInside, 0)).toBe(true)
    expect(containsPoint(mem, justInside, 0, 0.1)).toBe(false)
  })
})
