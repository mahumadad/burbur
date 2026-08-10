import { describe, it, expect } from 'vitest'
import { createCensus, FOREST_CENSUS } from '../src/sim/agents.js'
import { createEventEngine } from '../src/sim/events.js'
import { narrate } from '../src/sim/narrator.js'

// PRNG determinista para los tests.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CFG = { baseRate: 0.62, ambientProb: 0.35 }
const world = (over = {}) => ({
  time: 0, phase: 'mid-morning', weather: 'after rain',
  activity: 0.7, changedTime: false, changedWeather: false, ...over,
})

describe('narrator', () => {
  it('produce log y short no vacíos para cada tipo', () => {
    const types = ['sound', 'interaction', 'overview', 'residue', 'moment', 'conflict', 'shift']
    for (const type of types) {
      const r = narrate({ type, agent: 'fox', agentType: 'walking_animal', dir: 'left' },
        { phase: 'dusk', weather: 'light rain' }, mulberry32(1))
      expect(r.log.length).toBeGreaterThan(0)
      expect(r.short.length).toBeGreaterThan(0)
    }
  })

  it('el sonido de ambiente (sin agente) no nombra un agente inexistente', () => {
    const r = narrate({ type: 'sound', agent: null, agentType: null, dir: null },
      { phase: 'night', weather: 'frost' }, mulberry32(3))
    expect(r.log).not.toContain('null')
    expect(r.log).not.toContain('undefined')
  })
})

describe('event engine', () => {
  it('es determinista con la misma semilla', () => {
    const pop = createCensus(FOREST_CENSUS, 18, mulberry32(7))
    const a = createEventEngine(pop, CFG, mulberry32(7))
    const b = createEventEngine(pop, CFG, mulberry32(7))
    const ea = [], eb = []
    for (let i = 0; i < 200; i++) { ea.push(...a.update(0.1, world())); eb.push(...b.update(0.1, world())) }
    expect(ea.map((e) => e.short)).toEqual(eb.map((e) => e.short))
    expect(ea.length).toBeGreaterThan(10)
  })

  it('más actividad → más eventos', () => {
    const pop = createCensus(FOREST_CENSUS, 18, mulberry32(2))
    const low = createEventEngine(pop, CFG, mulberry32(2))
    const high = createEventEngine(pop, CFG, mulberry32(2))
    let nLow = 0, nHigh = 0
    for (let i = 0; i < 300; i++) {
      nLow += low.update(0.1, world({ activity: 0.1 })).length
      nHigh += high.update(0.1, world({ activity: 1.0 })).length
    }
    expect(nHigh).toBeGreaterThan(nLow)
  })

  it('un cambio de hora dispara un evento shift', () => {
    const pop = createCensus(FOREST_CENSUS, 18, mulberry32(5))
    const eng = createEventEngine(pop, CFG, mulberry32(5))
    const evs = eng.update(0.1, world({ changedTime: true }))
    expect(evs.some((e) => e.type === 'shift')).toBe(true)
  })

  it('los eventos traen el esquema completo', () => {
    const pop = createCensus(FOREST_CENSUS, 18, mulberry32(9))
    const eng = createEventEngine(pop, CFG, mulberry32(9))
    let checked = 0
    for (let i = 0; i < 100; i++) {
      for (const e of eng.update(0.1, world())) {
        expect(e).toHaveProperty('t')
        expect(e).toHaveProperty('type')
        expect(e).toHaveProperty('log')
        expect(e).toHaveProperty('short')
        expect(DIRS_OR_NULL).toContain(e.dir)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

const DIRS_OR_NULL = ['left', 'right', 'ahead', 'behind', 'above', 'below', 'all around', null]
