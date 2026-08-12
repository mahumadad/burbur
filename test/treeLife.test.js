import { describe, it, expect } from 'vitest'
import { createTreeLife, updateTreeLife, seedMature } from '../src/sim/treeLife.js'

const CFG = {
  youngAt: 2, matureAt: 5, senescentAt: 9, fallAt: 12,
  fallenYears: 2, maxYear: 6,
  // Rampa de crecimiento en TIEMPO REAL (segundos), no en años. Con el reloj
  // comprimido de estas pruebas (1 año = 60 pasos × 1/60 s = 1 s), growSecs=10
  // significa que la copa se llena en ~10 "años" de prueba.
  growSecs: 10,
}

const DT = 1 / 60
const PASOS_POR_ANO = 60   // un "año" de prueba = 60 pasos (= 1 s de reloj real)

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
    // A los ~10 "años" de prueba (= growSecs) ya llegó al tope y se quedó ahí.
    expect(st.growth).toBe(CFG.maxYear)
  })

  it('la copa se llena en ~growSecs segundos, no en años', () => {
    const st = createTreeLife(CFG, () => 0.5)
    // Medio growSecs → copa a medio revelar; growSecs completo → tope.
    avanzar(st, CFG, 5)
    expect(st.growth).toBeGreaterThan(2)
    expect(st.growth).toBeLessThan(CFG.maxYear)
    avanzar(st, CFG, 6)
    expect(st.growth).toBe(CFG.maxYear)
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
    // Al rebrotar, `growth` vuelve a 0 y re-crece en TIEMPO REAL (rampa de
    // growSecs). Tras el rebrote queda ~1 s de reloj corriendo como plantón, así
    // que la copa apenas empieza a revelarse: mucho menos que el tope, pero > 0
    // (nunca se queda colapsada en la base, el artefacto que hay que evitar —
    // ver bark.js: smoothstep(aYear, aYear+1, uGrowth) colapsa la rama con 0).
    expect(st.growth).toBeGreaterThan(0)
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
