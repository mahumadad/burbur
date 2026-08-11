import { describe, it, expect } from 'vitest'
import { createNetwork, outgoing } from '../src/sim/netwire.js'

const CFG = {
  neurons: 12, inhibitory: 2, glia: 6, lambda: 0.5,
  degreeMin: 1, degreeMax: 4, interDegreeMin: 4, interDegreeMax: 6,
  interLocalR: 0.8, spread: 0.9, minSep: 0.24,
  axonPoints: 8, axonBend: 0.25, axonNoise: 0.03, nodes: 5,
}

function seeded(seed = 1) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

describe('cableado de la microred', () => {
  it('coloca las neuronas pedidas, con los últimos slots inhibitorios', () => {
    const net = createNetwork(CFG, seeded(1))
    expect(net.neurons).toHaveLength(CFG.neurons)
    const inters = net.neurons.filter((n) => n.kind === 'inter')
    expect(inters).toHaveLength(CFG.inhibitory)
    // Las interneuronas son los slots ALTOS (coincide con slotClass del registro).
    for (const n of inters) expect(n.i).toBeGreaterThanOrEqual(CFG.neurons - CFG.inhibitory)
    // Piramidal = mielinizada; interneurona = amielínica.
    for (const n of net.neurons) expect(n.myelinated).toBe(n.kind === 'pyramidal')
  })

  it('respeta la separación mínima entre somas', () => {
    const net = createNetwork(CFG, seeded(7))
    for (let i = 0; i < net.neurons.length; i++) {
      for (let j = i + 1; j < net.neurons.length; j++) {
        const a = net.neurons[i], b = net.neurons[j]
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(CFG.minSep - 1e-9)
      }
    }
  })

  it('ninguna sinapsis es un bucle sobre sí misma', () => {
    const net = createNetwork(CFG, seeded(2))
    for (const s of net.synapses) expect(s.pre).not.toBe(s.post)
  })

  it('no repite la misma conexión dirigida dos veces', () => {
    const net = createNetwork(CFG, seeded(3))
    const seen = new Set()
    for (const s of net.synapses) {
      const key = s.pre + '->' + s.post
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it('deja la red conectada: toda neurona tiene entrada y salida', () => {
    const net = createNetwork(CFG, seeded(4))
    const inDeg = net.neurons.map(() => 0)
    const outDeg = net.neurons.map(() => 0)
    for (const s of net.synapses) { inDeg[s.post]++; outDeg[s.pre]++ }
    for (const n of net.neurons) {
      expect(outDeg[n.i]).toBeGreaterThan(0)
      expect(inDeg[n.i]).toBeGreaterThan(0)
    }
  })

  it('el grado de salida cae dentro del rango de su clase', () => {
    const net = createNetwork(CFG, seeded(5))
    const outDeg = net.neurons.map(() => 0)
    for (const s of net.synapses) outDeg[s.pre]++
    for (const n of net.neurons) {
      const hi = n.kind === 'inter' ? CFG.interDegreeMax : CFG.degreeMax
      // El +1 tolera la arista de rescate que garantiza conectividad.
      expect(outDeg[n.i]).toBeLessThanOrEqual(hi + 1)
    }
  })

  it('la conectividad favorece lo cercano sobre lo lejano', () => {
    // Sobre muchas semillas, la distancia media de las sinapsis debe ser menor
    // que la distancia media de TODOS los pares posibles (sesgo por distancia).
    let synSum = 0, synN = 0, allSum = 0, allN = 0
    for (let seed = 1; seed <= 20; seed++) {
      const net = createNetwork(CFG, seeded(seed))
      for (const s of net.synapses) {
        const a = net.neurons[s.pre], b = net.neurons[s.post]
        synSum += Math.hypot(a.x - b.x, a.z - b.z); synN++
      }
      for (let i = 0; i < net.neurons.length; i++) {
        for (let j = i + 1; j < net.neurons.length; j++) {
          const a = net.neurons[i], b = net.neurons[j]
          allSum += Math.hypot(a.x - b.x, a.z - b.z); allN++
        }
      }
    }
    expect(synSum / synN).toBeLessThan(allSum / allN)
  })

  it('cada axón mielinizado trae nodos de Ranvier; los amielínicos no', () => {
    const net = createNetwork(CFG, seeded(6))
    for (const s of net.synapses) {
      if (s.myelinated) {
        expect(s.nodes.length).toBe(CFG.nodes)
        for (const t of s.nodes) { expect(t).toBeGreaterThan(0); expect(t).toBeLessThan(1) }
      } else {
        expect(s.nodes.length).toBe(0)
      }
    }
  })

  it('el axón arranca en el soma pre y termina en el post', () => {
    const net = createNetwork(CFG, seeded(8))
    for (const s of net.synapses) {
      const pre = net.neurons[s.pre], post = net.neurons[s.post]
      const a = s.axon[0], b = s.axon[s.axon.length - 1]
      expect(Math.hypot(a.x - pre.x, a.z - pre.z)).toBeLessThan(1e-6)
      expect(Math.hypot(b.x - post.x, b.z - post.z)).toBeLessThan(1e-6)
      expect(s.length).toBeGreaterThan(0)
    }
  })

  it('la adyacencia continua es simétrica, sin bucles, y une a las interneuronas', () => {
    const net = createNetwork(CFG, seeded(9))
    expect(net.adjacency).toHaveLength(CFG.neurons)
    for (let i = 0; i < net.adjacency.length; i++) {
      expect(net.adjacency[i]).not.toContain(i) // sin bucle
      for (const j of net.adjacency[i]) expect(net.adjacency[j]).toContain(i) // simétrica
    }
    // Las gap junctions unen a todas las interneuronas entre sí.
    const inters = net.neurons.filter((n) => n.kind === 'inter').map((n) => n.i)
    for (const a of inters) for (const b of inters) if (a !== b) expect(net.adjacency[a]).toContain(b)
  })

  it('outgoing devuelve las sinapsis salientes de una neurona', () => {
    const net = createNetwork(CFG, seeded(1))
    const outs = outgoing(net, 0)
    for (const si of outs) expect(net.synapses[si].pre).toBe(0)
    const outDeg0 = net.synapses.filter((s) => s.pre === 0).length
    expect(outs).toHaveLength(outDeg0)
  })
})
