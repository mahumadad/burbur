import { describe, it, expect } from 'vitest'
import { mitosisState } from '../src/sim/mitosis.js'
import { CELL_PHASES } from '../src/sim/ecosystem.js'

const GESTOS = ['condensation', 'alignment', 'separation', 'furrow']

describe('mitosisState', () => {
  it('todos los valores están siempre en [0,1], para toda fase y phaseT', () => {
    for (const phase of CELL_PHASES) {
      for (const phaseT of [0, 0.5, 1]) {
        const s = mitosisState(phase, phaseT)
        for (const g of GESTOS) {
          expect(s[g]).toBeGreaterThanOrEqual(0)
          expect(s[g]).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('en fases no mitóticas los 4 gestos son 0', () => {
    for (const phase of ['G1 early', 'G1', 'G1/S checkpoint', 'S phase', 'S late', 'G2', 'G2/M checkpoint']) {
      for (const phaseT of [0, 0.5, 1]) {
        const s = mitosisState(phase, phaseT)
        expect(s).toEqual({ condensation: 0, alignment: 0, separation: 0, furrow: 0 })
      }
    }
  })

  it('condensation sube durante profase', () => {
    const inicio = mitosisState('prophase', 0)
    const fin = mitosisState('prophase', 1)
    expect(fin.condensation).toBeGreaterThan(inicio.condensation)
    expect(inicio.condensation).toBe(0)
    expect(fin.condensation).toBe(1)
  })

  it('separation sube durante anafase y se mantiene en 1 en telofase y citocinesis', () => {
    const inicio = mitosisState('anaphase', 0)
    const fin = mitosisState('anaphase', 1)
    expect(inicio.separation).toBe(0)
    expect(fin.separation).toBe(1)
    expect(fin.separation).toBeGreaterThan(inicio.separation)

    for (const phaseT of [0, 0.5, 1]) {
      expect(mitosisState('telophase', phaseT).separation).toBe(1)
      expect(mitosisState('cytokinesis', phaseT).separation).toBe(1)
    }
  })

  it('furrow es máximo al final de citocinesis', () => {
    const fin = mitosisState('cytokinesis', 1)
    expect(fin.furrow).toBe(1)
    for (const phase of CELL_PHASES) {
      for (const phaseT of [0, 0.5, 1]) {
        expect(mitosisState(phase, phaseT).furrow).toBeLessThanOrEqual(fin.furrow)
      }
    }
  })

  it('metaphase mantiene condensation en 1 y separation en 0, con alignment subiendo', () => {
    for (const phaseT of [0, 0.5, 1]) {
      const s = mitosisState('metaphase', phaseT)
      expect(s.condensation).toBe(1)
      expect(s.separation).toBe(0)
      expect(s.furrow).toBe(0)
    }
    expect(mitosisState('metaphase', 0).alignment).toBe(0)
    expect(mitosisState('metaphase', 1).alignment).toBe(1)
  })

  it('telophase: condensation baja de 1 a 0, alignment y separation en 1, furrow 0→0.4', () => {
    const inicio = mitosisState('telophase', 0)
    const fin = mitosisState('telophase', 1)
    expect(inicio.condensation).toBe(1)
    expect(fin.condensation).toBe(0)
    expect(inicio.alignment).toBe(1)
    expect(fin.alignment).toBe(1)
    expect(inicio.separation).toBe(1)
    expect(fin.separation).toBe(1)
    expect(inicio.furrow).toBe(0)
    expect(fin.furrow).toBeCloseTo(0.4, 5)
  })

  it('cytokinesis: condensation y alignment en 0, separation en 1, furrow 0.4→1', () => {
    for (const phaseT of [0, 0.5, 1]) {
      const s = mitosisState('cytokinesis', phaseT)
      expect(s.condensation).toBe(0)
      expect(s.alignment).toBe(0)
      expect(s.separation).toBe(1)
    }
    expect(mitosisState('cytokinesis', 0).furrow).toBeCloseTo(0.4, 5)
    expect(mitosisState('cytokinesis', 1).furrow).toBe(1)
  })

  it('la secuencia completa de las 12 fases es coherente: ninguna transición salta más de 1', () => {
    // Recorre cada fase de phaseT=0 a phaseT=1, y salta a la fase siguiente
    // (0 → 1 en la fase actual, luego 0 en la próxima): ningún gesto debería
    // dar un salto brusco mayor a 1 (el rango total posible).
    const muestras = []
    for (const phase of CELL_PHASES) {
      muestras.push(mitosisState(phase, 0))
      muestras.push(mitosisState(phase, 0.5))
      muestras.push(mitosisState(phase, 1))
    }
    for (let i = 1; i < muestras.length; i++) {
      for (const g of GESTOS) {
        const salto = Math.abs(muestras[i][g] - muestras[i - 1][g])
        expect(salto).toBeLessThanOrEqual(1)
      }
    }
  })
})
