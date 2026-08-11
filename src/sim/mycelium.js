// Micelio: un grafo que CRECE. En todos los demás mundos los agentes recorren
// un terreno fijo; acá la punta de la hifa avanza y lo que deja atrás no se
// borra — es la red. La punta es el único agente; el resto (`nodes`, `edges`)
// es estructura inerte que jamás se mueve.
//
// Cinco reglas, todas biología real (ver spec §3):
//   1. Solo crece la punta (extensión apical).
//   2. Dirección = ruido sesgado + tropismo (hacia el recurso) + autotropismo
//      negativo (se aparta de su propia red — así COLONIZA en vez de amontonarse).
//   3. Ramificación: la población de puntas CRECE (el único módulo del repo
//      sin `count` fijo de agentes vivos).
//   4. Anastomosis: misma colonia se funde; distinta colonia rechaza (barrera).
//   5. Refuerzo (los cordones que transportan se engrosan) y poda (lo estéril
//      se reabsorbe). La poda no es optimización: es lo único que evita que
//      el grafo reviente.
//
// Pools de tamaño FIJO con slots libres marcados por `alive` — igual que
// `atp.js` e `invaders.js`. Sin tope, el grafo revienta el navegador.
// Puro: sin three/DOM. Coordenadas (x,z) normalizadas.

const TWO_PI = Math.PI * 2

// Ancho inicial de una arista recién creada. Tiene que quedar POR DEBAJO de
// cualquier `pruneBelow` razonable: si no hay refuerzo (rule 5), la arista
// tiene que ser podable desde el vamos, no nacer ya "gruesa".
const INITIAL_EDGE_WIDTH = 0.01

// Muestras de dirección para el tropismo: la primera es "seguir igual"
// (offset 0) para que un campo de recurso UNIFORME no produzca un sesgo
// artificial por desempate — solo gana una muestra si es ESTRICTAMENTE mejor.
const TROPISM_OFFSETS = [0, -Math.PI / 4, Math.PI / 4, -Math.PI / 2, Math.PI / 2]

/** Envuelve un ángulo a [-π, π]. */
function wrapAngle(a) {
  return a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI)
}

/** Gira `from` hacia `to` sin pasarse de `maxDelta` radianes. */
function turnToward(from, to, maxDelta) {
  if (maxDelta <= 0) return from
  const diff = wrapAngle(to - from)
  if (Math.abs(diff) <= maxDelta) return from + diff
  return from + Math.sign(diff) * maxDelta
}

/** Primer slot libre (`!alive`) de un pool. `-1` si está lleno: el tope duro.
 * Arranca donde terminó la búsqueda anterior: con pools grandes, empezar
 * siempre de cero hace que cada asignación recorra todo lo ya ocupado. */
function allocFree(pool) {
  const start = pool._cursor || 0
  for (let i = 0; i < pool.length; i++) {
    const j = (start + i) % pool.length
    if (!pool[j].alive) { pool._cursor = (j + 1) % pool.length; return j }
  }
  return -1
}

// ── Grilla espacial de nodos ────────────────────────────────────────────────
// Autotropismo y anastomosis preguntan "¿qué nodos tengo cerca?". Recorrer los
// nodos enteros por cada punta es O(puntas × nodos): con la red densa que pide
// el mundo son millones de comparaciones por frame. La grilla las baja a las
// pocas de las 9 celdas vecinas. Los arrays se reusan entre frames (se vacían
// con `length = 0`) para no generar basura cada cuadro.

const GRID_SPAN = 4096   // índice de celda máximo por eje; sobra para [-1,1]

function cellKey(x, z, cell) {
  const ix = Math.floor(x / cell) + GRID_SPAN
  const iz = Math.floor(z / cell) + GRID_SPAN
  return ix * (GRID_SPAN * 2) + iz
}

function rebuildGrid(net, cell) {
  const g = net._grid || (net._grid = { map: new Map(), cell, live: [] })
  g.cell = cell
  for (const arr of g.map.values()) arr.length = 0
  g.live.length = 0
  const { nodes } = net
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (!n.alive) continue
    g.live.push(i)                 // índice de nodos vivos, para el brote lateral
    const key = cellKey(n.x, n.z, cell)
    let arr = g.map.get(key)
    if (!arr) g.map.set(key, (arr = []))
    arr.push(i)
  }
  return g
}

