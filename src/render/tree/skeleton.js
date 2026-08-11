// Generador de esqueleto, estilo L-system (técnica EZ-Tree adaptada). Devuelve
// DATOS, no geometría: bark.js los convierte en tubos y foliage.js cuelga los
// racimos de las puntas.
//
// Clave del crecimiento acumulativo: cada rama lleva el AÑO en que aparece
// (= su orden de ramificación) y el punto del que brota. El árbol se genera
// ADULTO una sola vez y el shader revela cada rama cuando le toca.

/**
 * @param {object} cfg  { origin, dir, len, radius, depth, gnarl, droop, kids, THREE }
 * @param {() => number} rnd
 */
export function growSkeleton(cfg, rnd) {
  const { THREE } = cfg
  const branches = []
  const tips = []
  const SEG = 4

  // Cola: { start, dir, len, radius, order }. El orden ES el año de aparición.
  const cola = [{
    start: cfg.origin.clone(), dir: cfg.dir.clone(),
    len: cfg.len, radius: cfg.radius, order: 0,
  }]

  while (cola.length) {
    const b = cola.shift()
    const spine = [b.start.clone()]
    const cur = b.start.clone()
    const d = b.dir.clone()

    for (let p = 0; p < SEG; p++) {
      // `gnarl` retuerce, y es inverso al radio: las ramas finas se retuercen más.
      const g = cfg.gnarl * (1 / Math.max(0.2, b.radius))
      d.x += (rnd() - 0.5) * g
      d.z += (rnd() - 0.5) * g
      // `droop`: positivo = las ramas cuelgan; negativo = tiran hacia arriba.
      d.y += (rnd() - 0.5) * g * 0.6 + 0.16 - cfg.droop * (b.order / cfg.depth)
      d.normalize()
      cur.addScaledVector(d, b.len / SEG)
      spine.push(cur.clone())
    }

    const punta = b.order >= cfg.depth
    const rEnd = punta ? 0.03 : b.radius * (0.52 + rnd() * 0.16)
    branches.push({
      spine, r0: b.radius, r1: rEnd, order: b.order,
      year: b.order, base: b.start.clone(),
    })

    if (punta) {
      tips.push({ p: spine[spine.length - 1].clone(), dir: d.clone(), order: b.order, year: b.order })
      // Las ramitas intermedias también cargan follaje, si no la copa queda hueca.
      for (let k = 1; k < spine.length - 1; k++) {
        tips.push({ p: spine[k].clone(), dir: d.clone(), order: b.order, year: b.order })
      }
      continue
    }

    const nKids = cfg.kids[0] + ((rnd() * (cfg.kids[1] - cfg.kids[0] + 1)) | 0)
    for (let i = 0; i < nKids; i++) {
      const v = d.clone()
      const up = Math.abs(v.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
      const bx = new THREE.Vector3().crossVectors(v, up).normalize()
      const by = new THREE.Vector3().crossVectors(v, bx)
      const az = rnd() * 6.2832
      const abrir = 0.35 + rnd() * 0.65
      const w = bx.multiplyScalar(Math.cos(az)).addScaledVector(by, Math.sin(az))
      v.multiplyScalar(Math.cos(abrir)).addScaledVector(w, Math.sin(abrir)).normalize()
      const desde = i === 0 ? spine[spine.length - 1]
        : spine[1 + ((rnd() * (spine.length - 1)) | 0)]
      cola.push({
        start: desde.clone(), dir: v, len: b.len * (0.6 + rnd() * 0.22),
        radius: rEnd * (0.85 + rnd() * 0.2), order: b.order + 1,
      })
    }
  }

  return { branches, tips }
}
