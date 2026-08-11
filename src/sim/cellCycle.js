// Ciclo celular del macrófago: máquina de estados GATEADA por condiciones, no
// por un reloj. Un macrófago vive casi siempre en G0 (quiescencia) y solo
// entra en ciclo si recibe señal mitogénica SOSTENIDA (nutrientes o
// inflamación) — un pico corto no alcanza, por eso `readinessDecay` es mayor
// que `readinessRate`: la señal se desarma más rápido de lo que se arma.
// Al final de G1 hay un punto de restricción: es la última oportunidad de
// echarse atrás. Cruzarlo es un compromiso real (S/G2/M/CYTO ya no abortan),
// y eso es lo que le da sentido narrativo a la compuerta.
// Puro: sin three/DOM. `mitoticSubPhase` traduce la fase M/CYTO a las
// sub-fases que ya entiende `mitosis.js`, sin duplicar esa lógica.

export const STAGE = { G0: 'G0', G1: 'G1', S: 'S', G2: 'G2', M: 'M', CYTO: 'cytokinesis' }

const SUB_PHASES = ['prophase', 'metaphase', 'anaphase', 'telophase']

/** @param {object} cfg  { atpMin, mitogenicMedia, readinessRate, readinessDecay, g1, s, g2, m, cyto, refractory } */
export function createCycle(cfg) {
  return { stage: STAGE.G0, t: 0, readiness: 0, refractory: 0, divisions: 0 }
}

/** ¿Hay señal mitogénica sostenida este frame? (ATP suficiente + medio que la dispara) */
function mitogenic(cfg, ctx) {
  return ctx.atp >= cfg.atpMin && cfg.mitogenicMedia.includes(ctx.medium)
}

/**
 * @param {object} cycle  el objeto de `createCycle`, mutado in-place
 * @param {object} cfg
 * @param {number} dt
 * @param {object} ctx  { atp: 0..1, medium: string }
 * @returns {Array<{ kind: 'enter'|'commit'|'abort'|'divide', stage: string }>}
 */
export function updateCycle(cycle, cfg, dt, ctx) {
  const events = []
  const good = mitogenic(cfg, ctx)

  switch (cycle.stage) {
    case STAGE.G0: {
      // El refractario baja con el tiempo; mientras dure, no se puede acumular
      // señal (no hay división en cadena).
      if (cycle.refractory > 0) cycle.refractory = Math.max(0, cycle.refractory - dt)
      if (good && cycle.refractory <= 0) {
        cycle.readiness += cfg.readinessRate * dt
      } else {
        // Integración de señal con fuga: sin condiciones (o todavía refractaria)
        // la readiness decae en vez de congelarse.
        cycle.readiness = Math.max(0, cycle.readiness - cfg.readinessDecay * dt)
      }
      if (cycle.readiness >= 1) {
        cycle.stage = STAGE.G1
        cycle.t = 0
        events.push({ kind: 'enter', stage: STAGE.G1 })
      }
      break
    }
    case STAGE.G1: {
      cycle.t += dt
      if (cycle.t >= cfg.g1) {
        // Punto de restricción: la única vez que las condiciones deciden algo
        // irreversible. Pasado esto, el ciclo ya no consulta `ctx`.
        if (good) {
          cycle.stage = STAGE.S
          cycle.t = 0
          events.push({ kind: 'commit', stage: STAGE.S })
        } else {
          cycle.stage = STAGE.G0
          cycle.t = 0
          cycle.readiness = 0
          events.push({ kind: 'abort', stage: STAGE.G0 })
        }
      }
      break
    }
    case STAGE.S: {
      cycle.t += dt
      if (cycle.t >= cfg.s) { cycle.stage = STAGE.G2; cycle.t = 0 }
      break
    }
    case STAGE.G2: {
      cycle.t += dt
      if (cycle.t >= cfg.g2) {
        cycle.stage = STAGE.M
        cycle.t = 0
        cycle.stageDur = cfg.m // solo lo necesita mitoticSubPhase, que no recibe cfg
      }
      break
    }
    case STAGE.M: {
      cycle.t += dt
      if (cycle.t >= cfg.m) {
        cycle.stage = STAGE.CYTO
        cycle.t = 0
        cycle.stageDur = cfg.cyto
      }
      break
    }
    case STAGE.CYTO: {
      cycle.t += dt
      if (cycle.t >= cfg.cyto) {
        cycle.stage = STAGE.G0
        cycle.t = 0
        cycle.readiness = 0
        cycle.refractory = cfg.refractory
        cycle.divisions += 1
        events.push({ kind: 'divide', stage: STAGE.G0 })
      }
      break
    }
  }
  return events
}

/**
 * Traduce la etapa M/CYTO a la sub-fase que entiende `mitosisState()` de
 * `src/sim/mitosis.js`. Fuera de M/CYTO no hay nada que animar: devuelve
 * `phaseT: 0` sobre una fase neutra, que `mitosisState` mapea a reposo.
 * @returns {{ phase: string, phaseT: number }}
 */
export function mitoticSubPhase(cycle) {
  if (cycle.stage === STAGE.M) {
    const dur = cycle.stageDur || 1
    // Las 4 sub-fases se reparten en partes iguales dentro de M.
    const sub = Math.min(4, Math.max(0, (cycle.t / dur) * 4))
    const idx = Math.min(3, Math.floor(sub))
    return { phase: SUB_PHASES[idx], phaseT: sub - idx }
  }
  if (cycle.stage === STAGE.CYTO) {
    const dur = cycle.stageDur || 1
    return { phase: 'cytokinesis', phaseT: Math.min(1, Math.max(0, cycle.t / dur)) }
  }
  return { phase: 'G1', phaseT: 0 }
}