// Scratch reusado: junta los índices de nodo de las 9 celdas alrededor de un
// punto. Con celda = radio de búsqueda, esas 9 celdas cubren el radio entero.
const NEAR = []
const EMPTY = []

function collectNear(g, x, z) {
  NEAR.length = 0
  const cell = g.cell
  const ix = Math.floor(x / cell), iz = Math.floor(z / cell)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const arr = g.map.get((ix + dx + GRID_SPAN) * (GRID_SPAN * 2) + (iz + dz + GRID_SPAN))
      if (!arr) continue
      for (let k = 0; k < arr.length; k++) NEAR.push(arr[k])
    }
  }
  return NEAR
}

/**
 * @param {object} cfg  { maxNodes, maxEdges, maxTips, stepLen, tipSpeed,
 *                         turnRate, noise, tropism, autotropism, branchRate,
 *                         fuseRadius, widthGain, flowDecay, pruneBelow, pruneRate }
 * @param {Array<{x:number,z:number,colony:number}>} seeds  de dónde arranca cada colonia
 */
export function createNetwork(cfg, seeds, rand = Math.random) {
  const nodes = Array.from({ length: cfg.maxNodes }, () => ({ x: 0, z: 0, colony: 0, side: 1, alive: false }))
  const edges = Array.from({ length: cfg.maxEdges }, () => ({ a: 0, b: 0, width: 0, flow: 0, colony: 0, alive: false }))
  const tips = Array.from({ length: cfg.maxTips }, () => ({
    node: -1, ang: 0, colony: 0, vigor: 1, side: 1, alive: false, x: 0, z: 0, dist: 0, age: 0,
  }))

  // Origen (inóculo) de cada colonia: de ahí sale el crecimiento RADIAL, que es
  // lo que da el rosetón de una placa. Sin esto la red era un garabato sin centro.
  const origins = {}
  const net = { nodes, edges, tips, origins }

  for (const seed of seeds) {
    origins[seed.colony] = { x: seed.x, z: seed.z }
    const ni = allocFree(nodes)
    if (ni === -1) continue // tope: no debería pasar con un cfg razonable
    nodes[ni].x = seed.x; nodes[ni].z = seed.z; nodes[ni].colony = seed.colony
    nodes[ni].side = seed.side || 1; nodes[ni].alive = true

    const ti = allocFree(tips)
    if (ti === -1) continue
    const t = tips[ti]
    t.node = ni; t.x = seed.x; t.z = seed.z; t.dist = 0; t.age = 0
    t.ang = rand() * TWO_PI
    t.colony = seed.colony; t.vigor = 1; t.side = seed.side || 1; t.alive = true
  }

  return net
}

/**
 * Avanza la simulación un paso `dt`. Devuelve los eventos del frame:
 * `{type:'fusion', x, z, colony}` o `{type:'barrier', x, z, colony, otherColony}`.
 * @param {object} field  { resourceAt(x,z) → 0..1, moisture }
 */
