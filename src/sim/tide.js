// Nivel de marea de la POZA. Puro: sin three/tone/DOM.
// El reloj del mundo son 12 fases = un día solar; la marea es SEMIDIURNA, así
// que da DOS vueltas en ese día (dos pleamares y dos bajamares), igual que en la
// costa chilena. Ver docs/superpowers/specs/2026-08-13-mundo-poza-marea-design.md §2.1.

// Fases por ciclo de marea: 12 fases / 2 ciclos = 6.
const PHASES_PER_CYCLE = 6

/**
 * Sumersión de la poza en la fase dada.
 * @param {number} phaseIndex  fase 0-based del ecosistema (0..11)
 * @param {number} [phaseT]    0..1 dentro de la fase
 * @returns {number} 0 = bajamar (poza aislada) … 1 = pleamar (sumergida)
 */
export function tideLevel(phaseIndex, phaseT = 0) {
  const x = phaseIndex + phaseT
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / PHASES_PER_CYCLE)
}
