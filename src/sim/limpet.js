// Lapa (Fissurella) con HOMING a su cicatriz. Puro: sin three/tone/DOM.
// Una lapa real pastorea algas mientras el agua la cubre y, antes de quedar
// expuesta, vuelve al MISMO punto de la roca — su cicatriz, desgastada a la
// forma exacta de su concha, que es lo que le permite sellarse y no secarse.
// Ver docs/superpowers/specs/2026-08-13-mundo-poza-marea-design.md §4.2.

export const LIMPET_CFG = {
  maxRadius: 1.2,          // hasta dónde se aleja de la cicatriz
  grazeSpeed: 0.35,        // avance mientras pastorea (unidades/s)
  homeSpeed: 0.9,          // regreso a casa: más decidido que la ida
  turnRate: 1.6,           // deriva del rumbo de pastoreo (rad/s)
  submergeThreshold: 0.35, // bajo esta sumersión, a casa
}

/**
 * @param {number} scarX
 * @param {number} scarZ
 */
export function createLimpet(scarX, scarZ) {
  return { scarX, scarZ, x: scarX, z: scarZ, ang: 0, dist: 0 }
}

/**
 * Avanza una lapa un paso. MUTA `limpet`.
 * @param {object} limpet     de createLimpet
 * @param {number} submersion 0..1 (salida de tideLevel)
 * @param {number} dt         segundos
 * @param {object} cfg        LIMPET_CFG
 * @param {function} [rand]
 */
export function updateLimpet(limpet, submersion, dt, cfg, rand = Math.random) {
  if (submersion >= cfg.submergeThreshold) {
    // Pastorea: el rumbo deriva suave y la distancia a la cicatriz crece hasta el tope.
    limpet.ang += (rand() - 0.5) * cfg.turnRate * dt
    limpet.dist = Math.min(cfg.maxRadius, limpet.dist + cfg.grazeSpeed * dt)
  } else {
    // La marea se va: vuelve. Al llegar, se PEGA exacto (sin residuo flotante).
    limpet.dist = Math.max(0, limpet.dist - cfg.homeSpeed * dt)
  }
  limpet.x = limpet.scarX + Math.cos(limpet.ang) * limpet.dist
  limpet.z = limpet.scarZ + Math.sin(limpet.ang) * limpet.dist
}
