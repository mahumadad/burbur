// Máquina de estados de la fructificación de Pleurotus: el clímax del mundo
// micelio. NO se agenda por reloj — se GANA: hacen falta reservas de
// nitrógeno (cazadas de nematodos), un choque térmico (una CAÍDA de
// temperatura, no frío constante — así inducen los cultivadores de verdad) y
// humedad suficiente, las tres cosas a la vez. Puro: sin three/DOM.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

// Orden fijo de las etapas; 'dormant' no tiene duración propia, espera el disparador.
const SIGUIENTE = { primordia: 'expanding', expanding: 'sporulating', sporulating: 'senescent', senescent: 'dormant' }

function duracion(cfg, etapa) {
  switch (etapa) {
    case 'primordia': return cfg.primordiaDuration
    case 'expanding': return cfg.expandingDuration
    case 'sporulating': return cfg.sporulatingDuration
    case 'senescent': return cfg.senescentDuration
    default: return Infinity
  }
}

/**
 * @param {object} cfg  { nitrogenThreshold, shockDelta, shockWindow, moistureMin,
 *   co2Max, lightMin, nitrogenCost, sporeRate, deformedSporeFactor,
 *   primordiaDuration, expandingDuration, sporulatingDuration, senescentDuration }
 */
export function createFruiting(cfg) {
  return {
    stage: 'dormant',
    stageTime: 0,
    progress: 0,
    deformed: false,
    spores: 0,
    nitrogenSpent: 0, // último gasto de nitrógeno reportado; el mundo lo aplica y descuenta
    time: 0,
    tempWindow: [], // {t, temp} recientes, para detectar la CAÍDA de temperatura
  }
}

/**
 * @param {object} ctx  { nitrogen, temperature, moisture, co2, light }
 */
export function updateFruiting(fr, cfg, dt, ctx) {
  fr.time += dt

  // ── Choque térmico: hace falta la CAÍDA, no el frío en sí ────────────────
  // Se guarda la temperatura máxima vista dentro de `shockWindow` segundos y
  // se compara contra la actual. Frío constante nunca dispara: el máximo
  // reciente termina siendo igual a la temperatura actual.
  fr.tempWindow.push({ t: fr.time, temp: ctx.temperature })
  while (fr.tempWindow.length > 1 && fr.tempWindow[0].t < fr.time - cfg.shockWindow) {
    fr.tempWindow.shift()
  }
  let maxReciente = -Infinity
  for (const m of fr.tempWindow) if (m.temp > maxReciente) maxReciente = m.temp
  const choqueTermico = maxReciente - ctx.temperature >= cfg.shockDelta

  if (fr.stage === 'dormant') {
    const gatillo =
      ctx.nitrogen >= cfg.nitrogenThreshold && choqueTermico && ctx.moisture >= cfg.moistureMin
    if (gatillo) {
      fr.stage = 'primordia'
      fr.stageTime = 0
      // Deforme (asta de ciervo: pie largo, sin sombrero) queda decidido en
      // el instante en que se forman los primordios — CO2 alto o poca luz.
      fr.deformed = ctx.co2 > cfg.co2Max || ctx.light < cfg.lightMin
      // Fructificar GASTA el nitrógeno acumulado; el módulo no se lo descuenta
      // a nadie, solo reporta cuánto para que el mundo lo aplique.
      fr.nitrogenSpent = cfg.nitrogenCost
    }
  } else {
    fr.stageTime += dt

    if (fr.stage === 'sporulating') {
      const factor = fr.deformed ? cfg.deformedSporeFactor : 1
      fr.spores += cfg.sporeRate * factor * dt
    }

    if (fr.stageTime >= duracion(cfg, fr.stage)) {
      fr.stage = SIGUIENTE[fr.stage]
      fr.stageTime = 0
      if (fr.stage === 'dormant') fr.deformed = false // listo para el próximo ciclo
    }
  }

  const dur = duracion(cfg, fr.stage)
  fr.progress = fr.stage === 'dormant' || !(dur > 0) ? 0 : clamp01(fr.stageTime / dur)

  return fr
}

/** Subconjunto que necesita el render: etapa, avance dentro de ella, deformidad y esporas. */
export function fruitingState(fr) {
  return { stage: fr.stage, progress: fr.progress, deformed: fr.deformed, spores: fr.spores }
}
