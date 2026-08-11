import { describe, it, expect } from 'vitest'
import { createBrain, updateBrain } from '../src/sim/brainstate.js'

const CFG = {
  riskRate: 6, seizeExc: 2.6, seizeInh: 0.2, seizeDur: 9, postictalDur: 5,
  downMin: 0.7, downMax: 1.6, downDur: 0.4, spindleGap: 2.5, spindleDur: 1.0,
}
function seeded(seed = 1) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
const ctx = (phase, over = {}) => ({ phase, excitatory: false, calming: false, tension: 0.2, ...over })

describe('estado cerebral', () => {
  it('la sincronía objetivo es mayor en sueño profundo que despierto', () => {
    const deep = updateBrain(createBrain(CFG), CFG, 0.1, ctx('N3 deep'))
    const awake = updateBrain(createBrain(CFG), CFG, 0.1, ctx('focused'))
    expect(deep.syncTarget).toBeGreaterThan(awake.syncTarget)
  })

  it('el ritmo (omega) es más lento en sueño profundo que en atención', () => {
    const deep = updateBrain(createBrain(CFG), CFG, 0.1, ctx('N3 deep'))
    const focus = updateBrain(createBrain(CFG), CFG, 0.1, ctx('focused'))
    expect(deep.omegaScale).toBeLessThan(focus.omegaScale)
  })

  it('con tensión alta y neuromodulador excitante se dispara una convulsión', () => {
    const b = createBrain(CFG)
    const c = ctx('alert wake', { tension: 0.8, excitatory: true })
    let seized = false
    for (let k = 0; k < 200 && !seized; k++) {
      const r = updateBrain(b, CFG, 0.05, c)
      if (r.events.some((e) => e.kind === 'seizure')) seized = true
    }
    expect(seized).toBe(true)
    expect(b.mode).toBe('seizing')
  })

  it('la convulsión desbalancea E/I y luego pasa a silencio postictal', () => {
    const b = createBrain(CFG)
    const c = ctx('alert wake', { tension: 0.9, excitatory: true })
    while (b.mode !== 'seizing') updateBrain(b, CFG, 0.05, c)
    const mid = updateBrain(b, CFG, 0.05, c)
    expect(mid.excMul).toBeGreaterThan(1)   // excitación amplificada
    expect(mid.inhMul).toBeLessThan(1)      // inhibición hundida
    // Tras seizeDur pasa a postictal, donde la red se calla (firing 0).
    let postictal = false
    for (let k = 0; k < 400 && !postictal; k++) {
      updateBrain(b, CFG, 0.05, c)
      if (b.mode === 'postictal') postictal = true
    }
    expect(postictal).toBe(true)
    // Ya dentro del postictal, el frame siguiente confirma la red muda.
    expect(updateBrain(b, CFG, 0.05, c).firing).toBe(0)
  })

  it('el postictal termina y la red vuelve a la normalidad con el riesgo a cero', () => {
    const b = createBrain(CFG)
    const c = ctx('quiet wake', { tension: 0.9, excitatory: true })
    while (b.mode !== 'seizing') updateBrain(b, CFG, 0.05, c)
    // Deja pasar toda la crisis + el postictal con condiciones ya calmas.
    const calm = ctx('quiet wake', { tension: 0.1, calming: true })
    for (let k = 0; k < 600; k++) {
      updateBrain(b, CFG, 0.05, calm)
      if (b.mode === 'normal') break
    }
    expect(b.mode).toBe('normal')
    expect(b.risk).toBe(0)
  })

  it('en sueño profundo aparecen estados DOWN que apagan la red y se recuperan', () => {
    const b = createBrain(CFG)
    const c = ctx('N3 deep')
    const rand = seeded(3)
    let sawDown = false, sawUp = false, gatedSilent = false
    for (let k = 0; k < 400; k++) {
      const r = updateBrain(b, CFG, 0.05, c, rand)
      if (r.events.some((e) => e.kind === 'down')) sawDown = true
      if (b.down && r.firing === 0) gatedSilent = true
      if (r.events.some((e) => e.kind === 'up')) sawUp = true
    }
    expect(sawDown).toBe(true)
    expect(gatedSilent).toBe(true)
    expect(sawUp).toBe(true)
  })

  it('en N2 aparecen husos de sueño', () => {
    const b = createBrain(CFG)
    const c = ctx('N2 spindles')
    let spindle = false
    for (let k = 0; k < 200 && !spindle; k++) {
      const r = updateBrain(b, CFG, 0.05, c)
      if (r.events.some((e) => e.kind === 'spindle')) spindle = true
    }
    expect(spindle).toBe(true)
  })

  it('el gabaérgico (calmante) impide que suba el riesgo de convulsión', () => {
    const b = createBrain(CFG)
    const c = ctx('quiet wake', { tension: 0.8, calming: true })
    for (let k = 0; k < 200; k++) updateBrain(b, CFG, 0.05, c)
    expect(b.risk).toBe(0)
    expect(b.mode).toBe('normal')
  })
})
