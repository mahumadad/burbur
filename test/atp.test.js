import { describe, it, expect } from 'vitest'
import { createAtpPool, spawnQuantum, updateAtp } from '../src/sim/atp.js'

const CFG = {
  capacity: 8,
  speed: 0.5,          // recorrido en coords normalizadas/seg
  arrive: 0.02,        // distancia a la que se considera entregado
  gainPerQuantum: 0.1, // cuánto repone una entrega
  drain: 0.4,          // consumo por unidad de demanda y segundo
}

/** Corre `secs` a 60 fps y acumula las entregas. */
function run(pool, secs, demand = 0) {
  const dt = 1 / 60
  const delivered = []
  for (let i = 0; i < secs * 60; i++) delivered.push(...updateAtp(pool, CFG, dt, demand))
  return delivered
}

describe('ATP', () => {
  it('nace vacío, con el presupuesto a medias', () => {
    const pool = createAtpPool(CFG)
    expect(pool.quanta).toHaveLength(CFG.capacity)
    expect(pool.quanta.every((q) => !q.alive)).toBe(true)
    expect(pool.budget).toBeGreaterThan(0)
    expect(pool.budget).toBeLessThanOrEqual(1)
  })

  it('un cuanto nace en la mitocondria y viaja hacia su consumidor', () => {
    const pool = createAtpPool(CFG)
    expect(spawnQuantum(pool, 0, 0, 0.5, 0)).toBe(true)
    const q = pool.quanta.find((x) => x.alive)
    expect(q.x).toBe(0)
    run(pool, 0.2)
    expect(q.x).toBeGreaterThan(0)
    expect(q.x).toBeLessThan(0.5)
  })

  it('al llegar al consumidor se entrega y libera el slot', () => {
    const pool = createAtpPool(CFG)
    spawnQuantum(pool, 0, 0, 0.2, 0)
    const delivered = run(pool, 2)
    expect(delivered).toHaveLength(1)
    expect(delivered[0].x).toBeCloseTo(0.2, 1)
    expect(pool.quanta.every((q) => !q.alive)).toBe(true)
  })

  it('la capacidad es fija: llena, rechaza en vez de crecer', () => {
    const pool = createAtpPool(CFG)
    for (let i = 0; i < CFG.capacity; i++) {
      expect(spawnQuantum(pool, 0, 0, 1, 0)).toBe(true)
    }
    expect(spawnQuantum(pool, 0, 0, 1, 0)).toBe(false)
    expect(pool.quanta).toHaveLength(CFG.capacity)
  })

  it('lo que alimenta es la ENTREGA, no el nacimiento', () => {
    const pool = createAtpPool(CFG)
    const before = pool.budget
    spawnQuantum(pool, 0, 0, 0.4, 0)
    run(pool, 0.1) // en vuelo, todavía sin llegar
    expect(pool.budget).toBe(before)
    run(pool, 2)   // ya entregado
    expect(pool.budget).toBeGreaterThan(before)
  })

  it('sin producción y con demanda, el presupuesto se agota', () => {
    const pool = createAtpPool(CFG)
    run(pool, 20, 1)
    expect(pool.budget).toBe(0)
  })

  it('con producción sostenida el presupuesto se recupera', () => {
    const pool = createAtpPool(CFG)
    run(pool, 20, 1)
    expect(pool.budget).toBe(0)
    const dt = 1 / 60
    for (let i = 0; i < 60 * 20; i++) {
      if (i % 12 === 0) spawnQuantum(pool, 0, 0, 0.05, 0)
      updateAtp(pool, CFG, dt, 0.1)
    }
    expect(pool.budget).toBeGreaterThan(0.3)
  })

  it('el presupuesto nunca se sale de [0, 1]', () => {
    const pool = createAtpPool(CFG)
    const dt = 1 / 60
    let min = Infinity, max = -Infinity
    for (let i = 0; i < 60 * 30; i++) {
      if (i % 3 === 0) spawnQuantum(pool, 0, 0, 0.02, 0)
      updateAtp(pool, CFG, dt, i % 900 < 450 ? 1 : 0)
      if (pool.budget < min) min = pool.budget
      if (pool.budget > max) max = pool.budget
    }
    expect(min).toBeGreaterThanOrEqual(0)
    expect(max).toBeLessThanOrEqual(1)
  })

  it('más demanda agota más rápido', () => {
    const light = createAtpPool(CFG)
    const heavy = createAtpPool(CFG)
    run(light, 1, 0.2)
    run(heavy, 1, 1)
    expect(heavy.budget).toBeLessThan(light.budget)
  })
})
