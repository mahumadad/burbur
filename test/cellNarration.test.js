import { describe, it, expect } from 'vitest'
import { createCensus, CELL_CENSUS, FOREST_CENSUS } from '../src/sim/agents.js'
import { narrate, CELL_LEXICON } from '../src/sim/narrator.js'
import { createEventEngine } from '../src/sim/events.js'

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CFG = { baseRate: 0.62, ambientProb: 0.35 }
const cellWorld = (over = {}) => ({
  time: 0, phase: 'S phase', weather: 'hypoxic',
  activity: 0.7, changedTime: false, changedWeather: false, ...over,
})

const FOREST_WORDS = /\bclaro\b|roble|hojarasca|rama\b|follaje|helecho/i

describe('censo de la célula', () => {
  it('tiene organelos que se mueven e invasores', () => {
    const kinds = new Set(CELL_CENSUS.map((a) => a.type))
    expect(kinds.has('organelle')).toBe(true)
    expect(kinds.has('invader')).toBe(true)
    expect(kinds.has('structure')).toBe(true)
  })

  it('las estructuras están marcadas como estáticas', () => {
    const nucleus = CELL_CENSUS.find((a) => a.name === 'el núcleo')
    expect(nucleus).toBeDefined()
    expect(nucleus.static).toBe(true)
  })

  it('a escena solo salen los que se mueven: el núcleo no deambula', () => {
    const pop = createCensus(CELL_CENSUS, 18, mulberry32(1))
    expect(pop.visible).toHaveLength(18)
    for (const v of pop.visible) {
      const src = CELL_CENSUS.find((a) => a.name === v.name)
      expect(src.static).not.toBe(true)
    }
  })

  it('el bosque sigue funcionando igual', () => {
    const pop = createCensus(FOREST_CENSUS, 18, mulberry32(2))
    expect(pop.visible).toHaveLength(18)
    for (const v of pop.visible) expect(v.type).not.toBe('static_object')
  })
})

describe('léxico de la célula', () => {
  it('narra cada tipo de evento sin vocabulario de bosque', () => {
    const types = ['sound', 'interaction', 'overview', 'residue', 'moment', 'conflict', 'shift']
    for (const type of types) {
      const r = narrate(
        { type, agent: 'mitocondria', agentType: 'organelle', dir: 'left' },
        { phase: 'S phase', weather: 'hypoxic' }, mulberry32(1), CELL_LEXICON,
      )
      expect(r.log.length).toBeGreaterThan(0)
      expect(r.short.length).toBeGreaterThan(0)
      expect(r.log).not.toMatch(FOREST_WORDS)
    }
  })

  it('sin léxico sigue narrando el bosque (compatibilidad)', () => {
    const r = narrate(
      { type: 'moment', agent: 'fox', agentType: 'walking_animal', dir: 'left' },
      { phase: 'dusk', weather: 'light rain' }, mulberry32(1),
    )
    expect(r.log).toMatch(FOREST_WORDS)
  })

  it('el shift narra el ciclo celular, no la luz del día', () => {
    const r = narrate({ type: 'shift' }, { phase: 'metaphase', weather: 'inflamed' },
      mulberry32(4), CELL_LEXICON)
    expect(r.log).toContain('metafase')
    expect(r.log).not.toMatch(/luz/i)
  })

  it('el ambiente sin agente no nombra un agente inexistente', () => {
    const r = narrate({ type: 'sound', agent: null, agentType: null, dir: null },
      { phase: 'G1', weather: 'nutrient rich' }, mulberry32(3), CELL_LEXICON)
    expect(r.log).not.toContain('null')
    expect(r.log).not.toContain('undefined')
  })

  it('una estructura con vocabulario propio usa el suyo, no el del montón', () => {
    // Sin esto, el balde genérico le hace "abrirse y cerrarse" a una fibra de
    // estrés, o "avanzar en el borde" al Golgi. Cada uno hace lo suyo.
    const logs = new Set()
    for (let i = 0; i < 30; i++) {
      logs.add(narrate({ type: 'sound', agent: 'el núcleo', agentType: 'structure' },
        { phase: 'G1', weather: 'nutrient rich' }, mulberry32(i), CELL_LEXICON).log)
    }
    for (const l of logs) expect(l).toMatch(/núcleo/)
    // Ninguna acción prestada de otra estructura.
    for (const l of logs) expect(l).not.toMatch(/cisterna|trinquete|borde de avance/)
  })

  it('una estructura sin vocabulario propio cae al genérico sin romperse', () => {
    const r = narrate({ type: 'sound', agent: 'el proteasoma', agentType: 'structure' },
      { phase: 'G1', weather: 'nutrient rich' }, mulberry32(2), CELL_LEXICON)
    expect(r.log).toContain('proteasoma')
    expect(r.log).not.toContain('undefined')
  })

  it('un agente de tipo desconocido no rompe la narración', () => {
    const r = narrate({ type: 'sound', agent: 'thing', agentType: 'nonesuch', dir: null },
      { phase: 'G1', weather: 'nutrient rich' }, mulberry32(5), CELL_LEXICON)
    expect(r.log).not.toContain('undefined')
  })
})

describe('motor de eventos con el léxico de la célula', () => {
  it('produce eventos narrados en vocabulario celular', () => {
    const pop = createCensus(CELL_CENSUS, 18, mulberry32(6))
    const eng = createEventEngine(pop, { ...CFG, lexicon: CELL_LEXICON }, mulberry32(6))
    const out = []
    for (let i = 0; i < 200; i++) out.push(...eng.update(0.1, cellWorld()))
    expect(out.length).toBeGreaterThan(10)
    for (const e of out) expect(e.log).not.toMatch(FOREST_WORDS)
  })

  it('sin lexicon en la config, el bosque narra como siempre', () => {
    const pop = createCensus(FOREST_CENSUS, 18, mulberry32(7))
    const eng = createEventEngine(pop, CFG, mulberry32(7))
    const out = []
    for (let i = 0; i < 200; i++) out.push(...eng.update(0.1, cellWorld()))
    expect(out.length).toBeGreaterThan(10)
  })
})
