import { describe, it, expect } from 'vitest'
import { createSynapses, arrive, updateSynapses } from '../src/sim/synapse.js'

function seeded(seed = 1) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

// Mini-red de una sinapsis: terminal cerca de la dendrita post, para que la
// nube alcance el receptor en pocos pasos. `sign` decide glutamato/GABA.
function oneSynapseNet(sign) {
  return {
    neurons: [{ i: 0, x: 0, z: 0 }, { i: 1, x: 0.12, z: 0 }],
    synapses: [{
      pre: 0, post: 1, sign, myelinated: sign > 0,
      axon: [{ x: 0, z: 0 }, { x: 0.02, z: 0 }], length: 0.02, nodes: [],
    }],
  }
}

const CFG = {
  readyMax: 4, reserveMax: 0, releaseProb: 1,
  vesicleMin: 1, vesicleMax: 1, quantaPerVesicle: 1,
  refillRate: 2, driftSpeed: 0.5, diffuse: 0.02, arrive: 0.03, spillover: 0.6, weight: 0.3,
}

describe('transmisión sináptica', () => {
  it('con releaseProb 0 nunca libera nada', () => {
    const net = oneSynapseNet(1)
    const cfg = { ...CFG, releaseProb: 0 }
    const st = createSynapses(net, cfg)
    const rand = seeded(1)
    for (let k = 0; k < 50; k++) {
      const r = arrive(st, net, cfg, 0, rand)
      expect(r.released).toBe(false)
    }
    expect(st[0].cloud).toHaveLength(0)
  })

  it('la liberación agota el pool listo (depresión) y luego falla', () => {
    const net = oneSynapseNet(1)
    const st = createSynapses(net, CFG)
    const rand = seeded(2)
    expect(st[0].ready).toBe(CFG.readyMax)
    // readyMax llegadas seguidas vacían el pool listo (sin tiempo para reponer).
    for (let k = 0; k < CFG.readyMax; k++) expect(arrive(st, net, CFG, 0, rand).released).toBe(true)
    expect(st[0].ready).toBe(0)
    // Sin vesículas listas, el siguiente spike llega y no libera: depresión.
    expect(arrive(st, net, CFG, 0, rand).released).toBe(false)
  })

  it('el pool se recupera con el tiempo tras agotarse', () => {
    const net = oneSynapseNet(1)
    const st = createSynapses(net, CFG)
    const rand = seeded(3)
    for (let k = 0; k < CFG.readyMax; k++) arrive(st, net, CFG, 0, rand)
    expect(st[0].ready).toBe(0)
    // Deja correr el tiempo: el reciclaje repone el pool listo.
    for (let k = 0; k < 200; k++) updateSynapses(st, net, CFG, 0.02, rand)
    expect(st[0].ready).toBeGreaterThan(0)
  })

  it('el glutamato entrega peso POSITIVO a la postsináptica', () => {
    const net = oneSynapseNet(1)
    const st = createSynapses(net, CFG)
    const rand = seeded(4)
    arrive(st, net, CFG, 0, rand)
    let got = null
    for (let k = 0; k < 500 && !got; k++) {
      const d = updateSynapses(st, net, CFG, 0.02, rand)
      if (d.length) got = d[0]
    }
    expect(got).not.toBeNull()
    expect(got.post).toBe(1)
    expect(got.weight).toBeGreaterThan(0)
  })

  it('el GABA entrega peso NEGATIVO', () => {
    const net = oneSynapseNet(-1)
    const st = createSynapses(net, CFG)
    const rand = seeded(5)
    arrive(st, net, CFG, 0, rand)
    let got = null
    for (let k = 0; k < 500 && !got; k++) {
      const d = updateSynapses(st, net, CFG, 0.02, rand)
      if (d.length) got = d[0]
    }
    expect(got).not.toBeNull()
    expect(got.weight).toBeLessThan(0)
  })

  it('un astrocito recapta la nube: se vacía sin entregar peso', () => {
    const net = oneSynapseNet(1)
    const st = createSynapses(net, CFG)
    const rand = seeded(6)
    arrive(st, net, CFG, 0, rand)
    expect(st[0].cloud.length).toBeGreaterThan(0)
    // Un pie astrocítico que cubre toda la hendidura: barre todo.
    let deliveries = []
    for (let k = 0; k < 50; k++) deliveries = deliveries.concat(updateSynapses(st, net, CFG, 0.02, rand, () => true))
    expect(st[0].cloud).toHaveLength(0)
    expect(deliveries).toHaveLength(0) // se recaptó antes de llegar al receptor
  })

  it('cada vesícula suelta quantaPerVesicle cuantos', () => {
    const net = oneSynapseNet(1)
    const cfg = { ...CFG, quantaPerVesicle: 5, vesicleMin: 2, vesicleMax: 2 }
    const st = createSynapses(net, cfg)
    const r = arrive(st, net, cfg, 0, seeded(7))
    expect(r.vesicles).toBe(2)
    expect(st[0].cloud).toHaveLength(2 * 5)
  })
})
