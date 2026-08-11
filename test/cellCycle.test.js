import { describe, it, expect } from 'vitest'
import {
  createEcosystem, TIME_PHASES, WEATHERS, CELL_PROFILE, FOREST_PROFILE, MITOTIC_PHASES,
} from '../src/sim/ecosystem.js'

const CFG = { dayLengthSec: 120, weatherMinSec: 10, weatherMaxSec: 20, startPhase: 0 }

describe('perfil de ecosistema por mundo', () => {
  it('la hora del día pasa a ser el ciclo celular', () => {
    const eco = createEcosystem(CFG, () => 0.5)
    eco.setProfile(CELL_PROFILE)
    const seen = new Set()
    for (let i = 0; i < CFG.dayLengthSec; i++) seen.add(eco.update(1).phase)
    expect(seen.size).toBe(CELL_PROFILE.phases.length)
    for (const p of seen) expect(TIME_PHASES).not.toContain(p)
    expect(CELL_PROFILE.phases).toContain('metaphase')
  })

  it('el clima pasa a ser el medio', () => {
    const eco = createEcosystem(CFG, Math.random)
    eco.setProfile(CELL_PROFILE)
    for (let i = 0; i < 400; i++) {
      const s = eco.update(0.5)
      expect(CELL_PROFILE.weathers).toContain(s.weather)
      expect(WEATHERS).not.toContain(s.weather)
    }
  })

  it('cambiar de perfil NO reinicia el reloj del mundo', () => {
    const eco = createEcosystem(CFG, () => 0.5)
    for (let i = 0; i < 50; i++) eco.update(1)
    const before = eco.state.phaseIndex
    eco.setProfile(CELL_PROFILE)
    const after = eco.update(0.001).phaseIndex
    expect(after).toBe(before)
  })

  it('un clima del perfil viejo no sobrevive al cambio', () => {
    // Sin esto, el estado quedaría con un clima inexistente en la tabla nueva
    // y todos los valores derivados saldrían NaN.
    const eco = createEcosystem(CFG, Math.random)
    for (let i = 0; i < 30; i++) eco.update(1)
    eco.setProfile(CELL_PROFILE)
    const s = eco.update(0.001)
    expect(CELL_PROFILE.weathers).toContain(s.weather)
    expect(Number.isFinite(s.activity)).toBe(true)
    expect(Number.isFinite(s.temperature)).toBe(true)
  })

  it('se puede volver al perfil del bosque', () => {
    const eco = createEcosystem(CFG, Math.random)
    eco.setProfile(CELL_PROFILE)
    eco.update(1)
    eco.setProfile(FOREST_PROFILE)
    const s = eco.update(1)
    expect(TIME_PHASES).toContain(s.phase)
    expect(WEATHERS).toContain(s.weather)
  })

  it('la mitosis es el clímax: metafase se frena, anafase es el pico', () => {
    // Se afirma sobre la TABLA, no sobre el valor interpolado en vivo: el
    // ecosistema mezcla cada fase con la siguiente, así que al final de
    // metafase la actividad ya viene subiendo hacia anafase.
    const act = (name) => CELL_PROFILE.phaseData[CELL_PROFILE.phases.indexOf(name)].act
    expect(act('metaphase')).toBeLessThan(act('G1'))
    const peak = Math.max(...CELL_PROFILE.phaseData.map((p) => p.act))
    expect(act('anaphase')).toBe(peak)
  })

  it('la tensión sube al frenarse la célula, y la mitosis la frena', () => {
    const eco = createEcosystem(CFG, () => 0.5)
    eco.setProfile(CELL_PROFILE)
    let maxTension = 0, phaseAtMax = null
    for (let i = 0; i < CFG.dayLengthSec * 2; i++) {
      const s = eco.update(0.5)
      if (s.tension > maxTension) { maxTension = s.tension; phaseAtMax = s.phase }
    }
    expect(MITOTIC_PHASES.has(phaseAtMax)).toBe(true)
  })

  it('la hipoxia deja menos energía que un medio rico', () => {
    const rich = CELL_PROFILE.weatherData['nutrient rich']
    const hypo = CELL_PROFILE.weatherData['hypoxic']
    expect(hypo.act).toBeLessThan(rich.act)
    expect(hypo.tension).toBeGreaterThan(rich.tension)
  })

  it('sin setProfile el bosque sigue igual', () => {
    const eco = createEcosystem(CFG, Math.random)
    for (let i = 0; i < 200; i++) {
      const s = eco.update(0.5)
      expect(TIME_PHASES).toContain(s.phase)
      expect(WEATHERS).toContain(s.weather)
    }
  })
})
