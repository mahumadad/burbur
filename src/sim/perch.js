// Comportamiento de pájaros: posarse en árboles/rocas y cruzar el cielo.
// Puro: opera sobre roamers (coords normalizadas) + puntos de posado {x,z,h}.
// `h` es la altura del posado sobre el suelo (unidades de mundo).

/**
 * Asigna roles a partir de `startIndex` (deja los anteriores como cazadores).
 */
export function createPerchers(n, cfg, rand = Math.random) {
  const agents = []
  for (let i = 0; i < n; i++) {
    agents.push({ role: 'roam', mode: 'roam', timer: 2 + rand() * 6, target: null, yOff: 0 })
  }
  let idx = cfg.startIndex
  for (let k = 0; k < cfg.perchers && idx < n; k++) agents[idx++].role = 'percher'
  for (let k = 0; k < cfg.sky && idx < n; k++) agents[idx++].role = 'sky'
  return agents
}

const lerp = (a, b, t) => a + (b - a) * t

// `shelter` (0..1, p.ej. intensidad de lluvia): cuando es alto, las aves se
// REFUGIAN — las 'sky' dejan de cruzar el cielo y se posan como las 'percher', y
// ninguna abandona el posado. Sin `shelter` (default 0) el comportamiento es el
// original (el bosque/otros mundos no se ven afectados).
export function updatePerchers(agents, roamers, perches, cfg, dt, rand = Math.random, shelter = 0) {
  const sheltering = shelter > 0.5
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i]
    if (a.role === 'roam') { a.yOff = lerp(a.yOff, 0, dt * 2); continue }
    const r = roamers[i]
    a.timer -= dt

    // Con refugio, un ave 'sky' se comporta como 'percher' (baja y se posa).
    const role = (sheltering && a.role === 'sky') ? 'percher' : a.role

    if (role === 'percher') {
      // 'up'/'down' pueden venir de una 'sky' recién convertida por el refugio:
      // se tratan como 'roam' (bajar y buscar posado).
      if (a.mode !== 'toPerch' && a.mode !== 'perched') {
        a.yOff = lerp(a.yOff, 0, dt * 2)
        if ((a.timer <= 0 || sheltering) && perches.length) {
          a.target = perches[(rand() * perches.length) | 0]
          a.mode = 'toPerch'
        }
      } else if (a.mode === 'toPerch') {
        const t = a.target
        r.vx = 0; r.vz = 0 // control directo mientras vuela al posado
        const dx = t.x - r.x, dz = t.z - r.z
        const d = Math.hypot(dx, dz)
        const stepd = cfg.perchSpeed * dt
        if (d <= stepd || d < cfg.perchArrive) {
          r.x = t.x; r.z = t.z
          a.mode = 'perched'; a.timer = cfg.perchMin + rand() * (cfg.perchMax - cfg.perchMin)
        } else {
          r.x += (dx / d) * stepd; r.z += (dz / d) * stepd
        }
        a.yOff = lerp(a.yOff, t.h - 3.1, dt * cfg.riseRate)
      } else { // perched
        const t = a.target
        r.x = t.x; r.z = t.z; r.vx = 0; r.vz = 0
        a.yOff = t.h - 3.1
        // Con refugio no abandona el posado (se queda mientras llueve).
        if (a.timer <= 0 && !sheltering) { a.mode = 'roam'; a.timer = 5 + rand() * 8; a.target = null }
      }
    } else if (a.role === 'sky') {
      if (a.mode === 'roam') {
        a.yOff = lerp(a.yOff, 0, dt * 2)
        if (a.timer <= 0) { a.mode = 'up'; a.timer = 3 + rand() * 3 }
      } else if (a.mode === 'up') {
        a.yOff = lerp(a.yOff, cfg.skyHeight, dt * 1.2)
        if (a.timer <= 0) { a.mode = 'down'; a.timer = 3 }
      } else { // down
        a.yOff = lerp(a.yOff, 0, dt * 1.2)
        if (a.timer <= 0) { a.mode = 'roam'; a.timer = 7 + rand() * 6 }
      }
    }
  }
  return agents
}