export function updateNetwork(net, cfg, dt, rand = Math.random, field) {
  const events = []
  const { nodes, edges, tips } = net
  const resourceAt = field && typeof field.resourceAt === 'function' ? field.resourceAt : null
  // `onLog(x,z)` dice si ese punto cae sobre el tronco. Con él la red distingue
  // dos terrenos: la MADERA (donde puede envolver el flanco y seguir por la
  // panza) y la TIERRA (donde se abre en abanico). Sin él todo es madera.
  const onLogAt = field && typeof field.onLog === 'function' ? field.onLog : null
  const soil = cfg.soil || null
  // La celda vale exactamente el radio de "sentir la propia red": así las 9
  // celdas vecinas cubren tanto el autotropismo como la anastomosis.
  const grid = rebuildGrid(net, cfg.fuseRadius * 4)

  for (let i = 0; i < tips.length; i++) {
    const tip = tips[i]
    if (!tip.alive) continue

    // ¿Esta punta está pisando tierra? En tierra crece distinto: más rápido,
    // más ramificada y más radial — el abanico algodonoso que se abre alrededor
    // del tronco cuando la colonia sale de la madera.
    const onSoil = onLogAt ? !onLogAt(tip.x, tip.z) : false
    const mul = onSoil && soil ? soil : null
    const soilSpeed = mul && mul.speed ? mul.speed : 1
    const soilBranch = mul && mul.branch ? mul.branch : 1
    const soilRadial = mul && mul.radial ? mul.radial : 1
    const soilNoise = mul && mul.noise ? mul.noise : 1

    // 1. Dirección: paseo aleatorio sesgado, acotado por turnRate (la punta
    //    no puede reorientarse instantáneamente ni con ruido).
    let ang = tip.ang
    const jitter = (rand() * 2 - 1) * cfg.noise * soilNoise * dt
    const maxJitter = cfg.turnRate * dt
    ang += Math.max(-maxJitter, Math.min(maxJitter, jitter))

    // 2. Tropismo: sesga hacia donde el recurso es mayor entre unas pocas
    //    direcciones candidatas.
    if (cfg.tropism > 0 && resourceAt) {
      let bestAng = ang
      let bestVal = -Infinity
      for (const off of TROPISM_OFFSETS) {
        const a = ang + off
        const val = resourceAt(tip.x + Math.cos(a) * cfg.stepLen, tip.z + Math.sin(a) * cfg.stepLen)
        if (val > bestVal) { bestVal = val; bestAng = a }
      }
      ang = turnToward(ang, bestAng, cfg.turnRate * cfg.tropism * dt)
    }

    // 3. Autotropismo negativo: se aparta de nodos de su PROPIA colonia
    //    cercanos. Es lo que hace que colonice en vez de amontonarse.
    if (cfg.autotropism > 0) {
      let rx = 0, rz = 0
      const R = cfg.fuseRadius * 4 // radio de "sentir" la propia red
      const near = collectNear(grid, tip.x, tip.z)
      for (let k = 0; k < near.length; k++) {
        const n = nodes[near[k]]
        if (!n.alive || n.colony !== tip.colony) continue
        const dx = tip.x - n.x, dz = tip.z - n.z
        const d2 = dx * dx + dz * dz
        if (d2 > 1e-9 && d2 < R * R) {
          const d = Math.sqrt(d2)
          const w = 1 - d / R
          rx += (dx / d) * w
          rz += (dz / d) * w
        }
      }
      if (rx !== 0 || rz !== 0) {
        ang = turnToward(ang, Math.atan2(rz, rx), cfg.turnRate * cfg.autotropism * dt)
      }
    }

    // CRECIMIENTO RADIAL: la punta se orienta hacia afuera desde el inóculo de
    // su colonia. Es lo que hace que la colonia avance como un frente circular
    // —el rosetón de una placa— en vez de enredarse sobre sí misma. Cuanto más
    // lejos del centro, menos hace falta corregir (el frente ya va derecho).
    if (cfg.radial && net.origins) {
      const o = net.origins[tip.colony]
      if (o) {
        const outAng = Math.atan2(tip.z - o.z, tip.x - o.x)
        const d = ((outAng - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI
        ang += d * Math.min(1, cfg.radial * soilRadial * dt)
      }
    }

    // Contención: una colonia no se expande al infinito sobre terreno estéril.
    // Pasado `bound` la punta se reorienta hacia adentro — el equivalente al
    // die-back del borde cuando ya no hay de qué comer. Sin esto el micelio se
    // iba del sustrato y quedaba fuera de cuadro (invisible por el edgeFade).
    if (cfg.bound) {
      const m = Math.hypot(tip.x, tip.z)
      if (m > cfg.bound) {
        const inward = Math.atan2(-tip.z, -tip.x)
        const d = ((inward - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI
        ang += d * Math.min(1, (m - cfg.bound) * 6)
      }
    }

    // 4. Avanza. Solo la punta se mueve — el resto de la red queda quieto.
    const step = cfg.tipSpeed * soilSpeed * dt
    const prevX = tip.x, prevZ = tip.z
    tip.x += Math.cos(ang) * step
    tip.z += Math.sin(ang) * step
    tip.dist += step

    // 4bis. ENVOLVER EL FLANCO. Una punta que llega al borde del tronco puede
    //    seguir de largo a la tierra o doblar sobre el canto y seguir comiendo
    //    por la PANZA. Envolver = deshacer el paso, darse vuelta y cambiar de
    //    lado; el trazo (x,z) sigue siendo el mismo mapa en planta, lo que
    //    cambia es en qué mitad del tronco se apoya.
    if (onLogAt && !onSoil && cfg.wrapChance && !onLogAt(tip.x, tip.z) && rand() < cfg.wrapChance) {
      tip.x = prevX; tip.z = prevZ; tip.dist -= step
      ang = wrapAngle(ang + Math.PI + (rand() * 2 - 1) * 0.5)
      tip.side = -tip.side
    }
    tip.ang = ang

    // 5. Anastomosis: ¿está cerca de un nodo ajeno a su propio último nodo?
    //    (fuseRadius debe ser menor que stepLen: si no, una punta puede
    //    "fusionarse" con su propio rastro recién dejado.)
    let fused = false
    // Una punta recién nacida no se fusiona: arranca PEGADA a la hifa de la que
    // salió, así que sin esta gracia moriría en el acto contra sus propios
    // vecinos — y los brotes laterales no servirían de nada.
    tip.age += step
    const nearFuse = tip.age > cfg.fuseRadius ? collectNear(grid, tip.x, tip.z) : EMPTY
    for (let k = 0; k < nearFuse.length; k++) {
      const ni = nearFuse[k]
      const n = nodes[ni]
      if (!n.alive || ni === tip.node) continue
      // Lados distintos no se tocan: entre el lomo y la panza hay madera. Sin
      // esto una hifa de arriba se fusionaría con una de abajo atravesando el
      // tronco, porque en planta (x,z) las dos caen en el mismo punto.
      if (n.side !== tip.side) continue
      const dx = tip.x - n.x, dz = tip.z - n.z
      if (dx * dx + dz * dz > cfg.fuseRadius * cfg.fuseRadius) continue

      if (n.colony === tip.colony) {
        const ei = allocFree(edges)
        if (ei !== -1) {
          const e = edges[ei]
          e.a = tip.node; e.b = ni; e.width = INITIAL_EDGE_WIDTH; e.flow = 0
          e.colony = tip.colony; e.alive = true
        }
        events.push({ type: 'fusion', x: tip.x, z: tip.z, colony: tip.colony })
      } else {
        events.push({ type: 'barrier', x: tip.x, z: tip.z, colony: tip.colony, otherColony: n.colony })
      }
      tip.alive = false
      fused = true
      break
    }
    if (fused) continue

    // 6. Cada `stepLen` recorrido, deposita un nodo nuevo y la arista que lo une
    //    al anterior. Sin slot libre, la operación simplemente no ocurre.
    if (tip.dist >= cfg.stepLen) {
      tip.dist -= cfg.stepLen
      const nodeIdx = allocFree(nodes)
      if (nodeIdx !== -1) {
        const n = nodes[nodeIdx]
        n.x = tip.x; n.z = tip.z; n.colony = tip.colony; n.side = tip.side; n.alive = true

        const edgeIdx = allocFree(edges)
        if (edgeIdx !== -1) {
          const e = edges[edgeIdx]
          e.a = tip.node; e.b = nodeIdx; e.width = INITIAL_EDGE_WIDTH; e.flow = 0
          e.colony = tip.colony; e.alive = true
        }
        tip.node = nodeIdx
      }
    }

    // 7. Ramificación: nace en el NODO actual (no a mitad de camino), con
    //    ángulo desviado. La población de puntas crece — a diferencia de
    //    todos los otros módulos del repo.
    if (rand() < cfg.branchRate * soilBranch * dt) {
      const ti = allocFree(tips)
      if (ti !== -1) {
        const baseNode = nodes[tip.node]
        const off = (Math.PI / 6 + rand() * Math.PI / 3) * (rand() < 0.5 ? -1 : 1)
        const child = tips[ti]
        child.node = tip.node; child.x = baseNode.x; child.z = baseNode.z; child.dist = 0; child.age = 0
        child.ang = tip.ang + off
        child.colony = tip.colony; child.vigor = tip.vigor; child.side = tip.side; child.alive = true
      }
    }
  }

  // 7bis. BROTE LATERAL. Una hifa no solo crece por la punta: la red madura
  //    saca ramas nuevas del COSTADO de cordones ya hechos. Sin esto, en una red
  //    densa todas las puntas terminan fusionándose, la colonia se queda con
  //    cero frentes vivos y el mundo se congela para siempre — no hay forma de
  //    volver a tener una punta, porque ramificar necesita una punta.
  if (cfg.lateralRate) {
    const want = cfg.lateralRate * dt
    let spawns = Math.floor(want)
    if (rand() < want - spawns) spawns++
    for (let s = 0; s < spawns; s++) {
      const ti = allocFree(tips)
      if (ti === -1) break                    // puntas al tope: ya hay de sobra
      if (grid.live.length === 0) break
      const ni = grid.live[(rand() * grid.live.length) | 0]
      const n = nodes[ni], t = tips[ti]
      t.node = ni; t.x = n.x; t.z = n.z; t.dist = 0; t.age = 0
      t.ang = rand() * TWO_PI
      t.colony = n.colony; t.side = n.side; t.vigor = 1; t.alive = true
    }
  }

  // 8. Refuerzo y poda de aristas. Las que están cerca de recurso ganan
  //    flujo; el flujo engrosa el cordón y decae con el tiempo; lo que
  //    queda por debajo de `pruneBelow` se reabsorbe con probabilidad
  //    `pruneRate` por segundo. No es una optimización: es la biología que
  //    evita que el grafo reviente.
  for (const e of edges) {
    if (!e.alive) continue
    if (resourceAt) {
      const mx = (nodes[e.a].x + nodes[e.b].x) * 0.5
      const mz = (nodes[e.a].z + nodes[e.b].z) * 0.5
      e.flow += resourceAt(mx, mz) * dt
    }
    // El grosor SUBE con el flujo y BAJA sin él: un cordón que deja de
    // transportar se atrofia y se reabsorbe. Sin esta atrofia el grosor solo
    // crecía, nada bajaba nunca de `pruneBelow`, y la red terminaba saturada y
    // congelada — viva en el papel, estática en pantalla.
    e.width += cfg.widthGain * e.flow * dt - (cfg.widthDecay || 0) * dt
    if (e.width < 0) e.width = 0
    e.flow *= Math.max(0, 1 - cfg.flowDecay * dt)

    if (e.width < cfg.pruneBelow && rand() < cfg.pruneRate * dt) e.alive = false
  }

  // 9. Reciclado de NODOS. Sin esto la poda liberaba aristas pero nunca nodos:
  //    el pool saturaba en ~30 s y la red quedaba congelada en extensión — viva
  //    en el papel, estática en pantalla. Un nodo que se quedó sin ninguna arista
  //    viva y sin punta encima ya no es parte del micelio: se reabsorbe y vuelve
  //    al pool. Es la misma biología de la poda, terminada.
  {
    const used = net._nodeUsed || (net._nodeUsed = new Uint8Array(nodes.length))
    used.fill(0)
    for (const e of edges) {
      if (!e.alive) continue
      used[e.a] = 1; used[e.b] = 1
    }
    for (const t of tips) if (t.alive) used[t.node] = 1
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].alive && !used[i]) nodes[i].alive = false
    }
  }

  return events
}

/** Puntas vivas, para dibujar. */
export function tipPositions(net) {
  const out = []
  for (const t of net.tips) if (t.alive) out.push({ x: t.x, z: t.z, colony: t.colony, side: t.side })
  return out
}

/** Censo de la red: totales y desglose por colonia. */
export function networkStats(net) {
  let nodeCount = 0, edgeCount = 0, tipCount = 0, cordLength = 0
  const byColony = {}
  const bucket = (colony) => byColony[colony] || (byColony[colony] = { nodes: 0, edges: 0, tips: 0 })

  for (const n of net.nodes) if (n.alive) { nodeCount++; bucket(n.colony).nodes++ }
  for (const t of net.tips) if (t.alive) { tipCount++; bucket(t.colony).tips++ }
  for (const e of net.edges) {
    if (!e.alive) continue
    edgeCount++
    bucket(e.colony).edges++
    const a = net.nodes[e.a], b = net.nodes[e.b]
    cordLength += Math.hypot(a.x - b.x, a.z - b.z)
  }

  return { nodes: nodeCount, edges: edgeCount, tips: tipCount, cordLength, byColony }
}
