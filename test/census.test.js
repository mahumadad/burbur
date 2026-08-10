import { describe, it, expect } from 'vitest'
import { CITY_CENSUS, createCensus } from '../src/sim/agents.js'

describe('CITY_CENSUS', () => {
  it('tiene solo tipos válidos y algún nocturno', () => {
    const types = new Set(['flying_animal', 'walking_animal', 'static_object', 'human'])
    expect(CITY_CENSUS.length).toBeGreaterThan(8)
    for (const a of CITY_CENSUS) expect(types.has(a.type)).toBe(true)
    expect(CITY_CENSUS.some((a) => a.night)).toBe(true)
  })
  it('createCensus asigna identidades urbanas a los visibles', () => {
    const { visible } = createCensus(CITY_CENSUS, 18)
    expect(visible).toHaveLength(18)
    const names = new Set(CITY_CENSUS.filter((a) => a.type !== 'static_object').map((a) => a.name))
    for (const v of visible) expect(names.has(v.name)).toBe(true)
  })
})
