import { describe, it, expect } from 'vitest'
import {
  createEcosystem, TIME_PHASES, WEATHERS,
  TIDEPOOL_PROFILE, TIDEPOOL_PHASES, TIDEPOOL_SWELL,
} from '../src/sim/ecosystem.js'
import { tideLevel } from '../src/sim/tide.js'

const CFG = { dayLengthSec: 120, weatherMinSec: 10, weatherMaxSec: 20, startPhase: 0 }

describe('TIDEPOOL_PROFILE', () => {
  it('tiene 12 fases de marea, distintas de las del bosque', () => {
    expect(TIDEPOOL_PHASES).toHaveLength(12) // clockLabel() en main.js divide por 12
    expect(TIDEPOOL_PROFILE.phaseData).toHaveLength(12)
    for (const p of TIDEPOOL_PHASES) expect(TIME_PHASES).not.toContain(p)
  })

  it('tiene 5 estados de oleaje, distintos de los climas del bosque', () => {
    expect(TIDEPOOL_SWELL).toHaveLength(5)
    for (const w of TIDEPOOL_SWELL) {
      expect(WEATHERS).not.toContain(w)
      expect(TIDEPOOL_PROFILE.weatherData[w]).toBeDefined()
    }
  })

  it('el charco aislado del mediodía es el momento más cálido y quieto', () => {
    const i = TIDEPOOL_PHASES.indexOf('poza al mediodía')
    expect(i).toBeGreaterThanOrEqual(0)
    const temps = TIDEPOOL_PROFILE.phaseData.map((p) => p.temp)
    expect(temps[i]).toBe(Math.max(...temps))
    // …y coincide con una bajamar (la poza se aísla justo ahí).
    expect(tideLevel(i)).toBeLessThan(0.15)
  })

  it('los dos pleamares son los picos de actividad', () => {
    const acts = TIDEPOOL_PROFILE.phaseData.map((p) => p.act)
    const peak = Math.max(...acts)
    const peakIdx = acts.map((a, i) => [a, i]).filter(([a]) => a === peak).map(([, i]) => i)
    for (const i of peakIdx) expect(tideLevel(i)).toBeGreaterThan(0.85)
  })

  it('la base térmica es de agua fría de Humboldt, no de aire', () => {
    expect(TIDEPOOL_PROFILE.seasonTemp).toBeDefined()
    const { mid, amp } = TIDEPOOL_PROFILE.seasonTemp
    expect(mid).toBeGreaterThanOrEqual(11)
    expect(mid).toBeLessThanOrEqual(16)
    expect(amp).toBeLessThanOrEqual(4) // el mar oscila mucho menos que el aire
  })

  it('el ecosistema recorre las 12 fases de marea con este perfil', () => {
    const eco = createEcosystem(CFG, () => 0.5)
    eco.setProfile(TIDEPOOL_PROFILE)
    const seen = new Set()
    for (let i = 0; i < CFG.dayLengthSec; i++) seen.add(eco.update(1).phase)
    expect(seen.size).toBe(12)
    for (const p of seen) expect(TIDEPOOL_PHASES).toContain(p)
  })

  it('el clima que entrega es siempre un estado de oleaje válido', () => {
    const eco = createEcosystem(CFG, Math.random)
    eco.setProfile(TIDEPOOL_PROFILE)
    for (let i = 0; i < 400; i++) {
      const s = eco.update(0.5)
      expect(TIDEPOOL_SWELL).toContain(s.weather)
    }
  })
})
