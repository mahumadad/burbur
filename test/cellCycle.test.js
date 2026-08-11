import { describe, it, expect } from 'vitest'
import {
  createEcosystem, TIME_PHASES, WEATHERS, CELL_PROFILE, FOREST_PROFILE, MITOTIC_PHASES,
} from '../src/sim/ecosystem.js'
import { STAGE, createCycle, updateCycle, mitoticSubPhase } from '../src/sim/cellCycle.js'

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

// ── src/sim/cellCycle.js ──────────────────────────────────────────────────
// Config de referencia del spec (docs/superpowers/specs/2026-08-11-ciclo-y-división-celula.md §4).
const CC = {
  atpMin: 0.55,
  mitogenicMedia: ['nutrient rich', 'inflamed'],
  readinessRate: 0.05,
  readinessDecay: 0.12,
  g1: 18, s: 22, g2: 12, m: 16, cyto: 8,
  refractory: 90,
}

const GOOD = { atp: 0.8, medium: 'nutrient rich' }
const LOW_ATP = { atp: 0.2, medium: 'nutrient rich' } // medio mitogénico pero sin energía
const BAD_MEDIUM = { atp: 0.9, medium: 'hypoxic' } // energía sobrada pero medio no mitogénico

/** Corre `n` frames de 1s y devuelve todos los eventos emitidos, en orden. */
function run(cycle, cfg, n, ctx) {
  const events = []
  for (let i = 0; i < n; i++) events.push(...updateCycle(cycle, cfg, 1, ctx))
  return events
}

