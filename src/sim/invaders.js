// Invasores: lo que llega desde el sustrato. Son los dos únicos habitantes con
// un movimiento ajeno al resto del mundo, y esa diferencia es a propósito —
// se reconocen por cómo se mueven antes que por su color.
//
//   bacteria → run-and-tumble: carreras rectas de ~1 s cortadas por volteretas
//              de ~0.1 s. Tiene motor (flagelo), así que avanza de verdad.
//   virión   → difusión pura: no tiene motor, solo lo empujan los choques del
//              medio. Al cruzar la membrana se pega y ya no se suelta.
//
// El módulo no sabe qué forma tiene la célula: pregunta con `inside(x,z)`.
// Puro: coordenadas (x,z) normalizadas.

const TWO_PI = Math.PI * 2

export function createInvaders(cfg) {
  const list = []
  for (let i = 0; i < cfg.capacity; i++) {
    list.push({ alive: false, kind: 'virion', x: 0, z: 0, ang: 0, state: 'run', stateT: 0, bound: false })
  }
  return list
}

/** Aparece en el borde del sustrato, mirando hacia la célula. `null` si no hay sitio. */
export function spawnInvader(list, cfg, kind, rand = Math.random) {
  for (const inv of list) {
    if (inv.alive) continue
    const a = rand() * TWO_PI
    inv.alive = true
    inv.kind = kind
    inv.x = Math.cos(a) * cfg.spawnRadius
    inv.z = Math.sin(a) * cfg.spawnRadius
    inv.ang = a + Math.PI // de cara al centro
    inv.state = 'run'
    inv.stateT = cfg.runMin + rand() * (cfg.runMax - cfg.runMin)
    inv.bound = false
    return inv
  }
  return null
}

/**
 * @param {(x:number,z:number)=>boolean} inside  ¿este punto está dentro de la célula?
 * @returns {Array<{type:string,kind:string,x:number,z:number}>}
 */
export function updateInvaders(list, cfg, dt, rand = Math.random, inside = () => false) {
  const events = []
  for (const inv of list) {
    if (!inv.alive || inv.bound) continue

    if (inv.kind === 'bacterium') {
      // Carrera recta / voltereta. La voltereta no avanza: solo reorienta.
      inv.stateT -= dt
      if (inv.stateT <= 0) {
        if (inv.state === 'run') {
          inv.state = 'tumble'
          inv.stateT = cfg.tumbleMin + rand() * (cfg.tumbleMax - cfg.tumbleMin)
        } else {
          inv.state = 'run'
          inv.stateT = cfg.runMin + rand() * (cfg.runMax - cfg.runMin)
          inv.ang = rand() * TWO_PI
        }
      }
      if (inv.state === 'run') {
        inv.x += Math.cos(inv.ang) * cfg.bacteriumSpeed * dt
        inv.z += Math.sin(inv.ang) * cfg.bacteriumSpeed * dt
      }
    } else {
      // Difusión: cada paso en dirección independiente del anterior.
      const a = rand() * TWO_PI
      inv.x += Math.cos(a) * cfg.virionSpeed * dt
      inv.z += Math.sin(a) * cfg.virionSpeed * dt
      // Al cruzar la membrana se une a un receptor y entra.
      if (inside(inv.x, inv.z)) {
        inv.bound = true
        events.push({ type: 'infection', kind: 'virion', x: inv.x, z: inv.z })
        continue
      }
    }

    // Los que se van demasiado lejos dejan el mundo y liberan su sitio.
    if (Math.hypot(inv.x, inv.z) > cfg.cullRadius) inv.alive = false
  }
  return events
}
