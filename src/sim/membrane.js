// Membrana deformable: el contorno de la célula como radios en polar.
// Es el equivalente celular de la "isla" del bosque, pero viva: protruye al
// frente (lamelipodio), se estrecha en la cola, tantea con filopodios, se
// ampolla (blebs) y se redondea en mitosis.
// Puro: sin three/DOM. El radio se expresa en coordenadas normalizadas (~1).

const TWO_PI = Math.PI * 2

/** Diferencia angular más corta entre dos ángulos, en [-π, π]. */
function angDiff(a, b) {
  let d = (a - b) % TWO_PI
  if (d > Math.PI) d -= TWO_PI
  else if (d < -Math.PI) d += TWO_PI
  return d
}

/** Lóbulo suave de anchura `w` centrado en 0. */
function lobe(d, w) {
  return Math.exp(-(d * d) / (2 * w * w))
}

/** Filopodio: sale, tantea y se reabsorbe (0 → 1 → 0 en su vida). */
function filoEnv(f) {
  return Math.sin(Math.PI * (f.age / f.ttl))
}

/** Ampolla: se infla de golpe y se reabsorbe despacio (asimetría real). */
function blebEnv(b, cfg) {
  if (b.age < cfg.blebRise) return b.age / cfg.blebRise
  return Math.max(0, 1 - (b.age - cfg.blebRise) / cfg.blebFall)
}

/**
 * @param {object} cfg  { verts, baseR, harmonics, harmAmp, harmSpeed,
 *                        protrusionAmp, protrusionWidth, tailPinch,
 *                        filoRate, filoAmp, filoWidth, filoTtl,
 *                        blebRate, blebAmp, blebWidth, blebRise, blebFall,
 *                        relax, rMin?, rMax? }
 */
export function createMembrane(cfg, rand = Math.random) {
  const n = cfg.verts
  const r = new Float32Array(n).fill(cfg.baseR)
  // Armónicos lentos: la forma base nunca es un círculo perfecto y respira.
  const harm = []
  for (let k = 0; k < cfg.harmonics; k++) {
    harm.push({
      k: 2 + k,
      amp: cfg.harmAmp * (0.4 + rand() * 0.6),
      phase: rand() * TWO_PI,
      speed: cfg.harmSpeed * (0.6 + rand() * 0.8),
    })
  }
  return { n, r, harm, filo: [], blebs: [] }
}

/**
 * @param {object} input  { frontAngle, protrusion, blebbing, rounding }
 *                        Lo produce `motility.js`; la membrana solo obedece.
 */
export function updateMembrane(mem, cfg, dt, rand = Math.random, time = 0, input = {}) {
  const front = input.frontAngle || 0
  const prot = input.protrusion || 0
  const bleb = input.blebbing || 0
  const round = input.rounding || 0

  // Filopodios: solo salen donde la célula empuja, y cerca del frente.
  if (prot > 0 && rand() < cfg.filoRate * prot * dt) {
    mem.filo.push({
      ang: front + (rand() - 0.5) * 1.6,
      age: 0,
      ttl: cfg.filoTtl * (0.6 + rand() * 0.8),
    })
  }
  // Ampollas: donde sea, y solo cuando la corteza cede.
  if (bleb > 0 && rand() < cfg.blebRate * bleb * dt) {
    mem.blebs.push({ ang: rand() * TWO_PI, age: 0, ttl: cfg.blebRise + cfg.blebFall })
  }
  for (const f of mem.filo) f.age += dt
  for (const b of mem.blebs) b.age += dt
  mem.filo = mem.filo.filter((f) => f.age < f.ttl)
  mem.blebs = mem.blebs.filter((b) => b.age < b.ttl)

  // La corteza limita cuánto se puede deformar: ni colapsa ni revienta.
  const rMin = cfg.baseR * (cfg.rMin ?? 0.45)
  const rMax = cfg.baseR * (cfg.rMax ?? 1.75)
  // Relajación exponencial hacia la forma objetivo (la membrana tiene inercia).
  const k = 1 - Math.exp(-dt / cfg.relax)
  const step = TWO_PI / mem.n

  for (let i = 0; i < mem.n; i++) {
    const ang = i * step
    let target = cfg.baseR
    for (const h of mem.harm) {
      target += cfg.baseR * h.amp * Math.sin(h.k * ang + h.phase + time * h.speed)
    }
    // Lamelipodio al frente, estrechamiento en la cola.
    target += cfg.protrusionAmp * prot * lobe(angDiff(ang, front), cfg.protrusionWidth)
    target -= cfg.tailPinch * prot * lobe(angDiff(ang, front + Math.PI), cfg.protrusionWidth)
    for (const f of mem.filo) {
      target += cfg.filoAmp * filoEnv(f) * lobe(angDiff(ang, f.ang), cfg.filoWidth)
    }
    for (const b of mem.blebs) {
      target += cfg.blebAmp * blebEnv(b, cfg) * lobe(angDiff(ang, b.ang), cfg.blebWidth)
    }
    // Redondeo mitótico: la célula suelta las adherencias y se hace esfera.
    target += (cfg.baseR - target) * round
    if (target < rMin) target = rMin
    else if (target > rMax) target = rMax

    mem.r[i] += (target - mem.r[i]) * k
  }
  return mem
}

/** Radio del contorno en un ángulo cualquiera (interpola entre vértices). */
export function radiusAt(mem, angle) {
  const t = ((angle % TWO_PI) + TWO_PI) % TWO_PI / TWO_PI * mem.n
  const i = Math.floor(t)
  const f = t - i
  const a = mem.r[i % mem.n]
  const b = mem.r[(i + 1) % mem.n]
  return a + (b - a) * f
}

/** ¿El punto (x,z) está dentro de la célula, con `margin` de holgura al borde? */
export function containsPoint(mem, x, z, margin = 0) {
  return Math.hypot(x, z) < radiusAt(mem, Math.atan2(z, x)) - margin
}
