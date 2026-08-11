import { describe, it, expect } from 'vitest'
import {
  createEcosystem, TIME_PHASES, WEATHERS, CELL_PROFILE, FOREST_PROFILE,
} from '../src/sim/ecosystem.js'

// Este archivo prueba `setProfile`/`CELL_PROFILE` — el perfil de ecosistema
// por mundo. NO prueba el ciclo celular real (eso es test/cellCycle.test.js,
// sobre sim/cellCycle.js). Antes vivían juntos en el mismo archivo bajo un
// nombre engañoso; se separaron al pasar el "día" de la célula del ciclo
// celular al ritmo funcional del macrófago (spec
// docs/superpowers/specs/2026-08-11-ciclo-y-division-celula.md §3).

const CFG = { dayLengthSec: 120, weatherMinSec: 10, weatherMaxSec: 20, startPhase: 0 }

describe('perfil de ecosistema por mundo', () => {
  it('la hora del día pasa a ser el ritmo funcional de la célula', () => {
    const eco = createEcosystem(CFG, () => 0.5)
    eco.setProfile(CELL_PROFILE)
    const seen = new Set()
    for (let i = 0; i < CFG.dayLengthSec; i++) seen.add(eco.update(1).phase)
    expect(seen.size).toBe(CELL_PROFILE.phases.length)
    expect(CELL_PROFILE.phases.length).toBe(12) // clockLabel() en main.js divide por 12
    for (const p of seen) expect(TIME_PHASES).not.toContain(p)
    expect(CELL_PROFILE.phases).toContain('hunting')
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

  it('hunting es el pico de actividad; resting, el mínimo', () => {
    // El macrófago ya no tiene un clímax mitótico en su ritmo diario (la
    // mitosis pasó a ser un acontecimiento ocasional aparte, gateado por
    // señal — ver sim/cellCycle.js). El pico funcional es la caza.
    const act = (name) => CELL_PROFILE.phaseData[CELL_PROFILE.phases.indexOf(name)].act
    const acts = CELL_PROFILE.phaseData.map((p) => p.act)
    expect(act('hunting')).toBe(Math.max(...acts))
    expect(act('resting')).toBe(Math.min(...acts))
  })

  it('la tensión es máxima en resting, el mínimo de actividad', () => {
    const eco = createEcosystem(CFG, () => 0.5)
    eco.setProfile(CELL_PROFILE)
    let maxTension = 0, phaseAtMax = null
    for (let i = 0; i < CFG.dayLengthSec * 2; i++) {
      const s = eco.update(0.5)
      if (s.tension > maxTension) { maxTension = s.tension; phaseAtMax = s.phase }
    }
    expect(phaseAtMax).toBe('resting')
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
