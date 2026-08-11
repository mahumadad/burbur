import { describe, it, expect } from 'vitest'
import { createInvaders, spawnInvader, updateInvaders } from '../src/sim/invaders.js'

const CFG = {
  capacity: 12,
  spawnRadius: 1.4,     // nacen fuera de la célula, en el sustrato
  cullRadius: 2.2,      // si se alejan demasiado, se van del mundo
  bacteriumSpeed: 0.30, // tiene motor: flagelo
  virionSpeed: 0.06,    // no tiene motor: solo choques del medio
  runMin: 0.8, runMax: 1.4,      // carreras de ~1 s
  tumbleMin: 0.08, tumbleMax: 0.14, // volteretas de ~0.1 s
}

function seeded(seed = 1) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

/** Célula de prueba: un disco. El módulo no sabe de membranas, solo pregunta. */
const insideDisc = (r) => (x, z) => Math.hypot(x, z) < r

function run(list, secs, rand, inside = () => false) {
  const dt = 1 / 60
  const events = []
  for (let i = 0; i < secs * 60; i++) {
    events.push(...updateInvaders(list, CFG, dt, rand, inside))
  }
  return events
}

describe('invasores', () => {
  it('nacen fuera de la célula, en el sustrato', () => {
    const list = createInvaders(CFG)
    const inv = spawnInvader(list, CFG, 'bacterium', seeded(1))
    expect(inv).not.toBeNull()
    expect(Math.hypot(inv.x, inv.z)).toBeCloseTo(CFG.spawnRadius, 5)
  })

  it('la capacidad es fija: llena, rechaza', () => {
    const list = createInvaders(CFG)
    const rand = seeded(2)
    for (let i = 0; i < CFG.capacity; i++) {
      expect(spawnInvader(list, CFG, 'virion', rand)).not.toBeNull()
    }
    expect(spawnInvader(list, CFG, 'virion', rand)).toBeNull()
  })

  it('la bacteria alterna carreras rectas con volteretas', () => {
    const list = createInvaders(CFG)
    const b = spawnInvader(list, CFG, 'bacterium', seeded(3))
    const rand = seeded(30)
    const headings = []
    for (let i = 0; i < 60 * 6; i++) {
      updateInvaders(list, CFG, 1 / 60, rand, () => false)
      headings.push(b.ang)
    }
    const distinct = new Set(headings.map((a) => Math.round(a * 50)))
    // Ni un rumbo fijo para siempre, ni un rumbo nuevo cada frame: unas pocas
    // carreras largas separadas por reorientaciones.
    expect(distinct.size).toBeGreaterThan(1)
    expect(distinct.size).toBeLessThan(headings.length * 0.2)
  })

  it('la bacteria avanza más que el virión: una tiene motor y el otro no', () => {
    const bl = createInvaders(CFG)
    const b = spawnInvader(bl, CFG, 'bacterium', seeded(4))
    const vl = createInvaders(CFG)
    const v = spawnInvader(vl, CFG, 'virion', seeded(4))
    const b0 = { x: b.x, z: b.z }, v0 = { x: v.x, z: v.z }
    run(bl, 5, seeded(40))
    run(vl, 5, seeded(40))
    const moved = (o, s) => Math.hypot(o.x - s.x, o.z - s.z)
    expect(moved(b, b0)).toBeGreaterThan(moved(v, v0))
  })

  it('el virión difunde: el desplazamiento crece como un paseo aleatorio', () => {
    // En difusión el desplazamiento cuadrático medio crece ~lineal con el
    // tiempo (×4 en 4× el tiempo). En movimiento dirigido crecería ×16.
    const msd = (secs) => {
      let sum = 0
      const n = 40
      for (let k = 0; k < n; k++) {
        const list = createInvaders(CFG)
        const v = spawnInvader(list, CFG, 'virion', seeded(100 + k))
        const x0 = v.x, z0 = v.z
        run(list, secs, seeded(500 + k))
        sum += (v.x - x0) ** 2 + (v.z - z0) ** 2
      }
      return sum / n
    }
    const ratio = msd(4) / msd(1)
    expect(ratio).toBeGreaterThan(1.8)
    expect(ratio).toBeLessThan(8)
  })

  it('el virión que alcanza la membrana se pega y avisa: infección', () => {
    const list = createInvaders(CFG)
    const v = spawnInvader(list, CFG, 'virion', seeded(6))
    // Se lo coloca YA en contacto. Cuánto tarda en llegar difundiendo es otra
    // propiedad, y la cubre el test de MSD; asertar que un paseo aleatorio
    // derive hacia adentro en una ventana dada sería testear la suerte.
    v.x = 0.45; v.z = 0
    const events = run(list, 1, seeded(60), insideDisc(0.5))
    const infection = events.find((e) => e.type === 'infection')
    expect(infection).toBeDefined()
    expect(infection.kind).toBe('virion')
    expect(v.bound).toBe(true)
  })

  it('el virión pegado deja de difundir', () => {
    const list = createInvaders(CFG)
    const v = spawnInvader(list, CFG, 'virion', seeded(7))
    v.x = 0.4; v.z = 0
    run(list, 2, seeded(70), insideDisc(0.5))
    expect(v.bound).toBe(true)
    const at = { x: v.x, z: v.z }
    run(list, 2, seeded(71), insideDisc(0.5))
    expect(v.x).toBe(at.x)
    expect(v.z).toBe(at.z)
  })

  it('la bacteria NO se pega: es presa, la célula tiene que cazarla', () => {
    const list = createInvaders(CFG)
    const b = spawnInvader(list, CFG, 'bacterium', seeded(8))
    b.x = 0.2; b.z = 0
    const events = run(list, 3, seeded(80), insideDisc(0.5))
    expect(events.some((e) => e.type === 'infection')).toBe(false)
    expect(b.bound).toBe(false)
  })

  it('los que se alejan demasiado se van del mundo y liberan su slot', () => {
    const list = createInvaders(CFG)
    const b = spawnInvader(list, CFG, 'bacterium', seeded(9))
    b.x = CFG.cullRadius + 0.1; b.z = 0
    run(list, 0.1, seeded(90))
    expect(b.alive).toBe(false)
    expect(spawnInvader(list, CFG, 'bacterium', seeded(91))).not.toBeNull()
  })
})
