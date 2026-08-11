// Ciclo de vida del árbol: crece, madura, envejece, cae y rebrota. Puro: sin
// three, sin DOM. Sigue la forma de fruiting.js (cfg + state + update).
//
// El reloj es el AÑO, no el segundo: se avanza cuando `seasonT` da la vuelta.
// Así la vida del árbol se lee como algo estacional y no como un temporizador.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

export function createTreeLife(cfg, rand = Math.random) {
  return {
    stage: 'sapling',
    anos: 0,         // años completos cumplidos (entero)
    age: 0,          // edad fraccionaria = anos + seasonT
    growth: 0,       // años de rama reveladas (0..cfg.maxYear)
    vigor: 0.25,     // 0..1, cuánta hoja es capaz de sostener
    tilt: 0,         // 0..1, cuánto lleva inclinado al caer
    caido: 0,        // años que lleva en el suelo
    seed: rand(),
    ultimaSeason: 0,
  }
}

/**
 * @returns {{cayo: boolean, rebroto: boolean}} eventos de ESTE paso
 */
export function updateTreeLife(st, cfg, dt, seasonT) {
  const ev = { cayo: false, rebroto: false }

  // El año avanza cuando el reloj de estación DA LA VUELTA. Es la única fuente
  // de tiempo aquí: nada se mide en segundos, así la vida del árbol se lee como
  // algo estacional y no como un temporizador.
  const nuevoAno = seasonT < st.ultimaSeason
  st.ultimaSeason = seasonT
  if (nuevoAno) st.anos += 1

  if (st.stage === 'fallen') {
    // La inclinación sí es continua: la caída se ve, no se salta.
    st.tilt = clamp01(st.tilt + dt * 0.35)
    st.vigor = 0
    if (nuevoAno) st.caido += 1
    if (st.caido >= cfg.fallenYears) {
      // Rebrote: vuelve a empezar. El mundo se encarga de reubicarlo.
      st.stage = 'sapling'
      st.anos = 0
      st.age = seasonT
      st.growth = 0
      st.vigor = 0.25
      st.tilt = 0
      st.caido = 0
      ev.rebroto = true
    }
    return ev
  }

  st.age = st.anos + seasonT
  // Crecimiento acumulativo: nunca retrocede, y se detiene en maxYear.
  st.growth = Math.min(cfg.maxYear, Math.max(st.growth, st.age))

  const etapaPrevia = st.stage
  if (st.age >= cfg.fallAt) st.stage = 'fallen'
  else if (st.age >= cfg.senescentAt) st.stage = 'senescent'
  else if (st.age >= cfg.matureAt) st.stage = 'mature'
  else if (st.age >= cfg.youngAt) st.stage = 'young'
  else st.stage = 'sapling'

  if (st.stage === 'fallen' && etapaPrevia !== 'fallen') {
    ev.cayo = true
    st.caido = 0
    st.vigor = 0
    return ev
  }

  // Vigor: sube hasta maduro y decae en la senescencia.
  if (st.stage === 'senescent') {
    const t = (st.age - cfg.senescentAt) / (cfg.fallAt - cfg.senescentAt)
    st.vigor = clamp01(1 - t * 0.85)
  } else {
    st.vigor = clamp01(0.25 + 0.75 * (st.age / cfg.matureAt))
  }

  return ev
}
