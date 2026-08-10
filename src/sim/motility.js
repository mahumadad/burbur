// Motilidad celular: polarización, quimiotaxis y avance.
// Decide HACIA DÓNDE mira la célula y CUÁNTO avanza; la membrana solo obedece
// (ver `membrane.js`). La célula queda centrada en el origen: el que se desplaza
// es el SUSTRATO, en sentido contrario (`subX`, `subZ`).
// Puro: sin three/DOM. Coordenadas normalizadas.

const TWO_PI = Math.PI * 2

/** Diferencia angular más corta entre dos ángulos, en [-π, π]. */
function angDiff(a, b) {
  let d = (a - b) % TWO_PI
  if (d > Math.PI) d -= TWO_PI
  else if (d < -Math.PI) d += TWO_PI
  return d
}

/**
 * Velocidad de migración: bifásica en la adhesión (modelo motor-clutch).
 * Con poca adhesión la célula protruye pero patina; con demasiada, se ancla.
 * El óptimo está en el medio.
 */
export function migrationSpeed(cfg, protrusion, adhesion) {
  const a = Math.max(0, Math.min(1, adhesion))
  return cfg.maxSpeed * protrusion * 4 * a * (1 - a)
}

/**
 * @param {object} cfg  { turnRate, bias, noise, maxSpeed, protrusionGain, atpFloor }
 */
export function createMotility(cfg, rand = Math.random) {
  return {
    frontAngle: rand() * TWO_PI,
    protrusion: 0,
    blebbing: 0,
    speed: 0,
    subX: 0,   // desplazamiento acumulado del sustrato
    subZ: 0,
  }
}

/**
 * @param {object} input  { source:{x,z}|null, atp:0..1, adhesion:0..1, rounding:0..1 }
 */
export function updateMotility(mot, cfg, dt, rand = Math.random, input = {}) {
  const atp = input.atp ?? 1
  const adhesion = input.adhesion ?? 0.5
  const rounding = input.rounding || 0
  const src = input.source

  // ── Rumbo: paseo aleatorio SESGADO, no persecución directa ──────────────
  // La célula compara concentración entre frente y cola y sesga la probabilidad
  // de mantener el rumbo. Por eso se ve dudar en vez de apuntar.
  let turn = cfg.noise * (rand() - 0.5)
  if (src) {
    const target = Math.atan2(src.z, src.x)
    turn += cfg.bias * Math.sin(angDiff(target, mot.frontAngle))
  }
  // `turn` es la velocidad angular PEDIDA; `turnRate` es el techo real de la
  // célula. La polarización tiene inercia bioquímica: no gira de golpe.
  const maxTurn = cfg.turnRate * dt
  let step = turn * dt
  if (step > maxTurn) step = maxTurn
  else if (step < -maxTurn) step = -maxTurn
  mot.frontAngle = (mot.frontAngle + step + TWO_PI) % TWO_PI

  // ── Modo de motilidad: lamelipodio si alcanza el ATP, si no, blebbing ────
  // Sin energía no se puede polimerizar actina ramificada, pero la presión
  // hidrostática sigue ahí: la célula pasa a ampollarse.
  const fed = Math.max(0, Math.min(1, atp / cfg.atpFloor))
  const wantProtrusion = atp * fed * (1 - rounding)
  const wantBlebbing = (1 - fed) * (1 - rounding)
  const k = 1 - Math.exp(-dt * cfg.protrusionGain)
  mot.protrusion += (wantProtrusion - mot.protrusion) * k
  mot.blebbing += (wantBlebbing - mot.blebbing) * k

  // ── Avance: el sustrato corre hacia atrás bajo una célula centrada ───────
  mot.speed = migrationSpeed(cfg, mot.protrusion, adhesion)
  mot.subX -= Math.cos(mot.frontAngle) * mot.speed * dt
  mot.subZ -= Math.sin(mot.frontAngle) * mot.speed * dt
  return mot
}
