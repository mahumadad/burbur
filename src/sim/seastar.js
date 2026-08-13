// Estrella de sol (Heliaster) cazando choritos por QUIMIOTAXIS. Puro: sin
// three/tone/DOM. Es el depredador LENTO de la poza: repta sobre la roca siguiendo
// el rastro del banco de choritos, se pliega encima, evierte el estómago y digiere
// fuera del cuerpo — por eso tras comer queda un buen rato quieta (refractario).
// Ver docs/superpowers/specs/2026-08-13-mundo-poza-marea-design.md §4.2.

export const SEASTAR_CFG = {
  crawlSpeed: 0.9,   // unidades/s — lentísima comparada con un pez
  senseRadius: 26,   // hasta dónde huele el banco
  eatRadius: 1.6,    // distancia a la que ya está encima
  refractory: 14,    // segundos digiriendo tras comer
}

/**
 * @param {number} x
 * @param {number} z
 */
export function createSeastar(x, z) {
  return { x, z, cooldown: 0, target: -1 }
}

// El parche más "oloroso": densidad de presa atenuada por la distancia.
function bestPatch(star, patches, cfg) {
  let best = -1, bestScore = 0
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i]
    if (p.count <= 0) continue
    const d = Math.hypot(p.x - star.x, p.z - star.z)
    if (d > cfg.senseRadius) continue
    const score = p.count / (1 + d)
    if (score > bestScore) { bestScore = score; best = i }
  }
  return best
}

/**
 * Avanza la estrella un paso. MUTA `star` y, al comer, el `count` del parche.
 * @param {object} star      de createSeastar
 * @param {Array<{x:number,z:number,count:number}>} patches
 * @param {number} dt        segundos
 * @param {object} cfg       SEASTAR_CFG
 * @returns {number} índice del parche comido en este paso, o -1
 */
export function updateSeastar(star, patches, dt, cfg) {
  if (star.cooldown > 0) {
    star.cooldown = Math.max(0, star.cooldown - dt)
    return -1
  }
  const i = bestPatch(star, patches, cfg)
  star.target = i
  if (i < 0) return -1

  const p = patches[i]
  const dx = p.x - star.x, dz = p.z - star.z
  const d = Math.hypot(dx, dz)
  if (d <= cfg.eatRadius) {
    p.count -= 1
    star.cooldown = cfg.refractory
    star.target = -1
    return i
  }
  const step = Math.min(cfg.crawlSpeed * dt, d)
  star.x += (dx / d) * step
  star.z += (dz / d) * step
  return -1
}
