// Propagación del potencial de acción: cuando una neurona dispara, sale un spike
// por cada axón saliente y lo recorre. Al llegar al terminal (t≥1) avisa, y la
// sinapsis decide si libera (sim/synapse.js).
//
// Dos velocidades REALES y muy legibles (spec §4.2): el axón mielinizado conduce
// mucho más rápido (conducción saltatoria, salta de nodo en nodo) que el
// amielínico. Aquí eso es solo dos velocidades sobre el mismo `t`, pero como la
// llegada depende de largo/velocidad, un pulso mielinizado llega antes que un
// amielínico del mismo largo — que es el punto.
//
// El período refractario impide que una neurona vuelva a disparar por un rato
// tras hacerlo (spec §4.2): es lo que evita que la convulsión sea infinita.
// Puro: sin three/DOM.

/**
 * @param {object} cfg  { neurons, myelinatedSpeed, unmyelinatedSpeed, refractory }
 */
export function createSpikes(cfg) {
  return {
    active: [],                                   // spikes en vuelo
    refractory: new Float32Array(cfg.neurons),    // s que le queda a cada neurona
  }
}

/** ¿Puede disparar la neurona `i` este frame? (no está en refractario) */
export function canFire(state, i) {
  return state.refractory[i] <= 0
}

/**
 * Dispara la neurona `i`: lanza un spike por cada axón saliente y entra en
 * refractario. `false` si estaba en refractario (no dispara).
 * `outIndices` son las sinapsis salientes (de `outgoing(net, i)`).
 * @returns {boolean}
 */
export function fire(state, net, cfg, i, outIndices) {
  if (state.refractory[i] > 0) return false
  state.refractory[i] = cfg.refractory
  for (const si of outIndices) {
    const syn = net.synapses[si]
    state.active.push({
      syn: si, t: 0,
      speed: syn.myelinated ? cfg.myelinatedSpeed : cfg.unmyelinatedSpeed,
      length: syn.length,
      node: -1, // último nodo de Ranvier "encendido" (para el render del salto)
    })
  }
  return true
}

/**
 * Avanza todos los spikes y el refractario. Devuelve las LLEGADAS de este frame
 * (spikes que alcanzaron el terminal) para que la capa sináptica reaccione.
 * @returns {Array<{ syn: number }>}
 */
export function updateSpikes(state, net, cfg, dt) {
  for (let i = 0; i < state.refractory.length; i++) {
    if (state.refractory[i] > 0) state.refractory[i] = Math.max(0, state.refractory[i] - dt)
  }
  const arrivals = []
  const keep = []
  for (const sp of state.active) {
    // El avance en `t` es velocidad/largo: por eso el largo del axón importa y
    // el mielinizado (más rápido) llega antes sobre el mismo largo.
    sp.t += (sp.speed / sp.length) * dt
    if (sp.t >= 1) { arrivals.push({ syn: sp.syn }); continue }
    // Marca qué nodo de Ranvier acaba de cruzar (el pulso "reaparece" ahí).
    const nodes = net.synapses[sp.syn].nodes
    if (nodes.length) {
      let n = -1
      for (let k = 0; k < nodes.length; k++) if (sp.t >= nodes[k]) n = k
      sp.node = n
    }
    keep.push(sp)
  }
  state.active = keep
  return arrivals
}

/** Posición (x,z) del spike sobre la polilínea de su axón, para dibujarlo. */
export function spikePosition(sp, net) {
  const axon = net.synapses[sp.syn].axon
  const f = Math.max(0, Math.min(1, sp.t)) * (axon.length - 1)
  const i = Math.floor(f)
  const j = Math.min(axon.length - 1, i + 1)
  const u = f - i
  return {
    x: axon[i].x + (axon[j].x - axon[i].x) * u,
    z: axon[i].z + (axon[j].z - axon[i].z) * u,
  }
}
