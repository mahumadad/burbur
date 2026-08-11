// Boids de peces para el mundo AGUA. Puro: sin three/DOM. Coords x,z en disco
// unidad [-1,1] (el render las escala al radio de laguna); y en unidades de
// mundo entre el lecho y la superficie. Cada pez pertenece a un `school` y solo
// interactúa (alineación/cohesión) con los de su mismo banco; la separación
// actúa entre todos (dos bancos no se atraviesan).

function inDisc(rand, spread) {
  const r = spread * Math.sqrt(rand())
  const a = rand() * Math.PI * 2
  return [Math.cos(a) * r, Math.sin(a) * r]
}

export function createSchools(cfg, rand = Math.random) {
  const fish = []
  for (let s = 0; s < cfg.schools; s++) {
    // Centro inicial del banco (disperso dentro del disco).
    const [cx, cz] = inDisc(rand, cfg.spread * 0.6)
    const cy = cfg.yMin + (cfg.yMax - cfg.yMin) * (0.25 + rand() * 0.5)
    for (let i = 0; i < cfg.perSchool; i++) {
      const [ox, oz] = inDisc(rand, 0.12)
      const x = Math.max(-cfg.spread, Math.min(cfg.spread, cx + ox))
      const z = Math.max(-cfg.spread, Math.min(cfg.spread, cz + oz))
      const y = Math.max(cfg.yMin, Math.min(cfg.yMax, cy + (rand() - 0.5) * 2))
      const a = rand() * Math.PI * 2
      const sp = cfg.maxSpeed * (0.3 + rand() * 0.5)
      fish.push({
        x, z, y,
        vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: (rand() - 0.5) * sp * 0.4,
        school: s,
      })
    }
  }
  return { fish }
}

export function updateSchools(state, cfg, dt, rand = Math.random) {
  const F = state.fish
  const nr2 = cfg.neighborRadius * cfg.neighborRadius
  const sr2 = cfg.sepRadius * cfg.sepRadius
  for (let i = 0; i < F.length; i++) {
    const a = F[i]
    let sx = 0, sz = 0, sy = 0            // separación (todos los bancos)
    let ax = 0, az = 0, ay = 0, an = 0    // alineación (mismo banco)
    let cx = 0, cz = 0, cy = 0, cn = 0    // cohesión (mismo banco)
    for (let j = 0; j < F.length; j++) {
      if (j === i) continue
      const b = F[j]
      // La profundidad pesa menos: los bancos son laminares (más anchos que altos).
      const dx = a.x - b.x, dz = a.z - b.z, dy = (a.y - b.y) * 0.1
      const d2 = dx * dx + dz * dz + dy * dy
      if (d2 < sr2 && d2 > 1e-9) {
        const inv = 1 / Math.sqrt(d2)
        sx += dx * inv; sz += dz * inv; sy += dy * inv
      }
      if (b.school !== a.school) continue
      if (d2 < nr2) {
        ax += b.vx; az += b.vz; ay += b.vy; an++
        cx += b.x; cz += b.z; cy += b.y; cn++
      }
    }
    let fx = sx * cfg.sep, fz = sz * cfg.sep, fy = sy * cfg.sep
    if (an) { fx += (ax / an) * cfg.align; fz += (az / an) * cfg.align; fy += (ay / an) * cfg.align }
    if (cn) {
      fx += (cx / cn - a.x) * cfg.cohesion
      fz += (cz / cn - a.z) * cfg.cohesion
      fy += (cy / cn - a.y) * cfg.cohesion * 0.1
    }
    // Wander suave (menos vertical, para que no suban/bajen a saltos).
    fx += (rand() - 0.5) * cfg.wander
    fz += (rand() - 0.5) * cfg.wander
    fy += (rand() - 0.5) * cfg.wander * 0.3
    // Integración con giro limitado.
    a.vx += fx * cfg.turn * dt
    a.vz += fz * cfg.turn * dt
    a.vy += fy * cfg.turn * dt
    // Clamp de velocidad.
    const sp = Math.hypot(a.vx, a.vz, a.vy)
    if (sp > cfg.maxSpeed) { const k = cfg.maxSpeed / sp; a.vx *= k; a.vz *= k; a.vy *= k }
    // Paso normalizado por-frame (independiente de dt real; el render escala).
    a.x += a.vx * dt * 0.96
    a.z += a.vz * dt * 0.96
    a.y += a.vy * dt * 0.96
    // Límites: curva de vuelta al entrar en la orilla / tocar techo o lecho.
    const rr = Math.hypot(a.x, a.z)
    if (rr > cfg.spread) { const k = cfg.spread / rr; a.x *= k; a.z *= k; a.vx = -a.vx * 0.5; a.vz = -a.vz * 0.5 }
    if (a.y > cfg.yMax) { a.y = cfg.yMax; a.vy = -Math.abs(a.vy) }
    if (a.y < cfg.yMin) { a.y = cfg.yMin; a.vy = Math.abs(a.vy) }
  }
}

export function scatterFish(state, strength = 1, rand = Math.random) {
  for (const f of state.fish) {
    const m = Math.hypot(f.x, f.z) || 1e-3
    const k = (0.5 + rand() * 0.8) * strength * 0.06
    f.vx += (f.x / m) * k + (rand() - 0.5) * k
    f.vz += (f.z / m) * k + (rand() - 0.5) * k
    f.vy += (rand() - 0.5) * k * 0.5
  }
}
