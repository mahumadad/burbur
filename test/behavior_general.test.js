import { describe, it, expect } from 'vitest'
import { timeWeight, FOREST_CENSUS, POND_CENSUS } from '../src/sim/agents.js'

const find = (census, name) => census.find((a) => a.name === name)

describe('comportamiento general (timeWeight)', () => {
  const chincol = find(FOREST_CENSUS, 'chincol')       // ave chica, no grande
  const jote = find(FOREST_CENSUS, 'jote')             // ave grande (LARGE_FLIERS)
  const zorzal = find(FOREST_CENSUS, 'zorzal')         // cantor (dawn)
  const degu = find(FOREST_CENSUS, 'degú')             // crepuscular
  const arriero = find(FOREST_CENSUS, 'arriero')       // persona
  const lechuza = find(FOREST_CENSUS, 'lechuza')       // nocturna + grande
  const garza = find(POND_CENSUS, 'garza grande')      // ave de agua grande

  it('las aves chicas casi no vuelan con lluvia', () => {
    expect(timeWeight(chincol, 'midday', 'heavy rain'))
      .toBeLessThan(timeWeight(chincol, 'midday', 'dry still'))
  })

  it('las aves grandes / de agua vuelan igual con lluvia', () => {
    expect(timeWeight(jote, 'midday', 'heavy rain')).toBe(timeWeight(jote, 'midday', 'dry still'))
    expect(timeWeight(garza, 'midday', 'heavy rain')).toBe(timeWeight(garza, 'midday', 'dry still'))
  })

  it('los cantores repuntan al alba Y al atardecer', () => {
    const mid = timeWeight(zorzal, 'midday', 'dry still')
    expect(timeWeight(zorzal, 'dawn chorus', 'dry still')).toBeGreaterThan(mid)
    expect(timeWeight(zorzal, 'golden hour', 'dry still')).toBeGreaterThan(mid)
  })

  it('los crepusculares repuntan en amanecer y atardecer', () => {
    const mid = timeWeight(degu, 'midday', 'dry still')
    expect(timeWeight(degu, 'first light', 'dry still')).toBeGreaterThan(mid)
    expect(timeWeight(degu, 'dusk', 'dry still')).toBeGreaterThan(mid)
  })

  it('hay pocos transeúntes (las personas pesan menos que la base)', () => {
    expect(timeWeight(arriero, 'midday', 'dry still')).toBeLessThan(1)
  })

  it('los nocturnos son de noche', () => {
    expect(timeWeight(lechuza, 'night', 'dry still'))
      .toBeGreaterThan(timeWeight(lechuza, 'midday', 'dry still'))
  })
})
