// Apertura de la anémona (ortiga de mar, Phymactis). Puro: sin three/tone/DOM.
// Una anémona real solo despliega tentáculos bajo el agua: fuera se cierra en una
// perla para no secarse, y con golpe de ola se retrae a medias para no romperse.
// Ver docs/superpowers/specs/2026-08-13-mundo-poza-marea-design.md §4.2.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
// Suavizado: la apertura no es lineal — arranca lenta y se completa al final.
const smooth = (t) => t * t * (3 - 2 * t)

// Cuánto llega a retraerse con el oleaje más bravo (nunca cierra del todo: si
// cerrara con cada ola no comería nunca).
const AGITATION_PULL = 0.65

/**
 * @param {number} submersion  0..1 (salida de tideLevel)
 * @param {number} [agitation] 0..1 (el `rain` del estado de OLEAJE)
 * @returns {number} 0 = cerrada en perla … 1 = corona abierta
 */
export function anemoneOpen(submersion, agitation = 0) {
  const s = smooth(clamp01(submersion))
  const a = clamp01(agitation)
  return clamp01(s * (1 - AGITATION_PULL * a))
}
