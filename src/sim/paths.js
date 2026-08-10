// Red de senderos: bucles cerrados sobre el disco unitario que los agentes recorren.
// Puro: coordenadas en (x,z) normalizadas a [-1,1]; el render las apoya en el terreno.

import { noise2 } from '../render/noise.js'

/**
 * Genera bucles cerrados y suaves, con radio perturbado por ruido.
 * @returns {{loops: Array<Array<{x:number,z:number}>>}}
 */
export function createPaths(cfg, rand = Math.random) {
  const loops = []
  for (let i = 0; i < cfg.loopCount; i++) {
    const cx = (rand() * 2 - 1) * 0.30
    const cz = (rand() * 2 - 1) * 0.30
    const baseR = cfg.minRadius + rand() * (cfg.maxRadius - cfg.minRadius)
    const seed = rand() * 100
    const wobble = 0.18 + rand() * 0.22
    const pts = []
    for (let k = 0; k < cfg.samples; k++) {
      const a = (k / cfg.samples) * Math.PI * 2
      // Ruido evaluado sobre el círculo → el bucle cierra sin costura.
      const n = noise2(Math.cos(a) * 1.7 + seed, Math.sin(a) * 1.7 + seed)
      const r = baseR * (1 + (n - 0.5) * 2 * wobble)
      let x = cx + Math.cos(a) * r
      let z = cz + Math.sin(a) * r
      // Mantener dentro del disco.
      const m = Math.hypot(x, z)
      if (m > 0.94) { x = (x / m) * 0.94; z = (z / m) * 0.94 }
      pts.push({ x, z })
    }
    loops.push(pts)
  }
  return { loops }
}

/**
 * Punto de camino más cercano a (x,z). Lo usa la atracción a senderos: sirve
 * igual para sendas de bosque que para calles de ciudad.
 */
export function nearestOnPaths(paths, x, z) {
  let bx = 0, bz = 0, best = Infinity
  for (const loop of paths.loops) {
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i]
      const dx = p.x - x, dz = p.z - z
      const d2 = dx * dx + dz * dz
      if (d2 < best) { best = d2; bx = p.x; bz = p.z }
    }
  }
  return { x: bx, z: bz, d2: best }
}

/** Largo acumulado de un bucle (cerrado), para avanzar a velocidad constante. */
function loopLength(pts) {
  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    sum += Math.hypot(b.x - a.x, b.z - a.z)
  }
  return sum
}

export function createWalkers(paths, count, rand = Math.random) {
  const walkers = []
  for (let i = 0; i < count; i++) {
    const li = (rand() * paths.loops.length) | 0
    walkers.push({
      loop: li,
      t: rand(),                       // progreso 0..1 en el bucle
      speed: 0.014 + rand() * 0.018,   // vueltas por segundo
      dir: rand() < 0.5 ? 1 : -1,
      wobblePhase: rand() * 6.2832,
      x: 0, z: 0, hx: 0, hz: 1,        // posición y rumbo
    })
  }
  for (const w of walkers) advance(w, paths, 0)
  return walkers
}

/** Avanza un caminante y actualiza su posición y rumbo. */
function advance(w, paths, dt) {
  const pts = paths.loops[w.loop]
  w.t = (w.t + w.dir * w.speed * dt + 1) % 1
  const f = w.t * pts.length
  const i = Math.floor(f) % pts.length
  const j = (i + 1) % pts.length
  const k = f - Math.floor(f)
  const a = pts[i], b = pts[j]
  const x = a.x + (b.x - a.x) * k
  const z = a.z + (b.z - a.z) * k
  // Bamboleo perpendicular suave: evita que caminen en la línea exacta.
  const off = Math.sin(w.t * 12.566 + w.wobblePhase) * 0.012
  const dx = b.x - a.x, dz = b.z - a.z
  const m = Math.hypot(dx, dz) || 1
  w.hx = (dx / m) * w.dir
  w.hz = (dz / m) * w.dir
  w.x = x + (-dz / m) * off
  w.z = z + (dx / m) * off
}

export function updateWalkers(walkers, paths, dt) {
  for (const w of walkers) advance(w, paths, dt)
  return walkers
}

export { loopLength }
