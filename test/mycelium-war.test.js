import { describe, it, expect } from 'vitest'
import { createNetwork, updateNetwork } from '../src/sim/mycelium.js'

function seeded(seed = 1) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

const NO_FIELD = { resourceAt: () => 0, moisture: 0.5 }

// Dos hongos incompatibles no se mezclan: se reconocen ANTES de tocarse (los
// inhibidores difunden), se frenan y dejan una franja de nadie con una barrera
// pigmentada en el medio. Es competencia por interferencia entre dos organismos
// distintos, no un patrón de reacción-difusión: no nace de una inestabilidad en
// un medio homogéneo, sino de dónde se encuentran los dos.
describe('mycelium: la guerra entre colonias', () => {
  const CFGA = {
    maxNodes: 400, maxEdges: 400, maxTips: 30,
    stepLen: 0.02, tipSpeed: 0.25,
    turnRate: 4, noise: 0.6, tropism: 0, autotropism: 0.3, branchRate: 0.6,
    fuseRadius: 0.008,
    widthGain: 0, widthDecay: 0, flowDecay: 0, pruneBelow: 0, pruneRate: 0,
  }

  /** Distancia mínima entre un nodo de una colonia y uno de la otra. */
  function separacion(net) {
    const a = net.nodes.filter((n) => n.alive && n.colony === 1)
    const b = net.nodes.filter((n) => n.alive && n.colony === 2)
    let min = Infinity
    for (const p of a) for (const q of b) min = Math.min(min, Math.hypot(p.x - q.x, p.z - q.z))
    return min
  }

  function corrida(antagonism) {
    const cfg = { ...CFGA, antagonism }
    const net = createNetwork(cfg, [{ x: -0.12, z: 0, colony: 1 }, { x: 0.12, z: 0, colony: 2 }], seeded(90))
    const rand = seeded(91)
    for (let i = 0; i < 700; i++) updateNetwork(net, cfg, 1 / 30, rand, NO_FIELD)
    return net
  }

  it('con antagonismo queda una franja de nadie entre las dos colonias', () => {
    expect(separacion(corrida(3))).toBeGreaterThan(separacion(corrida(0)))
  })

  it('el frente trabado deposita barreras, y jamás hay una arista entre colonias', () => {
    // Encuentro FRONTAL y sin ruido: las dos puntas se buscan. Dejadas al azar
    // apenas se cruzan y la prueba no verificaría nada.
    const cfg = { ...CFGA, antagonism: 3, noise: 0, turnRate: 1, branchRate: 0 }
    const net = createNetwork(cfg, [{ x: -0.12, z: 0, colony: 1 }, { x: 0.12, z: 0, colony: 2 }], seeded(92))
    net.tips[0].ang = 0
    net.tips[1].ang = Math.PI
    const rand = seeded(93)
    let barreras = 0
    for (let i = 0; i < 700; i++) {
      for (const ev of updateNetwork(net, cfg, 1 / 30, rand, NO_FIELD)) {
        if (ev.type !== 'barrier') continue
        barreras++
        expect(ev.colony).not.toBe(ev.otherColony)
        expect(Number.isFinite(ev.x) && Number.isFinite(ev.z)).toBe(true)
      }
    }
    expect(barreras).toBeGreaterThan(0)
    for (const e of net.edges) {
      if (!e.alive) continue
      expect(net.nodes[e.a].colony).toBe(net.nodes[e.b].colony)
    }
  })

  it('el antagonismo no afecta a una colonia sola', () => {
    const cfg = { ...CFGA, antagonism: 3 }
    const solo = createNetwork(cfg, [{ x: 0, z: 0, colony: 1 }], seeded(94))
    const sin = createNetwork({ ...CFGA, antagonism: 0 }, [{ x: 0, z: 0, colony: 1 }], seeded(94))
    for (let i = 0; i < 400; i++) {
      updateNetwork(solo, cfg, 1 / 30, seeded(95 + i), NO_FIELD)
      updateNetwork(sin, { ...CFGA, antagonism: 0 }, 1 / 30, seeded(95 + i), NO_FIELD)
    }
    const vivos = (n) => n.nodes.filter((x) => x.alive).length
    expect(vivos(solo)).toBe(vivos(sin))
  })
})
