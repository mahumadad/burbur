import { describe, it, expect } from 'vitest'
import { phenology, DEFAULT_CURVE, ss01 } from '../src/sim/phenology.js'
import { SPECIES } from '../src/render/tree/species.js'

// Instantes representativos del año (ver i18n.js: primavera 0-0.2, verano
// 0.2-0.5, otoño 0.5-0.78, invierno 0.78-1).
const PRIMAVERA = 0.10
const VERANO = 0.35
const OTONO = 0.62
const INVIERNO = 0.92

const SECO = { rain: 0, wind: 0 }
const LLUVIA = { rain: 1, wind: 0 }
const VIENTO = { rain: 0, wind: 1 }

const en = (seasonT, clima, curve = DEFAULT_CURVE) =>
  phenology({ seasonT, ...clima }, curve)

describe('ss01', () => {
  it('recorta fuera del rango y es monótona dentro', () => {
    expect(ss01(0, 1, -5)).toBe(0)
    expect(ss01(0, 1, 5)).toBe(1)
    expect(ss01(0, 1, 0.25)).toBeLessThan(ss01(0, 1, 0.75))
  })
})

describe('fenología: densidades por estación', () => {
  it('en verano el árbol está con la hoja plena', () => {
    expect(en(VERANO, SECO).leaf).toBeGreaterThan(0.9)
  })

  it('en invierno el árbol está pelado', () => {
    expect(en(INVIERNO, SECO).leaf).toBeLessThan(0.1)
  })

  it('la flor solo aparece en primavera', () => {
    expect(en(PRIMAVERA, SECO).flower).toBeGreaterThan(0.5)
    expect(en(VERANO, SECO).flower).toBeLessThan(0.1)
    expect(en(OTONO, SECO).flower).toBeLessThan(0.1)
    expect(en(INVIERNO, SECO).flower).toBeLessThan(0.1)
  })

  it('el brote precede a la hoja plena', () => {
    // A la salida del invierno ya hay brote, pero todavía no hoja plena.
    const brotando = en(0.95, SECO)
    expect(brotando.bud).toBeGreaterThan(0)
    expect(brotando.leaf).toBeLessThan(brotando.bud + 0.001)
    expect(en(VERANO, SECO).bud).toBeGreaterThan(0.9)
  })

  it('el otoño vira el color de la hoja y nada más lo hace', () => {
    expect(en(OTONO, SECO).autumn).toBeGreaterThan(0.5)
    expect(en(VERANO, SECO).autumn).toBeLessThan(0.1)
    expect(en(PRIMAVERA, SECO).autumn).toBeLessThan(0.1)
  })

  it('el fruto sigue a la flor, y solo en las especies que fructifican', () => {
    const manzano = SPECIES.manzano.curve
    const flor = phenology({ seasonT: PRIMAVERA, ...SECO }, manzano)
    const fruta = phenology({ seasonT: 0.45, ...SECO }, manzano)
    expect(flor.flower).toBeGreaterThan(0.5)
    expect(flor.fruit).toBeLessThan(0.1)
    expect(fruta.fruit).toBeGreaterThan(0.5)
    // El abedul no fructifica nunca.
    for (const t of [PRIMAVERA, VERANO, OTONO, INVIERNO]) {
      expect(phenology({ seasonT: t, ...SECO }, SPECIES.abedul.curve).fruit).toBe(0)
    }
  })
})

describe('fenología: reglas de desprendimiento pedidas', () => {
  it('en otoño caen hojas AUNQUE NO llueva', () => {
    expect(en(OTONO, SECO).shed).toBeGreaterThan(0)
  })

  it('en verano con lluvia caen algunas, pero MENOS que en otoño seco', () => {
    const veranoLluvia = en(VERANO, LLUVIA).shed
    expect(veranoLluvia).toBeGreaterThan(0)
    expect(veranoLluvia).toBeLessThan(en(OTONO, SECO).shed)
  })

  it('el viento aumenta la caída', () => {
    expect(en(VERANO, VIENTO).shed).toBeGreaterThan(en(VERANO, SECO).shed)
  })

  it('un árbol pelado no suelta nada por más que llueva', () => {
    expect(en(INVIERNO, LLUVIA).shed).toBeLessThan(0.5)
  })

  it('la lluvia y el viento aceleran la caída de pétalos', () => {
    const base = en(PRIMAVERA, SECO).petals
    expect(base).toBeGreaterThan(0)
    expect(en(PRIMAVERA, LLUVIA).petals).toBeGreaterThan(base)
    expect(en(PRIMAVERA, VIENTO).petals).toBeGreaterThan(base)
  })
})

describe('fenología: el prado', () => {
  it('la lluvia fuerte cierra las flores del prado', () => {
    expect(en(VERANO, SECO).meadow).toBeGreaterThan(0.9)
    expect(en(VERANO, LLUVIA).meadow).toBeLessThan(0.1)
  })

  it('la llovizna casi no las afecta', () => {
    expect(en(VERANO, { rain: 0.35, wind: 0 }).meadow).toBeGreaterThan(0.9)
  })
})

describe('invariante de las ventanas', () => {
  it('ninguna ventana de ninguna especie cruza budStart', () => {
    for (const [nombre, def] of Object.entries(SPECIES)) {
      const { budStart } = def.curve
      const ventanas = [def.curve.leafFade, def.curve.flower, def.curve.fruit, def.curve.autumn]
      for (const v of ventanas) {
        if (!v) continue
        const rot = v.map((b) => (((b - budStart) % 1) + 1) % 1)
        for (let i = 1; i < rot.length; i++) {
          expect(rot[i], `${nombre}: la ventana ${JSON.stringify(v)} cruza budStart`)
            .toBeGreaterThanOrEqual(rot[i - 1])
        }
      }
    }
  })
})
