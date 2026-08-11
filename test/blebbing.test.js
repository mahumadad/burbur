// M8 — Blebbing verificado: garantía de que la hipoxia sostenida SÍ dispara
// blebbing, con la calibración real del juego (CONFIG.cell), no una de prueba.
//
// El diagnóstico (script Node en el scratchpad, ver reporte de la sesión)
// mostró que, con la calibración shipeada, atp.budget cruza `atpFloor` en
// menos de 1s bajo la tensión de `hypoxic` y motility.blebbing supera 0.5 en
// pocos segundos — el bleb NO era código muerto. Este test fija esa garantía
// para que una futura recalibración de cc.atp/cc.motility no la rompa en
// silencio.
import { describe, it, expect } from 'vitest'
import { CONFIG } from '../src/config.js'
import { createMotility, updateMotility } from '../src/sim/motility.js'
import { createAtpPool, updateAtp } from '../src/sim/atp.js'
import { CELL_PROFILE } from '../src/sim/ecosystem.js'

const cc = CONFIG.cell
// Rand fijo: el ruido de rand() solo mueve `frontAngle` (irrelevante acá),
// nunca protrusion/blebbing — así el test es determinista sin sembrar un PRNG.
const flatRand = () => 0.5

// Misma fórmula que cell.js:934 → demand = 0.25 + eco.tension*0.8. Usamos la
// tensión BASE del medio hipoxic (CELL_MEDIUM.hypoxic.tension), que ya es una
// cota inferior conservadora: en juego, la tensión sube más por (1-activity).
const hypoxicTension = CELL_PROFILE.weatherData.hypoxic.tension
const demand = 0.25 + hypoxicTension * 0.8

describe('M8 — blebbing bajo hipoxia sostenida (código real, no código muerto)', () => {
  it('con producción de ATP nula y demanda de hipoxia sostenida, el presupuesto cruza atpFloor', () => {
    const atp = createAtpPool(cc.atp)
    const dt = 1 / 60
    let crossed = false
    for (let i = 0; i < 5 * 60; i++) { // 5s sostenidos, sin ninguna mitocondria entregando
      updateAtp(atp, cc.atp, dt, demand)
      if (atp.budget < cc.motility.atpFloor) crossed = true
    }
    expect(crossed).toBe(true)
  })

  it('con producción de ATP nula y demanda de hipoxia sostenida, motility.blebbing > 0.5', () => {
    const atp = createAtpPool(cc.atp)
    const motility = createMotility(cc.motility, flatRand)
    const dt = 1 / 60
    for (let i = 0; i < 10 * 60; i++) { // 10s sostenidos: tiempo de sobra para que el bleb responda
      updateAtp(atp, cc.atp, dt, demand)
      updateMotility(motility, cc.motility, dt, flatRand, {
        source: null, atp: atp.budget, adhesion: 0.5, rounding: 0,
      })
    }
    expect(motility.blebbing).toBeGreaterThan(0.5)
  })

  it('con producción de ATP baja (mitocondrias apagadas parcialmente) el bleb igual se dispara', () => {
    const atp = createAtpPool(cc.atp)
    const motility = createMotility(cc.motility, flatRand)
    const dt = 1 / 60
    let prodClock = 0
    for (let i = 0; i < 20 * 60; i++) { // 20s: una mitocondria entregando cada ~3s, muy por debajo del ritmo normal
      prodClock -= dt
      if (prodClock <= 0) {
        prodClock = 3
        atp.quanta[0].alive = true
        atp.quanta[0].x = 0.3; atp.quanta[0].z = 0.1
        atp.quanta[0].tx = 0.3; atp.quanta[0].tz = 0.1 // nace ya "llegado": entrega inmediata
      }
      updateAtp(atp, cc.atp, dt, demand)
      updateMotility(motility, cc.motility, dt, flatRand, {
        source: null, atp: atp.budget, adhesion: 0.5, rounding: 0,
      })
    }
    expect(motility.blebbing).toBeGreaterThan(0.5)
  })
})
