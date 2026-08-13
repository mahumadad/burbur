import { describe, it, expect } from 'vitest'
import { TIDEPOOL_CENSUS, createCensus } from '../src/sim/agents.js'
import { TIDEPOOL_LEXICON } from '../src/sim/narrator.js'
import { narrate } from '../src/sim/narrator.js'

const slotClass = (i) => (i < 2 ? 'predator' : i < 14 ? 'fish' : 'benthos')

describe('TIDEPOOL_CENSUS', () => {
  it('usa solo tipos válidos del mundo', () => {
    const types = new Set(['fish', 'benthos', 'predator', 'otter', 'sessile', 'alga', 'substrate', 'human'])
    for (const a of TIDEPOOL_CENSUS) expect(types.has(a.type)).toBe(true)
  })

  it('tiene móviles suficientes para cada clase de slot', () => {
    for (const want of ['predator', 'fish', 'benthos']) {
      const n = TIDEPOOL_CENSUS.filter((a) => a.type === want && !a.static).length
      expect(n).toBeGreaterThan(0)
    }
  })

  it('el paisaje está marcado static y lleva artículo', () => {
    for (const a of TIDEPOOL_CENSUS) {
      if (['sessile', 'alga', 'substrate'].includes(a.type)) {
        expect(a.static).toBe(true)
        expect(/^(el|la|los|las) /.test(a.name)).toBe(true)
      }
    }
  })

  it('no usa night/dawn: timeWeight no entiende fases en español (spec §3.3)', () => {
    for (const a of TIDEPOOL_CENSUS) {
      expect(a.night).toBeUndefined()
      expect(a.dawn).toBeUndefined()
    }
  })

  it('slotClass da nombres del nicho correcto a cada slot', () => {
    const { visible } = createCensus(TIDEPOOL_CENSUS, 18, Math.random, null, slotClass)
    expect(visible).toHaveLength(18)
    for (let i = 0; i < 18; i++) expect(visible[i].type).toBe(slotClass(i))
  })

  it('el chungungo nunca ocupa un slot, pero sigue en el censo para narrarse', () => {
    const { census, visible } = createCensus(TIDEPOOL_CENSUS, 18, Math.random, null, slotClass)
    expect(visible.some((v) => v.name === 'chungungo')).toBe(false)
    expect(census.some((a) => a.name === 'chungungo')).toBe(true)
  })
})

describe('TIDEPOOL_LEXICON', () => {
  it('tiene acciones para todos los tipos del censo', () => {
    const used = new Set(TIDEPOOL_CENSUS.map((a) => a.type))
    for (const t of used) expect(TIDEPOOL_LEXICON.actions[t]).toBeDefined()
  })

  it('narra un evento con vocabulario marino y sin romperse', () => {
    const ev = { type: 'sound', agent: 'jaiba', agentType: 'benthos', dir: 'left' }
    const out = narrate(ev, { phase: 'poza al mediodía', weather: 'marejada' }, Math.random, TIDEPOOL_LEXICON)
    expect(typeof out.log).toBe('string')
    expect(out.log.length).toBeGreaterThan(0)
    expect(typeof out.short).toBe('string')
  })

  it('el lugar es la poza', () => {
    expect(TIDEPOOL_LEXICON.place).toBe('la poza')
  })
})
