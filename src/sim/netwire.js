// Cableado de la microred cortical: dónde está cada soma, si es excitatoria o
// inhibitoria, y quién conecta con quién. Se construye UNA vez al montar el
// mundo y no cambia (la plasticidad queda fuera de alcance).
//
// La topología es DEPENDIENTE DE LA DISTANCIA (spec §4.1): P(i→j) ∝ exp(−d/λ),
// así cada neurona conecta sobre todo con sus vecinas y de vez en cuando tira un
// axón largo. Es lo que produce ondas viajeras sin programarlas.
//
// Además de las sinapsis (dirigidas, químicas, el grueso visible) expone una
// `adjacency` NO dirigida para el término continuo del acoplamiento híbrido
// (§2): las uniones gap, concentradas entre interneuronas. `updateSwarm` la
// consume tal cual si el mundo la escribe en `swarm.adjacency`.
//
// Puro: coordenadas (x,z) normalizadas, sin three/DOM.

/** Muestra `k` índices distintos de `cands` con probabilidad ∝ `weights`. */
function weightedSample(cands, weights, k, rand) {
  const pool = cands.slice()
  const w = weights.slice()
  const out = []
  for (let n = 0; n < k && pool.length > 0; n++) {
    let total = 0
    for (const x of w) total += x
    if (total <= 0) break
    let r = rand() * total
    let idx = 0
    while (idx < w.length - 1 && (r -= w[idx]) > 0) idx++
    out.push(pool[idx])
    pool.splice(idx, 1)
    w.splice(idx, 1)
  }
  return out
}

/** Reparte los somas en el disco con separación mínima (rechazo). */
function placeSomas(cfg, rand) {
  const pts = []
  let guard = 0
  while (pts.length < cfg.neurons && guard++ < cfg.neurons * 200) {
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(rand()) * cfg.spread // uniforme en área
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    let ok = true
    for (const p of pts) {
      if (Math.hypot(p.x - x, p.z - z) < cfg.minSep) { ok = false; break }
    }
    if (ok) pts.push({ x, z })
  }
  // Si la separación fue demasiado exigente y no cupieron todos, rellena sin ella.
  while (pts.length < cfg.neurons) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * cfg.spread
    pts.push({ x: Math.cos(a) * r, z: Math.sin(a) * r })
  }
  return pts
}

/** Polilínea curva de `pre` a `post`: N puntos con pandeo lateral + ruido bajo. */
function buildAxon(pre, post, cfg, rand) {
  const n = cfg.axonPoints
  const dx = post.x - pre.x, dz = post.z - pre.z
  const len = Math.hypot(dx, dz) || 1e-6
  const nx = -dz / len, nz = dx / len // normal unitaria
  const bend = (rand() * 2 - 1) * cfg.axonBend * len
  const pts = []
  for (let s = 0; s <= n; s++) {
    const t = s / n
    const arc = Math.sin(t * Math.PI) // 0 en los extremos, 1 al medio
    const jx = s > 0 && s < n ? (rand() * 2 - 1) * cfg.axonNoise : 0
    const jz = s > 0 && s < n ? (rand() * 2 - 1) * cfg.axonNoise : 0
    pts.push({
      x: pre.x + dx * t + nx * bend * arc + jx,
      z: pre.z + dz * t + nz * bend * arc + jz,
    })
  }
  return pts
}

/** Largo total de una polilínea. */
function polyLength(pts) {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)
  return L
}

/**
 * @param {object} cfg  { neurons, inhibitory, glia, lambda, degreeMin, degreeMax,
 *                        interDegreeMin, interDegreeMax, interLocalR, spread,
 *                        minSep, axonPoints, axonBend, axonNoise, nodes }
 */