describe('ciclo celular', () => {
  it('se queda en G0 indefinidamente con ATP bajo o medio no mitogénico', () => {
    const c1 = createCycle(CC)
    run(c1, CC, 1000, LOW_ATP)
    expect(c1.stage).toBe(STAGE.G0)
    expect(c1.readiness).toBe(0)

    const c2 = createCycle(CC)
    run(c2, CC, 1000, BAD_MEDIUM)
    expect(c2.stage).toBe(STAGE.G0)
    expect(c2.readiness).toBe(0)
  })

  it('con condiciones buenas sostenidas entra a G1, y no antes de 1/readinessRate segundos', () => {
    const cycle = createCycle(CC)
    const before = run(cycle, CC, 19, GOOD) // 19 s < 20 s = 1/0.05
    expect(before.length).toBe(0)
    expect(cycle.stage).toBe(STAGE.G0)

    const after = run(cycle, CC, 1, GOOD) // el segundo 20
    expect(after).toEqual([{ kind: 'enter', stage: STAGE.G1 }])
    expect(cycle.stage).toBe(STAGE.G1)
  })

  it('un pico corto de condiciones buenas no alcanza: la readiness decae', () => {
    const cycle = createCycle(CC)
    run(cycle, CC, 5, GOOD) // readiness ~0.25, lejos de 1
    run(cycle, CC, 100, LOW_ATP) // se corta la señal por mucho más tiempo del que estuvo
    expect(cycle.readiness).toBe(0)
    expect(cycle.stage).toBe(STAGE.G0)
  })

  it('aborta en el punto de restricción si las condiciones se pierden durante G1', () => {
    const cycle = createCycle(CC)
    run(cycle, CC, 20, GOOD) // entra a G1
    expect(cycle.stage).toBe(STAGE.G1)
    const events = run(cycle, CC, CC.g1, BAD_MEDIUM) // dura G1 igual, pero sin señal al final
    expect(events).toEqual([{ kind: 'abort', stage: STAGE.G0 }])
    expect(cycle.stage).toBe(STAGE.G0)
    expect(cycle.readiness).toBe(0)
  })

  it('NO aborta si las condiciones se pierden en S/G2/M: llega a dividir igual', () => {
    const cycle = createCycle(CC)
    run(cycle, CC, 20, GOOD) // entra a G1
    const commit = run(cycle, CC, CC.g1, GOOD) // cruza el punto de restricción
    expect(commit).toEqual([{ kind: 'commit', stage: STAGE.S }])
    expect(cycle.stage).toBe(STAGE.S)

    // A partir de acá la señal se corta del todo: no debería importar.
    const rest = CC.s + CC.g2 + CC.m + CC.cyto
    const events = run(cycle, CC, rest, LOW_ATP)
    expect(events.some((e) => e.kind === 'abort')).toBe(false)
    expect(events).toEqual([{ kind: 'divide', stage: STAGE.G0 }])
    expect(cycle.stage).toBe(STAGE.G0)
    expect(cycle.divisions).toBe(1)
  })

  it('un ciclo completo emite exactamente un evento divide', () => {
    const cycle = createCycle(CC)
    const total = 20 + CC.g1 + CC.s + CC.g2 + CC.m + CC.cyto // ~96 s hasta la división
    // Nos quedamos bien dentro de la ventana refractaria (90 s) para no arrancar un segundo ciclo.
    const events = run(cycle, CC, total + 50, GOOD)
    const divides = events.filter((e) => e.kind === 'divide')
    expect(divides.length).toBe(1)
    expect(cycle.divisions).toBe(1)
  })

  it('tras dividir no puede reentrar antes de refractory', () => {
    const cycle = createCycle(CC)
    const toDivide = 20 + CC.g1 + CC.s + CC.g2 + CC.m + CC.cyto
    const divideEvents = run(cycle, CC, toDivide, GOOD)
    expect(divideEvents.some((e) => e.kind === 'divide')).toBe(true)
    expect(cycle.refractory).toBeGreaterThan(0)

    // Con condiciones perfectas sostenidas, mientras dure el refractario la
    // readiness se mantiene en 0: no hay forma de reentrar antes de tiempo.
    run(cycle, CC, CC.refractory - 1, GOOD)
    expect(cycle.stage).toBe(STAGE.G0)
    expect(cycle.readiness).toBe(0)

    // Un segundo más y el refractario ya expiró: la readiness puede volver a subir.
    run(cycle, CC, 1, GOOD)
    expect(cycle.refractory).toBe(0)
    expect(cycle.readiness).toBeGreaterThan(0)
  })

  it('mitoticSubPhase recorre las 5 sub-fases en orden durante M+CYTO, con phaseT en [0,1]', () => {
    const cycle = createCycle(CC)
    // Fuera de M/CYTO: fase neutra.
    expect(mitoticSubPhase(cycle)).toEqual({ phase: 'G1', phaseT: 0 })

    run(cycle, CC, 20 + CC.g1 + CC.s + CC.g2, GOOD) // deja el ciclo justo entrando a M
    expect(cycle.stage).toBe(STAGE.M)

    const seenPhases = []
    let sawDivide = false
    for (let i = 0; i < CC.m + CC.cyto; i++) {
      const evs = updateCycle(cycle, CC, 1, GOOD)
      if (evs.some((e) => e.kind === 'divide')) sawDivide = true
      const { phase, phaseT } = mitoticSubPhase(cycle)
      expect(phaseT).toBeGreaterThanOrEqual(0)
      expect(phaseT).toBeLessThanOrEqual(1)
      if (seenPhases[seenPhases.length - 1] !== phase) seenPhases.push(phase)
    }
    // El último frame de CYTO dispara la división en el mismo instante: el
    // ciclo ya volvió a G0 (fase neutra) para cuando se lee mitoticSubPhase.
    // Eso es correcto (la separación es instantánea), no una sub-fase más.
    expect(seenPhases).toEqual(['prophase', 'metaphase', 'anaphase', 'telophase', 'cytokinesis', 'G1'])
    expect(sawDivide).toBe(true)
    expect(cycle.stage).toBe(STAGE.G0) // la citocinesis terminó y dividió
  })

  it('no da NaN tras miles de pasos con condiciones aleatorias', () => {
    function seeded(seed) {
      let s = seed >>> 0
      return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
    }
    const rand = seeded(42)
    const media = ['nutrient rich', 'inflamed', 'hypoxic', 'serum starved', 'acidic', 'inflamed']
    const cycle = createCycle(CC)
    for (let i = 0; i < 5000; i++) {
      const ctx = { atp: rand(), medium: media[Math.floor(rand() * media.length)] }
      updateCycle(cycle, CC, 1 / 60, ctx)
      expect(Number.isFinite(cycle.t)).toBe(true)
      expect(Number.isFinite(cycle.readiness)).toBe(true)
      expect(Number.isFinite(cycle.refractory)).toBe(true)
      expect(Number.isFinite(cycle.divisions)).toBe(true)
      const { phaseT } = mitoticSubPhase(cycle)
      expect(Number.isFinite(phaseT)).toBe(true)
      expect(phaseT).toBeGreaterThanOrEqual(0)
      expect(phaseT).toBeLessThanOrEqual(1)
    }
  })
})
