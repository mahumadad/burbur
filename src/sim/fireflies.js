const TWO_PI = Math.PI * 2

export function stepPhases(phases, omegas, adjacency, K, dt) {
  const n = phases.length
  const deltas = new Array(n)
  for (let i = 0; i < n; i++) {
    const nb = adjacency[i]
    let coupling = 0
    if (nb.length > 0) {
      let s = 0
      for (let k = 0; k < nb.length; k++) s += Math.sin(phases[nb[k]] - phases[i])
      coupling = (K / nb.length) * s
    }
    deltas[i] = (omegas[i] + coupling) * dt
  }
  const crossed = []
  for (let i = 0; i < n; i++) {
    let p = phases[i] + deltas[i]
    if (p >= TWO_PI) {
      crossed.push(i)
      p -= TWO_PI
      if (p >= TWO_PI) p = p % TWO_PI
    } else if (p < 0) {
      p = ((p % TWO_PI) + TWO_PI) % TWO_PI
    }
    phases[i] = p
  }
  return crossed
}

export function phaseVariance(phases) {
  let sx = 0, sy = 0
  for (let i = 0; i < phases.length; i++) { sx += Math.cos(phases[i]); sy += Math.sin(phases[i]) }
  const n = phases.length || 1
  const R = Math.sqrt(sx * sx + sy * sy) / n
  return 1 - R
}

function rangeRand(rand, half) { return (rand() * 2 - 1) * half }

export function createSwarm(cfg, rand = Math.random) {
  const n = cfg.count
  const pos = new Float32Array(n * 3)
  const vel = new Float32Array(n * 3)
  const phases = new Array(n)
  const omegas = new Array(n)
  const flash = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    pos[i * 3 + 0] = rangeRand(rand, cfg.bounds.x)
    pos[i * 3 + 1] = rangeRand(rand, cfg.bounds.y)
    pos[i * 3 + 2] = rangeRand(rand, cfg.bounds.z)
    vel[i * 3 + 0] = rangeRand(rand, cfg.driftSpeed)
    vel[i * 3 + 1] = rangeRand(rand, cfg.driftSpeed * 0.5)
    vel[i * 3 + 2] = rangeRand(rand, cfg.driftSpeed)
    phases[i] = rand() * TWO_PI
    omegas[i] = cfg.omegaMean * (1 + (rand() * 2 - 1) * cfg.omegaSpread)
  }
  return { count: n, pos, vel, phases, omegas, flash, _rand: rand }
}

function buildAdjacency(pos, n, radius) {
  const r2 = radius * radius
  const adj = new Array(n)
  for (let i = 0; i < n; i++) adj[i] = []
  for (let i = 0; i < n; i++) {
    const ix = pos[i * 3], iy = pos[i * 3 + 1], iz = pos[i * 3 + 2]
    for (let j = i + 1; j < n; j++) {
      const dx = ix - pos[j * 3], dy = iy - pos[j * 3 + 1], dz = iz - pos[j * 3 + 2]
      if (dx * dx + dy * dy + dz * dz <= r2) { adj[i].push(j); adj[j].push(i) }
    }
  }
  return adj
}

export function updateSwarm(swarm, cfg, dt) {
  const { pos, vel, phases, omegas, flash, count: n } = swarm
  // deriva con rebote suave dentro del volumen
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      const k = i * 3 + a
      pos[k] += vel[k] * dt
      const half = a === 0 ? cfg.bounds.x : a === 1 ? cfg.bounds.y : cfg.bounds.z
      if (pos[k] > half) { pos[k] = half; vel[k] = -Math.abs(vel[k]) }
      else if (pos[k] < -half) { pos[k] = -half; vel[k] = Math.abs(vel[k]) }
    }
  }
  const adjacency = buildAdjacency(pos, n, cfg.neighborRadius)
  const crossed = stepPhases(phases, omegas, adjacency, cfg.couplingK, dt)
  // decae brillo
  const decay = Math.exp(-dt / 0.18)
  for (let i = 0; i < n; i++) flash[i] *= decay
  const flashes = []
  for (const i of crossed) {
    flash[i] = 1
    flashes.push({ i, x: pos[i * 3], y: pos[i * 3 + 1], z: pos[i * 3 + 2], intensity: 1 })
  }
  return flashes
}
