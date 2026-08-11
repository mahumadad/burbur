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

// ─── Lado (lomo/panza) y modo suelo ───────────────────────────────────────
// La red vive sobre un tronco: puede ir por el LOMO o, envolviendo el flanco,
// por la PANZA; y cuando sale a la tierra crece distinto (abanico radial).
describe('mycelium: lado del tronco y modo suelo', () => {
  // Tronco de prueba: un disco de radio 0.3 centrado en el origen.
  const onLog = (x, z) => Math.hypot(x, z) < 0.3

  const STRAIGHT = {
    maxNodes: 200, maxEdges: 200, maxTips: 20,
    stepLen: 0.05, tipSpeed: 0.3,
    turnRate: 0, noise: 0, tropism: 0, autotropism: 0, branchRate: 0,
    fuseRadius: 0.01,
    widthGain: 0, flowDecay: 0, pruneBelow: 0, pruneRate: 0,
  }
  const field = { resourceAt: () => 0, moisture: 0.5, onLog }

  it('nodos y puntas arrancan en el lomo', () => {
    const net = createNetwork(STRAIGHT, [{ x: 0, z: 0, colony: 1 }], seeded(1))
    expect(net.tips[0].side).toBe(1)
    expect(net.nodes[0].side).toBe(1)
  })

  it('con wrapChance 1 la punta envuelve el flanco y sigue por la panza sin salir del tronco', () => {
    const cfg = { ...STRAIGHT, wrapChance: 1 }
    const net = createNetwork(cfg, [{ x: 0, z: 0, colony: 1 }], seeded(2))
    net.tips[0].ang = 0                     // derecho hacia el borde
    const rand = seeded(3)
    for (let i = 0; i < 60; i++) updateNetwork(net, cfg, 1 / 30, rand, field)
    const t = net.tips[0]
    expect(t.alive).toBe(true)
    expect(t.side).toBe(-1)                 // se dio vuelta: ahora va por la panza
    expect(onLog(t.x, t.z)).toBe(true)      // y nunca se fue del tronco
  })

  it('con wrapChance 0 la punta sale a la tierra y no se da vuelta', () => {
    const cfg = { ...STRAIGHT, wrapChance: 0 }
    const net = createNetwork(cfg, [{ x: 0, z: 0, colony: 1 }], seeded(4))
    net.tips[0].ang = 0
    const rand = seeded(5)
    for (let i = 0; i < 60; i++) updateNetwork(net, cfg, 1 / 30, rand, field)
    const t = net.tips[0]
    expect(t.side).toBe(1)
    expect(onLog(t.x, t.z)).toBe(false)     // se fue al suelo
  })

  it('los nodos que deja la punta heredan su lado', () => {
    const cfg = { ...STRAIGHT, wrapChance: 1 }
    const net = createNetwork(cfg, [{ x: 0, z: 0, colony: 1 }], seeded(6))
    net.tips[0].ang = 0
    const rand = seeded(7)
    for (let i = 0; i < 60; i++) updateNetwork(net, cfg, 1 / 30, rand, field)
    const sides = net.nodes.filter((n) => n.alive).map((n) => n.side)
    expect(sides).toContain(1)
    expect(sides).toContain(-1)             // dejó rastro en los dos lados
  })

  it('no hay anastomosis entre lados distintos: la madera está en el medio', () => {
    const cfg = {
      ...STRAIGHT, stepLen: 1, fuseRadius: 0.05, wrapChance: 0,
    }
    const net = createNetwork(cfg, [{ x: -0.1, z: 0, colony: 1 }, { x: 0.1, z: 0, colony: 1 }], seeded(8))
    net.tips[0].ang = 0
    net.tips[1].ang = Math.PI
    net.tips[1].side = -1                   // una va por la panza
    net.nodes[1].side = -1
    const rand = seeded(9)
    let events = []
    for (let i = 0; i < 100; i++) events = events.concat(updateNetwork(net, cfg, 1 / 30, rand, field))
    expect(events.filter((e) => e.type === 'fusion')).toHaveLength(0)
  })

  it('modo suelo: fuera del tronco la punta avanza a su propia velocidad', () => {
    const cfg = { ...STRAIGHT, wrapChance: 0, soil: { speed: 2 } }
    const net = createNetwork(cfg, [{ x: 0.5, z: 0, colony: 1 }], seeded(10))
    net.tips[0].ang = 0
    updateNetwork(net, cfg, 1 / 30, seeded(11), field)
    // Ya arranca en tierra: un paso vale el doble que el del tronco.
    expect(net.tips[0].x - 0.5).toBeCloseTo(2 * cfg.tipSpeed / 30, 6)
  })
})

