import { describe, it, expect } from 'vitest'
import { STAGE_DEFAULTS, resolveStageOptions, breatheTargetY } from '../src/render/stageOptions.js'

describe('STAGE_DEFAULTS', () => {
  // Estos son los valores HARDCODEADOS que tenía stage.js antes de parametrizarlo.
  // Si alguno cambia, los 6 mundos existentes cambian de encuadre: es una regresión.
  it('conserva exactamente el encuadre aéreo 3/4 histórico', () => {
    expect(STAGE_DEFAULTS.camera.orbR).toBe(118)
    expect(STAGE_DEFAULTS.camera.theta).toBeCloseTo(0.62, 9)
    expect(STAGE_DEFAULTS.camera.phi).toBeCloseTo(0.92, 9)
    expect(STAGE_DEFAULTS.camera.target).toEqual([0, 0, 0])
  })

  it('conserva los límites de órbita históricos', () => {
    expect(STAGE_DEFAULTS.orbit.minDist).toBe(40)
    expect(STAGE_DEFAULTS.orbit.maxDist).toBe(260)
    expect(STAGE_DEFAULTS.orbit.minPolar).toBe(0)
    expect(STAGE_DEFAULTS.orbit.maxPolar).toBeCloseTo(Math.PI * 0.49, 9)
  })

  it('conserva la respiración, la niebla y el fondo históricos', () => {
    expect(STAGE_DEFAULTS.breathe.baseY).toBe(0)
    expect(STAGE_DEFAULTS.breathe.ampY).toBeCloseTo(1.7, 9)
    expect(STAGE_DEFAULTS.fog.color).toBe(0x000000)
    expect(STAGE_DEFAULTS.fog.density).toBeCloseTo(0.004, 9)
    expect(STAGE_DEFAULTS.background).toBe(0x000000)
  })
})

describe('resolveStageOptions', () => {
  it('sin opciones devuelve los defaults', () => {
    expect(resolveStageOptions()).toEqual(STAGE_DEFAULTS)
    expect(resolveStageOptions({})).toEqual(STAGE_DEFAULTS)
  })

  it('un override parcial no pisa las demás secciones', () => {
    const o = resolveStageOptions({ fog: { color: 0x0a2a33 } })
    expect(o.fog.color).toBe(0x0a2a33)
    expect(o.fog.density).toBe(STAGE_DEFAULTS.fog.density)
    expect(o.camera).toEqual(STAGE_DEFAULTS.camera)
    expect(o.orbit).toEqual(STAGE_DEFAULTS.orbit)
  })

  it('no muta STAGE_DEFAULTS al resolver', () => {
    resolveStageOptions({ breathe: { baseY: 99 } })
    expect(STAGE_DEFAULTS.breathe.baseY).toBe(0)
  })
})

describe('breatheTargetY', () => {
  it('con los defaults reproduce la fórmula histórica sin(clock*0.13)*1.7', () => {
    for (const clock of [0, 1.5, 7.25, 40]) {
      expect(breatheTargetY(clock, STAGE_DEFAULTS.breathe))
        .toBeCloseTo(Math.sin(clock * 0.13) * 1.7, 9)
    }
  })

  it('oscila alrededor de baseY cuando el mundo lo eleva', () => {
    const breathe = { baseY: 12, ampY: 0.5 }
    for (const clock of [0, 3, 11]) {
      const y = breatheTargetY(clock, breathe)
      expect(y).toBeGreaterThanOrEqual(11.5 - 1e-9)
      expect(y).toBeLessThanOrEqual(12.5 + 1e-9)
    }
  })
})