export function createNetwork(cfg, rand = Math.random) {
  const somas = placeSomas(cfg, rand)
  // Tipo por slot: las últimas `inhibitory` son interneuronas (coincide con el
  // slotClass del registro: los slots altos son inhibitorios). Piramidal =
  // excitatoria + axón mielinizado; interneurona = inhibitoria + amielínico.
  const neurons = somas.map((p, i) => {
    const inter = i >= cfg.neurons - cfg.inhibitory
    return { i, x: p.x, z: p.z, kind: inter ? 'inter' : 'pyramidal', myelinated: !inter }
  })

  // ── Sinapsis dirigidas, dependientes de la distancia ────────────────────
  const synapses = []
  const outSet = neurons.map(() => new Set()) // destinos ya elegidos por fuente
  const inDeg = neurons.map(() => 0)

  for (const src of neurons) {
    const local = src.kind === 'inter'
    const cands = [], weights = []
    for (const dst of neurons) {
      if (dst.i === src.i) continue
      const d = Math.hypot(dst.x - src.x, dst.z - src.z)
      if (local && d > cfg.interLocalR) continue // las interneuronas solo actúan cerca
      cands.push(dst.i)
      weights.push(Math.exp(-d / cfg.lambda))
    }
    const lo = local ? cfg.interDegreeMin : cfg.degreeMin
    const hi = local ? cfg.interDegreeMax : cfg.degreeMax
    const want = Math.min(cands.length, lo + Math.floor(rand() * (hi - lo + 1)))
    for (const j of weightedSample(cands, weights, want, rand)) {
      outSet[src.i].add(j)
      inDeg[j]++
    }
  }

  // Conectividad garantizada: ninguna neurona sin ENTRADA. Se la da su vecina
  // más cercana que todavía tenga cupo de salida (respeta el grado máximo).
  for (const dst of neurons) {
    if (inDeg[dst.i] > 0) continue
    let best = -1, bestD = Infinity
    for (const src of neurons) {
      if (src.i === dst.i || outSet[src.i].has(dst.i)) continue
      const cap = src.kind === 'inter' ? cfg.interDegreeMax : cfg.degreeMax
      if (outSet[src.i].size >= cap) continue
      const d = Math.hypot(dst.x - src.x, dst.z - src.z)
      if (d < bestD) { bestD = d; best = src.i }
    }
    if (best >= 0) { outSet[best].add(dst.i); inDeg[dst.i]++ }
  }

  for (const src of neurons) {
    for (const j of outSet[src.i]) {
      const post = neurons[j]
      const axon = buildAxon(src, post, cfg, rand)
      const myelinated = src.myelinated
      // Nodos de Ranvier: solo en axones mielinizados, repartidos por el interior.
      const nodes = []
      if (myelinated) for (let k = 1; k <= cfg.nodes; k++) nodes.push(k / (cfg.nodes + 1))
      synapses.push({
        pre: src.i, post: j, kind: src.kind,
        sign: src.kind === 'inter' ? -1 : 1, // GABA inhibe, glutamato excita
        myelinated, axon, length: polyLength(axon), nodes,
      })
    }
  }

  // ── Adyacencia NO dirigida para el acoplamiento continuo (uniones gap) ───
  // El grafo sináptico visto sin dirección + TODOS los pares de interneuronas
  // (las gap junctions viven sobre todo entre ellas). Simétrica, sin bucles.
  const adj = neurons.map(() => new Set())
  for (const s of synapses) { adj[s.pre].add(s.post); adj[s.post].add(s.pre) }
  const inters = neurons.filter((n) => n.kind === 'inter').map((n) => n.i)
  for (const a of inters) for (const b of inters) if (a !== b) adj[a].add(b)
  const adjacency = adj.map((set) => [...set])

  return { neurons, synapses, adjacency }
}

/** Sinapsis salientes de la neurona `i` (para lanzar spikes al disparar). */
export function outgoing(net, i) {
  const out = []
  for (let s = 0; s < net.synapses.length; s++) if (net.synapses[s].pre === i) out.push(s)
  return out
}
