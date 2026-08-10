// Economía de ATP: los cuantos nacen en las mitocondrias, viajan a un
// consumidor (un motor, una bomba, el frente de actina) y se gastan al llegar.
//
// El pool es de tamaño FIJO, a propósito: se dibuja con `createPointCloud(count)`
// del engine, que preasigna. Lleno, la producción se rechaza — que es también lo
// que pasa de verdad cuando no hay ADP libre que fosforilar.
//
// `budget` (0..1) es la variable que acopla todo el mundo: modula la protrusión
// de `motility.js`, la velocidad del tráfico y la densidad de eventos.
// Puro: coordenadas (x,z) normalizadas.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * @param {object} cfg  { capacity, speed, arrive, gainPerQuantum, drain }
 */
export function createAtpPool(cfg) {
  const quanta = []
  for (let i = 0; i < cfg.capacity; i++) {
    quanta.push({ alive: false, x: 0, z: 0, tx: 0, tz: 0 })
  }
  return { quanta, budget: 0.5 }
}

/** Emite un cuanto desde (x,z) hacia (tx,tz). `false` si el pool está lleno. */
export function spawnQuantum(pool, x, z, tx, tz) {
  for (const q of pool.quanta) {
    if (q.alive) continue
    q.alive = true
    q.x = x; q.z = z; q.tx = tx; q.tz = tz
    return true
  }
  return false
}

/**
 * @param {number} demand  cuánto está gastando la célula ahora (0..1)
 * @returns {Array<{x:number,z:number}>} entregas de este frame (para sonido/destello)
 */
export function updateAtp(pool, cfg, dt, demand = 0) {
  const delivered = []
  const step = cfg.speed * dt
  for (const q of pool.quanta) {
    if (!q.alive) continue
    const dx = q.tx - q.x, dz = q.tz - q.z
    const d = Math.hypot(dx, dz)
    if (d <= cfg.arrive || d <= step) {
      q.alive = false
      // Solo la ENTREGA repone: un cuanto en vuelo todavía no alimentó nada.
      pool.budget = clamp01(pool.budget + cfg.gainPerQuantum)
      delivered.push({ x: q.tx, z: q.tz })
      continue
    }
    q.x += (dx / d) * step
    q.z += (dz / d) * step
  }
  pool.budget = clamp01(pool.budget - cfg.drain * demand * dt)
  return delivered
}
