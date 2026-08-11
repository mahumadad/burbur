// Transmisión sináptica: qué pasa cuando el spike llega al terminal (spec §4.3,
// §4.4). Es la pieza con más estado del mundo — cada sinapsis es un pequeño
// sistema, no un cable.
//
//   1. Llega el spike → entra calcio (el terminal destella, lo maneja el render).
//   2. ¿Libera? La transmisión FALLA, y falla mucho: p≈0.5 real. La mitad de los
//      spikes que llegan no producen nada. No es un bug, es el fenómeno.
//   3. Si libera, salen 1–3 vesículas del pool LISTO → nube de neurotransmisor.
//   4. El pool se agota con disparo sostenido (depresión) y se repone en segundos.
//
// El neurotransmisor DIFUNDE por la hendidura (mismo modelo que el virión de
// invaders.js: paso en dirección independiente del anterior) hasta que:
//   · alcanza el receptor postsináptico → entrega peso de fase (+glut / −GABA),
//   · lo recapta un astrocito cercano → se apaga la sinapsis,
//   · se difunde afuera (spillover) → se pierde.
//
// Puro: coordenadas (x,z) normalizadas, sin three/DOM.

/**
 * Estado por sinapsis (una entrada por `net.synapses[i]`).
 * @param {object} cfg  { readyMax, reserveMax, releaseProb, refillRate,
 *                        vesicleMin, vesicleMax, quantaPerVesicle }
 */
export function createSynapses(net, cfg, rand = Math.random) {
  return net.synapses.map((syn) => ({
    ready: cfg.readyMax,        // vesículas acopladas a la zona activa
    reserve: cfg.reserveMax,    // pool de reserva, más atrás
    recycling: 0,               // vesículas endocitadas, volviendo al pool
    sign: syn.sign,             // +1 glutamato, −1 GABA
    cloud: [],                  // cuantos de neurotransmisor difundiendo
  }))
}

/**
 * Llega un spike a la sinapsis `si`. Decide liberación estocástica y, si
 * libera, suelta vesículas como nube de neurotransmisor en la posición pre.
 * @returns {{ released: boolean, vesicles: number }}
 */
export function arrive(states, net, cfg, si, rand = Math.random) {
  const st = states[si]
  const syn = net.synapses[si]
  // Falla si no hay vesículas listas (depresión) o si el dado dice que no.
  if (st.ready <= 0 || rand() >= cfg.releaseProb) return { released: false, vesicles: 0 }
  const nves = Math.min(st.ready, cfg.vesicleMin + Math.floor(rand() * (cfg.vesicleMax - cfg.vesicleMin + 1)))
  st.ready -= nves
  st.recycling += nves // lo liberado vuelve como reciclaje (endocitosis)
  // La nube nace en el botón terminal (final del axón) y apunta a la dendrita post.
  const pre = syn.axon[syn.axon.length - 1]
  const post = net.neurons[syn.post]
  for (let v = 0; v < nves; v++) {
    for (let q = 0; q < cfg.quantaPerVesicle; q++) {
      st.cloud.push({ x: pre.x, z: pre.z, tx: post.x, tz: post.z })
    }
  }
  return { released: true, vesicles: nves }
}

/**
 * Avanza todas las hendiduras un frame: difunde el neurotransmisor, entrega
 * peso a las postsinápticas, recapta con la glía, repone los pools.
 * @param {(x:number,z:number)=>boolean} recaptured  ¿hay un pie astrocítico acá?
 * @returns {Array<{ post: number, weight: number }>} empujones de fase de este frame
 */
export function updateSynapses(states, net, cfg, dt, rand = Math.random, recaptured = () => false) {
  const deliveries = []
  for (let si = 0; si < states.length; si++) {
    const st = states[si]
    // Reposición: reciclaje → reserva → listo, a `refillRate` por segundo.
    const move = cfg.refillRate * dt
    if (st.recycling > 0) { const m = Math.min(st.recycling, move); st.recycling -= m; st.reserve += m }
    if (st.ready < cfg.readyMax && st.reserve > 0) {
      const m = Math.min(cfg.readyMax - st.ready, st.reserve, move)
      st.ready += m; st.reserve -= m
    }
    // Difusión de la nube.
    const keep = []
    for (const q of st.cloud) {
      // Sesgo suave hacia el receptor + ruido: es difusión, no puntería.
      const dx = q.tx - q.x, dz = q.tz - q.z
      const d = Math.hypot(dx, dz) || 1e-6
      const a = rand() * Math.PI * 2
      q.x += (dx / d) * cfg.driftSpeed * dt + Math.cos(a) * cfg.diffuse * dt
      q.z += (dz / d) * cfg.driftSpeed * dt + Math.sin(a) * cfg.diffuse * dt
      const nd = Math.hypot(q.tx - q.x, q.tz - q.z)
      if (nd <= cfg.arrive) {                       // alcanzó el receptor
        deliveries.push({ post: net.synapses[si].post, weight: st.sign * cfg.weight })
        continue
      }
      if (recaptured(q.x, q.z)) continue            // lo barrió un astrocito
      if (nd > cfg.spillover) continue              // se fue afuera y se pierde
      keep.push(q)
    }
    st.cloud = keep
  }
  return deliveries
}