// La búsqueda de vecinos usa una grilla espacial. Un bug de celda se ve como
// fusiones que no ocurren cuando el encuentro cae justo sobre un borde.
describe('mycelium: vecindad espacial', () => {
  const CFGF = {
    maxNodes: 40, maxEdges: 40, maxTips: 10,
    stepLen: 1, tipSpeed: 0.3,
    turnRate: 0, noise: 0, tropism: 0, autotropism: 0, branchRate: 0,
    fuseRadius: 0.05,
    widthGain: 0, flowDecay: 0, pruneBelow: 0, pruneRate: 0,
  }

  it('fusiona sin importar dónde caiga el encuentro respecto de la grilla', () => {
    for (const off of [0, 0.017, 0.05, 0.113, -0.24, 0.5]) {
      const net = createNetwork(CFGF, [
        { x: off - 0.1, z: off, colony: 1 },
        { x: off + 0.1, z: off, colony: 1 },
      ], seeded(30))
      net.tips[0].ang = 0
      net.tips[1].ang = Math.PI
      const rand = seeded(31)
      let events = []
      for (let i = 0; i < 100; i++) {
        events = events.concat(updateNetwork(net, CFGF, 1 / 30, rand, NO_FIELD))
      }
      expect(events.filter((e) => e.type === 'fusion').length,
        `encuentro en offset ${off}`).toBeGreaterThan(0)
    }
  })

  it('el autotropismo sigue apartando las puntas de su propia red', () => {
    // fuseRadius POR DEBAJO de stepLen: si no, cada punta se fusiona con su
    // propio rastro recién dejado y la colonia muere en el origen.
    const cfg = {
      ...CFGF, stepLen: 0.02, fuseRadius: 0.008, autotropism: 3, turnRate: 4,
      maxNodes: 300, maxEdges: 300, maxTips: 40, branchRate: 0.5,
    }
    const net = createNetwork(cfg, [{ x: 0, z: 0, colony: 1 }], seeded(32))
    const rand = seeded(33)
    for (let i = 0; i < 900; i++) updateNetwork(net, cfg, 1 / 30, rand, NO_FIELD)
    const live = net.nodes.filter((n) => n.alive)
    const spread = Math.max(...live.map((n) => Math.hypot(n.x, n.z)))
    expect(spread).toBeGreaterThan(0.1)   // colonizó, no se amontonó en el origen
  })
})

// Una red densa termina fusionando todas sus puntas: sin brotes laterales la
// colonia se queda sin frentes vivos y el mundo se congela para siempre.
describe('mycelium: brote lateral', () => {
  const CFGL = {
    maxNodes: 400, maxEdges: 400, maxTips: 30,
    stepLen: 0.02, tipSpeed: 0.2,
    turnRate: 3, noise: 1, tropism: 0, autotropism: 0.5, branchRate: 0.4,
    fuseRadius: 0.008,
    widthGain: 0, widthDecay: 0, flowDecay: 0, pruneBelow: 0, pruneRate: 0,
  }

  it('con lateralRate la colonia nunca se queda sin frentes vivos', () => {
    // Pool chico y mucha ramificación: la red se satura y todo se fusiona.
    const cfg = { ...CFGL, fuseRadius: 0.018, branchRate: 3, lateralRate: 6 }
    const net = createNetwork(cfg, [{ x: 0, z: 0, colony: 1 }], seeded(42))
    const rand = seeded(43)
    for (let i = 0; i < 3000; i++) {
      updateNetwork(net, cfg, 1 / 30, rand, NO_FIELD)
      expect(networkStats(net).tips).toBeGreaterThan(0)
    }
  })

  it('el brote lateral hereda colonia y lado del nodo del que sale', () => {
    const cfg = { ...CFGL, lateralRate: 20, maxTips: 30 }
    const net = createNetwork(cfg, [{ x: 0, z: 0, colony: 3, side: -1 }], seeded(44))
    const rand = seeded(45)
    for (let i = 0; i < 200; i++) updateNetwork(net, cfg, 1 / 30, rand, NO_FIELD)
    for (const t of net.tips) {
      if (!t.alive) continue
      expect(t.colony).toBe(3)
      expect(t.side).toBe(-1)
    }
  })
})

// El tronco es un cilindro apoyado: su flanco es una pared. Una hifa no baja
// por ahí — sólo pasa a la tierra donde el tronco la TOCA. Si no, sigue
// bordeando el tronco por abajo.
describe('mycelium: sólo pasa a tierra donde el tronco toca el suelo', () => {
  const onLog = (x, z) => Math.hypot(x, z) < 0.3
  const CFGC = {
    maxNodes: 300, maxEdges: 300, maxTips: 20,
    stepLen: 0.05, tipSpeed: 0.3,
    turnRate: 0, noise: 0, tropism: 0, autotropism: 0, branchRate: 0,
    fuseRadius: 0.01,
    widthGain: 0, flowDecay: 0, pruneBelow: 0, pruneRate: 0,
    wrapChance: 0,                      // aunque pudiera, no dobla por gusto
  }

  it('sin contacto con el suelo la punta NUNCA sale del tronco', () => {
    const field = { resourceAt: () => 0, moisture: 0.5, onLog, canLeave: () => false }
    const net = createNetwork(CFGC, [{ x: 0, z: 0, colony: 1 }], seeded(70))
    net.tips[0].ang = 0
    const rand = seeded(71)
    for (let i = 0; i < 300; i++) {
      updateNetwork(net, CFGC, 1 / 30, rand, field)
      expect(onLog(net.tips[0].x, net.tips[0].z)).toBe(true)
    }
    expect(net.tips[0].side).toBe(-1)   // se dio vuelta: siguió por la panza
  })

  it('donde hay contacto la punta sí pasa a la tierra', () => {
    // Contacto sólo en el semiplano +x.
    const field = { resourceAt: () => 0, moisture: 0.5, onLog, canLeave: (x) => x > 0 }
    const net = createNetwork(CFGC, [{ x: 0, z: 0, colony: 1 }], seeded(72))
    net.tips[0].ang = 0                 // derecho hacia +x
    const rand = seeded(73)
    for (let i = 0; i < 200; i++) updateNetwork(net, CFGC, 1 / 30, rand, field)
    expect(onLog(net.tips[0].x, net.tips[0].z)).toBe(false)
  })

  it('sin canLeave en el field, el comportamiento no cambia', () => {
    const field = { resourceAt: () => 0, moisture: 0.5, onLog }
    const net = createNetwork(CFGC, [{ x: 0, z: 0, colony: 1 }], seeded(74))
    net.tips[0].ang = 0
    const rand = seeded(75)
    for (let i = 0; i < 200; i++) updateNetwork(net, CFGC, 1 / 30, rand, field)
    expect(onLog(net.tips[0].x, net.tips[0].z)).toBe(false)
  })
})
