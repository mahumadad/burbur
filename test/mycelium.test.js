import { describe, it, expect } from 'vitest'
import { createNetwork, updateNetwork, tipPositions, networkStats } from '../src/sim/mycelium.js'

function seeded(seed = 1) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

// Config base: puntas modestas, tope chico a propósito para que los tests
// de "topes" no tarden una eternidad en llenar el pool.
const CFG = {
  maxNodes: 200, maxEdges: 250, maxTips: 40,
  stepLen: 0.02, tipSpeed: 0.15,
  turnRate: 3.0, noise: 1.0,
  tropism: 0.5, autotropism: 0.4,
  branchRate: 0.2,
  fuseRadius: 0.015,   // < stepLen a propósito: ver comentario en mycelium.js
  widthGain: 0.5, flowDecay: 0.8,
  pruneBelow: 0.02, pruneRate: 1.0,
}

const NO_FIELD = { resourceAt: () => 0, moisture: 0.5 }

function finiteNet(net) {
  for (const n of net.nodes) if (n.alive) { if (!Number.isFinite(n.x) || !Number.isFinite(n.z)) return false }
  for (const e of net.edges) if (e.alive) { if (!Number.isFinite(e.width) || !Number.isFinite(e.flow)) return false }
  for (const t of net.tips) if (t.alive) { if (!Number.isFinite(t.x) || !Number.isFinite(t.z) || !Number.isFinite(t.ang)) return false }
  return true
}

