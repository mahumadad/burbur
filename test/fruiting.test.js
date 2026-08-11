import { describe, it, expect } from 'vitest'
import { createFruiting, updateFruiting, fruitingState } from '../src/sim/fruiting.js'

// cfg de prueba: valores pequeños para que los ciclos completos sean rápidos de correr.
const CFG = {
  nitrogenThreshold: 50,
  shockDelta: 8,
  shockWindow: 3,
  moistureMin: 0.4,
  co2Max: 1000,
  lightMin: 0.2,
  nitrogenCost: 30,
  sporeRate: 100,
  deformedSporeFactor: 0.1,
  primordiaDuration: 2,
  expandingDuration: 3,
  sporulatingDuration: 4,
  senescentDuration: 2,
}

const DT = 1 / 60

/** Corre `segundos` a 60fps. `ctxFn(t)` da el ctx en el instante t (segundos transcurridos). */
function correr(fr, cfg, segundos, ctxFn) {
  const pasos = Math.round(segundos / DT)
  for (let i = 0; i < pasos; i++) {
    updateFruiting(fr, cfg, DT, ctxFn(i * DT))
  }
}

// Ctx que dispara: temperatura estable 1s (línea base para la ventana de choque),
// después CAE de golpe — nitrógeno, humedad, CO2 y luz favorables (no deforme).
const ctxDisparaNormal = (t) => ({
  nitrogen: 80,
  temperature: t < 1 ? 20 : 5,
  moisture: 0.8,
  co2: 100,
  light: 0.8,
})

// Igual, pero con CO2 alto: debería salir deforme.
const ctxDisparaDeforme = (t) => ({
  nitrogen: 80,
  temperature: t < 1 ? 20 : 5,
  moisture: 0.8,
  co2: 2000,
  light: 0.8,
})

const ETAPAS_VALIDAS = ['dormant', 'primordia', 'expanding', 'sporulating', 'senescent']

describe('createFruiting', () => {
  it('arranca en dormant con spores en 0', () => {
    const fr = createFruiting(CFG)
    expect(fruitingState(fr)).toEqual({ stage: 'dormant', progress: 0, deformed: false, spores: 0 })
  })
})

describe('disparador', () => {
  it('no fructifica sin nitrógeno, aunque haya frío y humedad', () => {
    const fr = createFruiting(CFG)
    const ctx = (t) => ({ nitrogen: 0, temperature: t < 1 ? 20 : 5, moisture: 0.8, co2: 100, light: 0.8 })
    correr(fr, CFG, 15, ctx)
    expect(fruitingState(fr).stage).toBe('dormant')
  })

  it('no fructifica sin choque térmico: frío constante no alcanza, hace falta que CAIGA', () => {
    const fr = createFruiting(CFG)
    const ctx = () => ({ nitrogen: 80, temperature: 5, moisture: 0.8, co2: 100, light: 0.8 })
    correr(fr, CFG, 15, ctx)
    expect(fruitingState(fr).stage).toBe('dormant')
  })

  it('no fructifica en seco', () => {
    const fr = createFruiting(CFG)
    const ctx = (t) => ({ nitrogen: 80, temperature: t < 1 ? 20 : 5, moisture: 0.1, co2: 100, light: 0.8 })
    correr(fr, CFG, 15, ctx)
    expect(fruitingState(fr).stage).toBe('dormant')
  })

  it('con las tres condiciones a la vez, recorre las 4 etapas EN ORDEN y vuelve a dormant', () => {
    const fr = createFruiting(CFG)
    const secuencia = []
    const pasos = Math.round(15 / DT)
    for (let i = 0; i < pasos; i++) {
      updateFruiting(fr, CFG, DT, ctxDisparaNormal(i * DT))
      const etapa = fruitingState(fr).stage
      if (secuencia[secuencia.length - 1] !== etapa) secuencia.push(etapa)
    }
    expect(secuencia).toEqual(['dormant', 'primordia', 'expanding', 'sporulating', 'senescent', 'dormant'])
  })
})

describe('deformidad', () => {
  it('con CO2 alto en el momento de los primordios, sale deformada', () => {
    const fr = createFruiting(CFG)
    // corre hasta que salga de dormant (o hasta un tope de seguridad)
    let i = 0
    while (fruitingState(fr).stage === 'dormant' && i < Math.round(20 / DT)) {
      updateFruiting(fr, CFG, DT, ctxDisparaDeforme(i * DT))
      i++
    }
    expect(fruitingState(fr).stage).not.toBe('dormant')
    expect(fruitingState(fr).deformed).toBe(true)
  })

  it('produce muchas menos esporas que una fructificación normal', () => {
    const frNormal = createFruiting(CFG)
    correr(frNormal, CFG, 15, ctxDisparaNormal)

    const frDeforme = createFruiting(CFG)
    correr(frDeforme, CFG, 15, ctxDisparaDeforme)

    const normal = fruitingState(frNormal)
    const deforme = fruitingState(frDeforme)
    expect(normal.spores).toBeGreaterThan(0)
    expect(deforme.spores).toBeGreaterThan(0)
    expect(deforme.spores).toBeLessThan(normal.spores * CFG.deformedSporeFactor * 2)
    expect(deforme.spores).toBeLessThan(normal.spores)
  })
})

describe('gasto de nitrógeno', () => {
  it('reporta cuánto nitrógeno gastó al fructificar', () => {
    const fr = createFruiting(CFG)
    expect(fr.nitrogenSpent).toBe(0)
    correr(fr, CFG, 2, ctxDisparaNormal)
    expect(fruitingState(fr).stage).not.toBe('dormant')
    expect(fr.nitrogenSpent).toBe(CFG.nitrogenCost)
  })
})

describe('robustez', () => {
  it('progress siempre en [0,1] y stage siempre válido', () => {
    const fr = createFruiting(CFG)
    const pasos = Math.round(15 / DT)
    for (let i = 0; i < pasos; i++) {
      updateFruiting(fr, CFG, DT, ctxDisparaNormal(i * DT))
      const s = fruitingState(fr)
      expect(ETAPAS_VALIDAS).toContain(s.stage)
      expect(s.progress).toBeGreaterThanOrEqual(0)
      expect(s.progress).toBeLessThanOrEqual(1)
    }
  })

  it('no da NaN tras miles de pasos con condiciones oscilantes', () => {
    const fr = createFruiting(CFG)
    const ctx = (t) => ({
      nitrogen: 40 + 40 * Math.sin(t * 0.3),
      temperature: 12 + 10 * Math.sin(t * 0.5),
      moisture: 0.5 + 0.4 * Math.cos(t * 0.2),
      co2: 500 + 800 * Math.sin(t * 0.7),
      light: 0.5 + 0.5 * Math.cos(t * 0.4),
    })
    const pasos = 5000
    for (let i = 0; i < pasos; i++) {
      updateFruiting(fr, CFG, DT, ctx(i * DT))
      const s = fruitingState(fr)
      expect(Number.isFinite(s.progress)).toBe(true)
      expect(Number.isFinite(s.spores)).toBe(true)
      expect(Number.isNaN(s.progress)).toBe(false)
    }
  })
})
