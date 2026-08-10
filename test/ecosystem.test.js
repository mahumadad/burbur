import { describe, it, expect } from 'vitest'
import { createEcosystem, TIME_PHASES, WEATHERS } from '../src/sim/ecosystem.js'

// startPhase fijo en 0 para que las aserciones sobre el ciclo sean deterministas
// (la app arranca en 'dawn chorus', pero eso es una preferencia de presentación).
const CFG = { dayLengthSec: 120, weatherMinSec: 10, weatherMaxSec: 20, startPhase: 0 }

describe('ecosystem', () => {
  it('recorre las 12 fases horarias y vuelve al inicio', () => {
    const eco = createEcosystem(CFG, () => 0.5)
    const seen = new Set()
    // Un día completo en pasos de 1s.
    for (let i = 0; i < CFG.dayLengthSec; i++) seen.add(eco.update(1).phase)
    expect(seen.size).toBe(TIME_PHASES.length)
    // Tras un día completo vuelve a la primera fase.
    const s = eco.update(1)
    expect(s.phase).toBe(TIME_PHASES[0])
  })

  it('mantiene actividad y tensión dentro de [0,1] y el clima en la lista', () => {
    const eco = createEcosystem(CFG, Math.random)
    for (let i = 0; i < 600; i++) {
      const s = eco.update(0.5)
      expect(s.activity).toBeGreaterThanOrEqual(0)
      expect(s.activity).toBeLessThanOrEqual(1)
      expect(s.tension).toBeGreaterThanOrEqual(0)
      expect(s.tension).toBeLessThanOrEqual(1)
      expect(WEATHERS).toContain(s.weather)
    }
  })

  it('señala el cambio de fase exactamente una vez por transición', () => {
    const eco = createEcosystem(CFG, () => 0.5)
    let changes = 0
    // Nos quedamos dentro del primer día: al completarlo, el ciclo vuelve a la fase 0
    // y esa vuelta cuenta como una transición más.
    for (let i = 0; i < CFG.dayLengthSec - 1; i++) if (eco.update(1).changedTime) changes++
    // 12 fases → 11 transiciones dentro del primer día (la fase 0 es el estado inicial).
    expect(changes).toBe(TIME_PHASES.length - 1)
  })

  it('la noche es más oscura que el mediodía', () => {
    const eco = createEcosystem(CFG, () => 0.5)
    const night = eco.update(0.001).gain
    let midday = 0
    for (let i = 0; i < CFG.dayLengthSec; i++) {
      const s = eco.update(1)
      if (s.phase === 'midday') midday = s.gain
    }
    expect(midday).toBeGreaterThan(night)
  })
})
