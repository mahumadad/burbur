// Dirección del tráfico interno: la kinesina lleva carga hacia la periferia,
// la dineína hacia el centro. Lo secretor SALE, lo digestivo ENTRA.
// Puro: coordenadas normalizadas (x,z); sin three/DOM.

export const ROLE = { OUT: 1, IN: -1, FREE: 0 }

/** Qué motor lleva a cada organelo. */
export function roleFor(kind) {
  if (kind === 'vesicle' || kind === 'secretory') return ROLE.OUT
  if (kind === 'lysosome' || kind === 'endosome') return ROLE.IN
  return ROLE.FREE
}

// Ancho de la rampa de frenado cerca de los topes: el empuje se anula
// suavemente en esta banda en vez de cortar en seco (evita apelotonamiento).
const RAMP = 0.08

function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/**
 * Sesgo radial suave sobre la velocidad de cada roamer, según su rol.
 * Se SUMA a vx/vz existentes — no reemplaza el deambular.
 *
 * @param {Array<{x:number,z:number,vx:number,vz:number}>} roamers
 * @param {Array<number>} roles  ROLE paralelo a `roamers`
 * @param {{bias:number, innerR:number, outerR:number}} cfg
 * @param {number} dt
 */
export function applyRoleBias(roamers, roles, cfg, dt) {
  for (let i = 0; i < roamers.length; i++) {
    const role = roles[i]
    if (role === ROLE.FREE) continue

    const r = roamers[i]
    const rad = Math.hypot(r.x, r.z)
    if (rad < 1e-6) continue // sin dirección radial definida

    // Rampa: el empuje se anula al llegar a destino, no de golpe.
    const factor = role === ROLE.IN
      ? smoothstep(cfg.innerR, cfg.innerR + RAMP, rad)
      : 1 - smoothstep(cfg.outerR - RAMP, cfg.outerR, rad)
    if (factor <= 0) continue

    const push = role * cfg.bias * dt * factor
    r.vx += (r.x / rad) * push
    r.vz += (r.z / rad) * push
  }
  return roamers
}
