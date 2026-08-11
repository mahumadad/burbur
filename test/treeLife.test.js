import { describe, it, expect } from 'vitest'
import { createTreeLife, updateTreeLife, seedMature } from '../src/sim/treeLife.js'

const CFG = {
  youngAt: 2, matureAt: 5, senescentAt: 9, fallAt: 12,
  fallenYears: 2, maxYear: 6,
}

const DT = 1 / 60
const PASOS_POR_ANO = 60   // un "año" de prueba = 60 pasos

/** Avanza `anos` años completos, dando vueltas al reloj de estación. */
function avanzar(st, cfg, anos) {
  const eventos = { cayo: 0, rebroto: 0 }
  for (let a = 0; a < anos; a++) {
    for (let i = 0; i < PASOS_POR_ANO; i++) {
      const ev = updateTreeLife(st, cfg, DT, i / PASOS_POR_ANO)
      if (ev.cayo) eventos.cayo++
      if (ev.rebroto) eventos.rebroto++
    }
  }
  return eventos
}

describe('ciclo de vida del árbol', () => {
  it('arranca como plantón, sin crecimiento y sin vigor', () => {
    const st = createTreeLife(CFG, () => 0.5)
    expect(st.stage).toBe('sapling')
    expect(st.growth).toBe(0)
    expect(st.vigor).toBeLessThan(0.5)
  })

  it('recorre las etapas en orden a medida que pasan los años', () => {
    const st = createTreeLife(CFG, () => 0.5)
    avanzar(st, CFG, 3); expect(st.stage).toBe('young')
    avanzar(st, CFG, 3); expect(st.stage).toBe('mature')
    avanzar(st, CFG, 5); expect(st.stage).toBe('senescent')
  })

  it('el crecimiento es monótono y se detiene en maxYear', () => {
    const st = createTreeLife(CFG, () => 0.5)
    let previo = -1
    for (let a = 0; a < 12; a++) {
      avanzar(st, CFG, 1)
      expect(st.growth).toBeGreaterThanOrEqual(previo)
      previo = st.growth
    }
    expect(st.growth).toBeLessThanOrEqual(CFG.maxYear)
  })

  it('el vigor sube hasta maduro y baja en la senescencia', () => {
    const st = createTreeLife(CFG, () => 0.5)
    avanzar(st, CFG, 6)
    const maduro = st.vigor
    expect(maduro).toBeGreaterThan(0.9)
    avanzar(st, CFG, 4)
    expect(st.vigor).toBeLessThan(maduro)
  })

  it('cae, se inclina, y después rebrota como plantón en otra posición', () => {
    // 15 años: cae en el año 12 y rebrota dos años después, dejando el resto
    // del último año como plantón recién nacido.
    const st = createTreeLife(CFG, () => 0.5)
    const ev = avanzar(st, CFG, 15)
    expect(ev.cayo).toBe(1)
    expect(ev.rebroto).toBe(1)
    expect(st.stage).toBe('sapling')
    expect(st.age).toBeLessThan(1)
    // DESVIACIÓN respecto al plan: la aserción original era `toBe(0)`, pero
    // tras el rebrote quedan ~59/60 de año simulado corriendo como plantón, y
    // `growth` sigue a `age` de forma continua (igual que `age`, nunca llega a
    // 1). Que `growth` se quede en 0 casi un año entero dejaría cualquier
    // árbol recién nacido o rebrotado colapsado/invisible en el render (ver
    // bark.js: smoothstep(aYear, aYear+1, uGrowth) colapsa la rama en su base
    // cuando uGrowth es 0), justo el artefacto que el plan pide evitar. El
    // criterio correcto es el mismo que ya usa `age`.
    expect(st.growth).toBeLessThan(1)
  })

  it('mientras está caído se inclina hasta el suelo', () => {
    const st = createTreeLife(CFG, () => 0.5)
    avanzar(st, CFG, 13)
    expect(st.stage).toBe('fallen')
    expect(st.tilt).toBeGreaterThan(0)
    expect(st.vigor).toBe(0)
  })
})

describe('seedMature (atajo de depuración)', () => {
  it('deja el árbol adulto, con copa plena y sin caer', () => {
    const st = seedMature(createTreeLife(CFG, () => 0.5), CFG)
    expect(st.stage).toBe('mature')
    expect(st.growth).toBe(CFG.maxYear)
    expect(st.vigor).toBe(1)
  })

  it('con la estación fija se queda maduro: el año nunca da la vuelta', () => {
    const st = seedMature(createTreeLife(CFG, () => 0.5), CFG)
    // Muchos pasos con el MISMO seasonT (no hay wraparound): no debe envejecer.
    for (let i = 0; i < 300; i++) updateTreeLife(st, CFG, 1 / 60, 0.45)
    expect(st.stage).toBe('mature')
    expect(st.growth).toBe(CFG.maxYear)
  })
})
