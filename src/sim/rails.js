// Microtúbulos: los rieles del tráfico interno, irradiando desde el centrosoma.
// Tienen inestabilidad dinámica real — crecen despacio, colapsan de golpe
// (catástrofe) y vuelven a crecer (rescate) — así que la red nunca queda quieta.
//
// `nearestOnRails` cumple el MISMO contrato que `nearestOnPaths`, para que
// `updateRoamers` los use sin cambios: con `pathPull` alto los organelos van
// sobre riel (como las calles de la ciudad), no a la deriva.
// Puro: coordenadas (x,z) normalizadas.

/**
 * @param {object} cfg  { count, originX, originZ, minLen, maxLen,
 *                        growRate, shrinkRate, catastrophe, rescue }
 */
export function createRails(cfg, rand = Math.random) {
  const rails = []
  for (let i = 0; i < cfg.count; i++) {
    // Reparto angular con jitter: irradian en todas direcciones sin quedar
    // en una estrella perfectamente regular.
    const ang = ((i + rand() * 0.85) / cfg.count) * Math.PI * 2
    rails.push({
      ang,
      len: cfg.minLen + rand() * (cfg.maxLen - cfg.minLen),
      state: rand() < 0.7 ? 'grow' : 'shrink',
    })
  }
  return { origin: { x: cfg.originX, z: cfg.originZ }, rails }
}

export function updateRails(net, cfg, dt, rand = Math.random) {
  for (const r of net.rails) {
    if (r.state === 'grow') {
      r.len += cfg.growRate * dt
      if (r.len >= cfg.maxLen) { r.len = cfg.maxLen; r.state = 'shrink' }
      else if (rand() < cfg.catastrophe * dt) r.state = 'shrink'
    } else {
      r.len -= cfg.shrinkRate * dt
      // No desaparece del todo: junto al centrosoma siempre queda semilla.
      if (r.len <= cfg.minLen * 0.35) { r.len = cfg.minLen * 0.35; r.state = 'grow' }
      else if (rand() < cfg.rescue * dt) r.state = 'grow'
    }
  }
  return net
}

/**
 * Punto más cercano de la red a (x,z), proyectando sobre cada riel como
 * segmento (centrosoma → punta). Mismo shape que `nearestOnPaths`.
 */
export function nearestOnRails(net, x, z) {
  const ox = net.origin.x, oz = net.origin.z
  const px = x - ox, pz = z - oz
  let bx = ox, bz = oz, best = Infinity
  for (const r of net.rails) {
    const dx = Math.cos(r.ang), dz = Math.sin(r.ang)
    // Proyección sobre el eje del riel, recortada al largo actual.
    let t = px * dx + pz * dz
    if (t < 0) t = 0
    else if (t > r.len) t = r.len
    const cx = ox + dx * t, cz = oz + dz * t
    const ex = cx - x, ez = cz - z
    const d2 = ex * ex + ez * ez
    if (d2 < best) { best = d2; bx = cx; bz = cz }
  }
  return { x: bx, z: bz, d2: best }
}
