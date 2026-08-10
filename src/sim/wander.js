// Deambular libre con estados move/rest y separación mutua.
// Reproduce el comportamiento observado en murmur: los agentes no siguen rutas
// predefinidas; las líneas punteadas del mundo son su estela acumulada.
// Puro: coordenadas normalizadas (x,z) en [-1,1]; sin three/DOM.

export function createRoamers(cfg, count, rand = Math.random) {
  const rs = []
  for (let i = 0; i < count; i++) {
    rs.push({
      x: (rand() * 2 - 1) * 0.7,
      z: (rand() * 2 - 1) * 0.7,
      vx: (rand() - 0.5) * 2,
      vz: (rand() - 0.5) * 2,
      wanderAng: rand() * 6.2832,
      state: 'move',
      stateT: 1 + rand() * 4,
      speedScale: 0.6 + rand() * 0.85,
      hx: 0, hz: 1,
      onPath: false,
    })
  }
  return rs
}

/**
 * @param {object} cfg  { density, wanderTurn, wanderPush, kickMin, kickRange,
 *                        separation, sepRadius, drag, maxSpeed, bound }
 */
export function updateRoamers(rs, cfg, dt, rand = Math.random) {
  const n = rs.length

  // Separación mutua: se empujan para no encimarse.
  const sr = cfg.sepRadius
  for (let i = 0; i < n; i++) {
    const a = rs[i]
    for (let j = i + 1; j < n; j++) {
      const b = rs[j]
      const dx = b.x - a.x, dz = b.z - a.z
      const d2 = dx * dx + dz * dz
      if (d2 < sr * sr && d2 > 1e-6) {
        const d = Math.sqrt(d2)
        const f = (cfg.separation * (1 - d / sr)) / d * dt
        a.vx -= dx * f; a.vz -= dz * f
        b.vx += dx * f; b.vz += dz * f
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const r = rs[i]

    // Alternancia move / rest: el mundo respira en vez de moverse sin parar.
    r.stateT -= dt
    if (r.stateT <= 0) {
      if (r.state === 'move') {
        r.state = 'rest'
        r.stateT = (1.2 + rand() * 3.5) / cfg.density
      } else {
        r.state = 'move'
        r.stateT = (2.5 + rand() * 5) / cfg.density
        const kick = cfg.kickMin + rand() * cfg.kickRange
        r.vx += Math.cos(r.wanderAng) * kick
        r.vz += Math.sin(r.wanderAng) * kick
      }
    }
    const T = r.state === 'move' ? 1 : 0.05

    // El ángulo de deambular deriva suavemente → trayectorias curvas, no rectas.
    r.wanderAng += (rand() - 0.5) * cfg.wanderTurn * dt
    r.vx += Math.cos(r.wanderAng) * cfg.wanderPush * dt * T
    r.vz += Math.sin(r.wanderAng) * cfg.wanderPush * dt * T

    // Contención suave: al acercarse al borde, vuelve hacia el centro.
    const m = Math.hypot(r.x, r.z)
    if (m > cfg.bound) {
      const push = (m - cfg.bound) * 6
      r.vx -= (r.x / m) * push * dt
      r.vz -= (r.z / m) * push * dt
    }

    // Rozamiento y tope de velocidad.
    const drag = Math.pow(cfg.drag, dt * 60)
    r.vx *= drag; r.vz *= drag
    const sp = Math.hypot(r.vx, r.vz)
    const max = cfg.maxSpeed * r.speedScale
    if (sp > max) { r.vx = (r.vx / sp) * max; r.vz = (r.vz / sp) * max }

    r.x += r.vx * dt
    r.z += r.vz * dt
    if (sp > 1e-4) { r.hx = r.vx / sp; r.hz = r.vz / sp }
  }
  return rs
}
