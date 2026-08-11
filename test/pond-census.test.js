import { describe, it, expect } from 'vitest'
import { POND_CENSUS, createCensus } from '../src/sim/agents.js'

describe('POND_CENSUS', () => {
  it('tiene fauna de agua y produce agentes visibles', () => {
    const types = new Set(POND_CENSUS.map((a) => a.type))
    expect(types.has('flying_animal')).toBe(true)
    expect(types.has('walking_animal')).toBe(true)
    expect(POND_CENSUS.some((a) => a.name === 'garza cuca')).toBe(true)
    const { visible } = createCensus(POND_CENSUS, 18)
    expect(visible.length).toBe(18)
    expect(visible.every((v) => v.name && v.type)).toBe(true)
  })
})
