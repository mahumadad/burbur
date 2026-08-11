import { createPointCloud } from '../../render/engine/points.js'

// M6 — Fagocitosis real: cuándo una bacteria queda atrapada lo decide cell.js
// (spec §9.1: es una decisión del MUNDO, no de sim/invaders.js). Este módulo
// solo se ocupa de lo que pasa DESPUÉS de la captura: nace un fagosoma —un
// punto que viaja desde el lugar de la captura hacia el centro— y al llegar
// se funde con "un lisosoma" (evento de digestión).
//
// Pool FIJO, como el resto de los pools del mundo: con más capturas que
// slots libres, alguna simplemente no deja fagosoma visible.

/**
 * @param {object} p
 * @param {THREE.Scene} p.scene
 * @param {THREE.Material} p.pointMaterial
 * @param {number} p.R  radio de mundo (para pasar de coords normalizadas a mundo)
 * @param {number} p.H  altura de la lámina celular
 * @param {[number,number,number]} p.color  rgb 0..1
 * @param {number} [p.cap]
 * @param {number} [p.ttl]  segundos que tarda en llegar al centro
 */
export function createPhagosomes({ scene, pointMaterial, R, H, color, cap = 4, ttl = 6 }) {
  const cloud = createPointCloud(cap, pointMaterial)
  const slots = Array.from({ length: cap }, () => ({ age: ttl, x0: 0, z0: 0 }))
  for (let i = 0; i < cap; i++) {
    cloud.col[i * 3] = color[0]; cloud.col[i * 3 + 1] = color[1]; cloud.col[i * 3 + 2] = color[2]
  }
  scene.add(cloud.mesh)

  /** Nace en (x,z) normalizados: el punto donde se cerró la fagocitosis. */
  function spawn(x, z) {
    for (const s of slots) {
      if (s.age >= ttl) { s.age = 0; s.x0 = x; s.z0 = z; return }
    }
    // Pool lleno: esta captura, en particular, no deja fagosoma — no pasa nada.
  }

  /** Avanza el pool un frame; devuelve los eventos de digestión de este frame. */
  function update(step) {
    const events = []
    for (let i = 0; i < cap; i++) {
      const s = slots[i]
      if (s.age >= ttl) {
        cloud.pos[i * 3 + 1] = -9999 // aparcado: convención del repo para "muerto"
        cloud.size[i] = 0
        continue
      }
      const before = s.age
      s.age += step
      const u = Math.min(1, s.age / ttl)
      // Arranque rápido, llegada suave: como si lo arrastrara el
      // citoesqueleto hacia el lisosoma más cercano.
      const e = 1 - (1 - u) * (1 - u)
      cloud.pos[i * 3] = s.x0 * (1 - e) * R
      cloud.pos[i * 3 + 1] = H * 0.4
      cloud.pos[i * 3 + 2] = s.z0 * (1 - e) * R
      cloud.size[i] = 0.9
      // Cruzó el TTL justo en este frame: se funde con el lisosoma, una sola vez.
      if (before < ttl && s.age >= ttl) {
        events.push({ type: 'interaction', agent: 'lisosoma', agentType: 'organelle', kind: 'digestion' })
      }
    }
    cloud.commit()
    return events
  }

  return { spawn, update }
}
