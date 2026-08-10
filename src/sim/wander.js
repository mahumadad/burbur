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
 * Campo de flujo sinusoidal que varía lento en el tiempo. Hace que los
 * individuos deriven en corrientes coherentes en vez de puro azar.
 */
function flow(x, z, t, freq, out) {
  const i = t * 0.18
  out.x = Math.sin(z * freq + i) - Math.cos(x * freq * 1.3 - i * 0.8)
  out.z = Math.sin(x * freq * 1.1 + i * 0.9) - Math.cos(z * freq + i * 1.1)
}

const _flow = { x: 0, z: 0 }

/**
 * Todos los individuos deambulan libremente. Si se pasa una red de caminos y
 * `pathPull > 0`, además los atrae — débil en un bosque (los caminos son solo
 * sendas preferidas), fuerte en una ciudad (las calles sí encauzan).
 *
 * @param {object} cfg  { density, wanderTurn, wanderPush, kickMin, kickRange,
 *                        separation, sepRadius, drag, maxSpeed, bound,
 *                        flowFreq, flowPush, pathPull, pathRadius }
 * @param {object|null} paths  red de senderos, o null
 * @param {(paths:object,x:number,z:number)=>{x:number,z:number,d2:number}} nearest
 */
export function updateRoamers(rs, cfg, dt, rand = Math.random, time = 0, paths = null, nearest = null, obstacles = null) {
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

    // Corriente del campo de flujo: deriva compartida y coherente.
    flow(r.x, r.z, time, cfg.flowFreq, _flow)
    r.vx += _flow.x * cfg.flowPush * dt * T
    r.vz += _flow.z * cfg.flowPush * dt * T

    // El ángulo de deambular deriva suavemente → trayectorias curvas, no rectas.
    r.wanderAng += (rand() - 0.5) * cfg.wanderTurn * dt
    r.vx += Math.cos(r.wanderAng) * cfg.wanderPush * dt * T
    r.vz += Math.sin(r.wanderAng) * cfg.wanderPush * dt * T

    // Atracción a los caminos: los encauza sin encadenarlos.
    if (paths && nearest && cfg.pathPull > 0) {
      const np = nearest(paths, r.x, r.z)
      const rad = cfg.pathRadius
      if (np.d2 < rad * rad) {
        const d = Math.sqrt(np.d2)
        if (d > 1e-5) {
          const f = cfg.pathPull * (1 - d / rad) * dt * T
          r.vx += ((np.x - r.x) / d) * f
          r.vz += ((np.z - r.z) / d) * f
          r.onPath = d < rad * 0.35
        }
      } else {
        r.onPath = false
      }
    }

    // Cuenca suave: fuerza hacia el centro que crece desde `softR`. Sin esto,
    // el campo de flujo los arrastra al borde y orbitan el rim.
    const m = Math.hypot(r.x, r.z)
    if (m > cfg.softR) {
      const push = cfg.centerPull * (m - cfg.softR)
      r.vx -= (r.x / m) * push * dt
      r.vz -= (r.z / m) * push * dt
    }
    if (m > cfg.bound) { // tope duro
      r.x = (r.x / m) * cfg.bound
      r.z = (r.z / m) * cfg.bound
      r.vx *= 0.4; r.vz *= 0.4
    }

    // Obstáculos sólidos (árboles): se bordean, no se atraviesan.
    if (obstacles) {
      for (const o of obstacles) {
        const dx = r.x - o.x, dz = r.z - o.z
        const d2 = dx * dx + dz * dz
        if (d2 < o.r * o.r && d2 > 1e-8) {
          const d = Math.sqrt(d2)
          const push = cfg.obstaclePush * (1 - d / o.r)
          r.vx += (dx / d) * push * dt
          r.vz += (dz / d) * push * dt
          // Empujar también la posición para no quedar dentro.
          const overlap = o.r - d
          r.x += (dx / d) * overlap * 0.5
          r.z += (dz / d) * overlap * 0.5
        }
      }
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