describe('mycelium: el grafo que crece', () => {
  it('createNetwork arranca con una punta y un nodo por semilla', () => {
    const seeds = [{ x: -0.5, z: 0, colony: 1 }, { x: 0.5, z: 0.1, colony: 2 }]
    const net = createNetwork(CFG, seeds, seeded(1))
    const stats = networkStats(net)
    expect(stats.nodes).toBe(2)
    expect(stats.tips).toBe(2)
    expect(stats.edges).toBe(0)
    expect(stats.byColony[1].nodes).toBe(1)
    expect(stats.byColony[2].nodes).toBe(1)

    const tips = tipPositions(net)
    expect(tips).toHaveLength(2)
    expect(tips.map((t) => t.colony).sort()).toEqual([1, 2])
  })

  it('las puntas avanzan y con el tiempo aparecen nodos y aristas nuevas', () => {
    const net = createNetwork(CFG, [{ x: 0, z: 0, colony: 1 }], seeded(2))
    const before = networkStats(net)
    const rand = seeded(3)
    for (let i = 0; i < 200; i++) updateNetwork(net, CFG, 1 / 30, rand, NO_FIELD)
    const after = networkStats(net)
    expect(after.nodes).toBeGreaterThan(before.nodes)
    expect(after.edges).toBeGreaterThan(0)
    expect(after.cordLength).toBeGreaterThan(0)
  })

  it('la ramificación aumenta la cantidad de puntas vivas', () => {
    function runTips(branchRate) {
      const cfg = { ...CFG, branchRate }
      const net = createNetwork(cfg, [{ x: 0, z: 0, colony: 1 }], seeded(80))
      const rand = seeded(81)
      const field = { resourceAt: () => 0.5, moisture: 0.5 }
      for (let i = 0; i < 200; i++) updateNetwork(net, cfg, 1 / 20, rand, field)
      return networkStats(net).tips
    }
    const sinRamas = runTips(0)
    const conRamas = runTips(0.5)
    expect(sinRamas).toBe(1) // sin ramificación, la única punta original sigue sola
    expect(conRamas).toBeGreaterThan(sinRamas)
  })

  it('topes duros: nodos/aristas/puntas vivas nunca superan sus máximos', () => {
    const cfg = {
      maxNodes: 60, maxEdges: 60, maxTips: 15,
      stepLen: 0.01, tipSpeed: 0.2,
      turnRate: 3.0, noise: 1.5,
      tropism: 0.4, autotropism: 0.4,
      branchRate: 5.0,     // presión alta a propósito: ramificar todo lo posible
      fuseRadius: 0.005,
      widthGain: 0.3, flowDecay: 0.5,
      pruneBelow: 0,        // nunca poda: máxima presión sobre el tope de aristas
      pruneRate: 0,
    }
    const seeds = [{ x: -0.3, z: 0, colony: 1 }, { x: 0.3, z: 0, colony: 2 }]
    const net = createNetwork(cfg, seeds, seeded(9))
    const rand = seeded(10)
    const field = { resourceAt: (x) => (x > 0 ? 0.8 : 0.2), moisture: 0.5 }
    for (let i = 0; i < 5000; i++) {
      updateNetwork(net, cfg, 1 / 30, rand, field)
      const st = networkStats(net)
      expect(st.nodes).toBeLessThanOrEqual(cfg.maxNodes)
      expect(st.edges).toBeLessThanOrEqual(cfg.maxEdges)
      expect(st.tips).toBeLessThanOrEqual(cfg.maxTips)
    }
  })

  it('sin NaN tras miles de pasos', () => {
    const cfg = { ...CFG, branchRate: 2.0, maxTips: 30, maxNodes: 300, maxEdges: 300 }
    const net = createNetwork(cfg, [{ x: 0, z: 0, colony: 1 }, { x: 0.2, z: -0.2, colony: 2 }], seeded(11))
    const rand = seeded(12)
    const field = { resourceAt: (x, z) => Math.max(0, Math.min(1, 0.5 + x - z)), moisture: 0.4 }
    for (let i = 0; i < 4000; i++) {
      updateNetwork(net, cfg, 1 / 30, rand, field)
      expect(finiteNet(net)).toBe(true)
    }
  })

  it('anastomosis: dos puntas de la MISMA colonia que se cruzan terminan fusionándose', () => {
    const cfg = {
      maxNodes: 20, maxEdges: 20, maxTips: 10,
      stepLen: 1,          // muy largo: no se depositan nodos intermedios en este test
      tipSpeed: 0.3,
      turnRate: 0, noise: 0, tropism: 0, autotropism: 0,
      branchRate: 0,
      fuseRadius: 0.05,
      widthGain: 0, flowDecay: 0, pruneBelow: 0, pruneRate: 0,
    }
    const seeds = [{ x: -0.1, z: 0, colony: 1 }, { x: 0.1, z: 0, colony: 1 }]
    const net = createNetwork(cfg, seeds, seeded(60))
    // Se apuntan directo una a la otra, sin ruido que las desvíe.
    net.tips[0].ang = 0
    net.tips[1].ang = Math.PI

    const rand = seeded(61)
    let allEvents = []
    for (let i = 0; i < 100; i++) {
      const events = updateNetwork(net, cfg, 1 / 30, rand, NO_FIELD)
      allEvents = allEvents.concat(events)
    }
    const fusions = allEvents.filter((e) => e.type === 'fusion')
    expect(fusions.length).toBeGreaterThan(0)

    const stats = networkStats(net)
    expect(stats.tips).toBeLessThan(2)   // al menos una punta murió al fusionarse
    expect(stats.edges).toBeGreaterThan(0) // y dejó una arista de anastomosis
  })

  it('colonias distintas NO se fusionan: se marca barrera y no aparece arista', () => {
    const cfg = {
      maxNodes: 20, maxEdges: 20, maxTips: 10,
      stepLen: 1, tipSpeed: 0.3,
      turnRate: 0, noise: 0, tropism: 0, autotropism: 0,
      branchRate: 0,
      fuseRadius: 0.05,
      widthGain: 0, flowDecay: 0, pruneBelow: 0, pruneRate: 0,
    }
    const seeds = [{ x: -0.1, z: 0, colony: 1 }, { x: 0.1, z: 0, colony: 2 }]
    const net = createNetwork(cfg, seeds, seeded(62))
    net.tips[0].ang = 0
    net.tips[1].ang = Math.PI

    const rand = seeded(63)
    let allEvents = []
    for (let i = 0; i < 100; i++) {
      const events = updateNetwork(net, cfg, 1 / 30, rand, NO_FIELD)
      allEvents = allEvents.concat(events)
    }
    const barriers = allEvents.filter((e) => e.type === 'barrier')
    expect(barriers.length).toBeGreaterThan(0)
    expect(allEvents.some((e) => e.type === 'fusion')).toBe(false)
    expect(networkStats(net).edges).toBe(0)
  })

  it('tropismo: con recurso solo del lado +x, el centro de masa termina desplazado hacia +x', () => {
    const seeds = [{ x: 0, z: 0, colony: 1 }]
    function centroDeMasaX(field) {
      const net = createNetwork(CFG, seeds, seeded(50))
      const rand = seeded(51)
      for (let i = 0; i < 600; i++) updateNetwork(net, CFG, 1 / 20, rand, field)
      let sum = 0, n = 0
      for (const node of net.nodes) if (node.alive) { sum += node.x; n++ }
      return sum / n
    }
    const uniforme = { resourceAt: () => 0.5, moisture: 0.5 }
    const haciaLaDerecha = { resourceAt: (x) => (x > 0 ? 1 : 0), moisture: 0.5 }
    const comUniforme = centroDeMasaX(uniforme)
    const comSesgado = centroDeMasaX(haciaLaDerecha)
    expect(comSesgado).toBeGreaterThan(comUniforme)
  })

  it('poda: con pruneRate alto y sin recurso, la red se reabsorbe (menos aristas que sin poda)', () => {
    function edgesTrasCorrer(pruneRate) {
      const cfg = { ...CFG, pruneRate }
      const net = createNetwork(cfg, [{ x: 0, z: 0, colony: 1 }], seeded(70))
      const rand = seeded(71)
      const sinRecurso = { resourceAt: () => 0, moisture: 0.3 }
      for (let i = 0; i < 400; i++) updateNetwork(net, cfg, 1 / 20, rand, sinRecurso)
      return networkStats(net).edges
    }
    const conPoda = edgesTrasCorrer(5.0)
    const sinPoda = edgesTrasCorrer(0)
    expect(conPoda).toBeLessThan(sinPoda)
  })
})
