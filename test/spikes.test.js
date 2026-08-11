import { describe, it, expect } from 'vitest'
import { createSpikes, canFire, fire, updateSpikes, spikePosition } from '../src/sim/spikes.js'
import { createNetwork, outgoing } from '../src/sim/netwire.js'

const NET_CFG = {
  neurons: 12, inhibitory: 2, glia: 6, lambda: 0.5,
  degreeMin: 1, degreeMax: 4, interDegreeMin: 4, interDegreeMax: 6,
  interLocalR: 0.8, spread: 0.9, minSep: 0.24,
  axonPoints: 8, axonBend: 0.25, axonNoise: 0.03, nodes: 5,
}
const CFG = { neurons: 12, myelinatedSpeed: 3.0, unmyelinatedSpeed: 0.6, refractory: 0.12 }

function seeded(seed = 1) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

// Red de dos neuronas conectadas por un axón de largo fijo, para medir tiempos.
function twoNeuronNet(myelinated, length = 1) {
  const axon = [{ x: 0, z: 0 }, { x: length, z: 0 }]
  return {
    neurons: [
      { i: 0, x: 0, z: 0, kind: myelinated ? 'pyramidal' : 'inter', myelinated },
      { i: 1, x: length, z: 0, kind: 'pyramidal', myelinated: true },
    ],
    synapses: [{ pre: 0, post: 1, kind: 'x', sign: 1, myelinated, axon, length, nodes: myelinated ? [0.5] : [] }],
    adjacency: [[1], [0]],
  }
}

describe('propagación del spike', () => {
  it('disparar lanza un spike por cada axón saliente', () => {
    const net = createNetwork(NET_CFG, seeded(1))
    const st = createSpikes(CFG)
    const outs = outgoing(net, 0)
    expect(fire(st, net, CFG, 0, outs)).toBe(true)
    expect(st.active).toHaveLength(outs.length)
  })

  it('el spike llega al terminal tras largo/velocidad segundos', () => {
    const net = twoNeuronNet(true, 1)
    const st = createSpikes(CFG)
    fire(st, net, CFG, 0, [0])
    // Tiempo esperado = length/speed = 1/3 ≈ 0.333 s. Antes de eso, nada.
    let arrivals = []
    let t = 0
    while (t < 0.3) { arrivals = updateSpikes(st, net, CFG, 0.01); t += 0.01 }
    expect(arrivals).toHaveLength(0)
    // Un poco más y llega.
    for (let k = 0; k < 6 && arrivals.length === 0; k++) arrivals = updateSpikes(st, net, CFG, 0.01)
    expect(arrivals).toHaveLength(1)
    expect(arrivals[0].syn).toBe(0)
    expect(st.active).toHaveLength(0) // el spike se consumió al llegar
  })

  it('el axón mielinizado entrega antes que el amielínico del mismo largo', () => {
    function arrivalTime(myelinated) {
      const net = twoNeuronNet(myelinated, 1)
      const st = createSpikes(CFG)
      fire(st, net, CFG, 0, [0])
      let t = 0
      while (t < 20) {
        t += 0.01
        if (updateSpikes(st, net, CFG, 0.01).length) return t
      }
      return Infinity
    }
    expect(arrivalTime(true)).toBeLessThan(arrivalTime(false))
  })

  it('respeta el período refractario: no dispara de nuevo hasta que pasa', () => {
    const net = twoNeuronNet(true, 1)
    const st = createSpikes(CFG)
    expect(fire(st, net, CFG, 0, [0])).toBe(true)
    expect(canFire(st, 0)).toBe(false)
    expect(fire(st, net, CFG, 0, [0])).toBe(false) // en refractario: no dispara
    // Tras `refractory` segundos vuelve a poder.
    for (let k = 0; k < 13; k++) updateSpikes(st, net, CFG, 0.01)
    expect(canFire(st, 0)).toBe(true)
    expect(fire(st, net, CFG, 0, [0])).toBe(true)
  })

  it('marca el nodo de Ranvier que va cruzando', () => {
    const net = twoNeuronNet(true, 1) // nodo en t=0.5
    const st = createSpikes(CFG)
    fire(st, net, CFG, 0, [0])
    updateSpikes(st, net, CFG, 0.01) // t≈0.03 → antes del nodo
    expect(st.active[0].node).toBe(-1)
    for (let k = 0; k < 20; k++) if (st.active.length) updateSpikes(st, net, CFG, 0.01)
    // Ya cruzó t=0.5: el nodo 0 quedó encendido (si aún viaja).
    if (st.active.length) expect(st.active[0].node).toBe(0)
  })

  it('spikePosition interpola sobre la polilínea del axón', () => {
    const net = twoNeuronNet(true, 2) // axón recto de (0,0) a (2,0)
    const st = createSpikes(CFG)
    fire(st, net, CFG, 0, [0])
    st.active[0].t = 0.5
    const p = spikePosition(st.active[0], net)
    expect(p.x).toBeCloseTo(1, 5)
    expect(p.z).toBeCloseTo(0, 5)
  })
})
