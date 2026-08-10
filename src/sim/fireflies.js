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
