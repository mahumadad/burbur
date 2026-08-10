// Comportamientos dirigidos a objetivos (mejora propia; murmur no los tiene).
// Puro: coordenadas normalizadas (x,z) en [-1,1]; el render las lleva al mundo.

/** Bichitos voladores que van de flor en flor, se posan un rato y siguen. */
export function createBugs(cfg, flowers, rand = Math.random) {
  const bugs = []
  if (!flowers.length) return bugs
  for (let i = 0; i < cfg.count; i++) {
    const f = flowers[(rand() * flowers.length) | 0]
    bugs.push({
      x: f.x + (rand() - 0.5) * 0.05,
      z: f.z + (rand() - 0.5) * 0.05,
      tx: f.x, tz: f.z,
      hover: cfg.hoverMin + rand() * (cfg.hoverMax - cfg.hoverMin),
      state: 'fly',
      phase: rand() * 6.2832,
      spd: cfg.speed * (0.7 + rand() * 0.6),
      colorIdx: (rand() * 4) | 0,
      alive: true,
    })
  }
  return bugs
}

function retarget(bug, flowers, rand) {
  const f = flowers[(rand() * flowers.length) | 0]
  bug.tx = f.x; bug.tz = f.z
  bug.state = 'fly'
}

/**
 * @param {Array} hunters  posiciones {x,z} de depredadores, para huir (opcional)
 */
export function updateBugs(bugs, flowers, cfg, dt, rand = Math.random, hunters = null) {
  if (!flowers.length) return bugs
  for (const b of bugs) {
    if (!b.alive) {
      // Reaparece tras un tiempo en otra flor: la población se mantiene.
      b.respawn -= dt
      if (b.respawn <= 0) { retarget(b, flowers, rand); b.x = b.tx; b.z = b.tz; b.alive = true }
      continue
    }
    b.phase += dt * 3

    // Huir si hay un depredador cerca.
    let fleeX = 0, fleeZ = 0, fleeing = false
    if (hunters) {
      for (const h of hunters) {
        const dx = b.x - h.x, dz = b.z - h.z
        const d2 = dx * dx + dz * dz
        if (d2 < cfg.fleeRadius * cfg.fleeRadius && d2 > 1e-6) {
          const d = Math.sqrt(d2)
          fleeX += dx / d; fleeZ += dz / d; fleeing = true
        }
      }
    }

    if (fleeing) {
      const m = Math.hypot(fleeX, fleeZ) || 1
      b.x += (fleeX / m) * cfg.speed * 2.2 * dt
      b.z += (fleeZ / m) * cfg.speed * 2.2 * dt
      b.state = 'fly'
      b.hover = 0
      continue
    }

    const dx = b.tx - b.x, dz = b.tz - b.z
    const d = Math.hypot(dx, dz)
    if (b.state === 'hover' || d < cfg.arrive) {
      b.state = 'hover'
      b.hover -= dt
      // Revolotea alrededor de la flor.
      b.x = b.tx + Math.cos(b.phase * 1.7) * 0.012
      b.z = b.tz + Math.sin(b.phase * 1.3) * 0.012
      if (b.hover <= 0) {
        b.hover = cfg.hoverMin + rand() * (cfg.hoverMax - cfg.hoverMin)
        retarget(b, flowers, rand)
      }
    } else {
      // Vuela hacia la flor con un poco de zigzag.
      const jx = -dz / d * Math.sin(b.phase) * cfg.jitter
      const jz = dx / d * Math.sin(b.phase) * cfg.jitter
      b.x += ((dx / d) + jx) * b.spd * dt
      b.z += ((dz / d) + jz) * b.spd * dt
    }
  }
  return bugs
}

/** Índice del bicho vivo más cercano a (x,z) dentro de un radio, o -1. */
export function nearestBug(bugs, x, z, radius) {
  let best = radius * radius, idx = -1
  for (let i = 0; i < bugs.length; i++) {
    const b = bugs[i]
    if (!b.alive) continue
    const dx = b.x - x, dz = b.z - z
    const d2 = dx * dx + dz * dz
    if (d2 < best) { best = d2; idx = i }
  }
  return idx
}
