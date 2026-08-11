import { describe, it, expect } from 'vitest'
import { parseFijos } from '../src/sim/urlFijos.js'

describe('parseFijos', () => {
  it('sin parámetros → objeto vacío', () => {
    expect(parseFijos('')).toEqual({})
    expect(parseFijos('?')).toEqual({})
    expect(parseFijos('?grown')).toEqual({})
  })

  it('lee numéricos y clampa las variables 0..1', () => {
    const f = parseFijos('?tension=2&activity=-1&rain=0.5&fog=0.3')
    expect(f.tension).toBe(1)
    expect(f.activity).toBe(0)
    expect(f.rain).toBe(0.5)
    expect(f.fog).toBe(0.3)
  })

  it('temperatura no se clampa (puede ser bajo cero o alta)', () => {
    expect(parseFijos('?temperature=-8').temperature).toBe(-8)
    expect(parseFijos('?temp=35').temperature).toBe(35)
  })

  it('acepta alias en español', () => {
    const f = parseFijos('?temperatura=-5&actividad=0.9&lluvia=1&niebla=0.2&viento=0.7&estacion=0.6')
    expect(f).toMatchObject({ temperature: -5, activity: 0.9, rain: 1, fog: 0.2, wind: 0.7, season: 0.6 })
  })

  it('weather y phase quedan como string', () => {
    const f = parseFijos('?weather=heavy%20rain&phase=midday')
    expect(f.weather).toBe('heavy rain')
    expect(f.phase).toBe('midday')
  })

  it('viento no baja de 0; valores no numéricos se ignoran', () => {
    expect(parseFijos('?wind=-3').wind).toBe(0)
    expect(parseFijos('?rain=abc')).toEqual({})
  })

  it('snow arma escenario nevado (temperatura bajo cero + lluvia)', () => {
    expect(parseFijos('?snow=1')).toMatchObject({ temperature: -5, rain: 1 })
    expect(parseFijos('?snow')).toMatchObject({ temperature: -5, rain: 1 })
    expect(parseFijos('?snow=0.4')).toMatchObject({ temperature: -5, rain: 0.4 })
  })

  it('los overrides explícitos ganan sobre la conveniencia snow', () => {
    const f = parseFijos('?snow=1&temperature=-12&rain=0.2')
    expect(f.temperature).toBe(-12)
    expect(f.rain).toBe(0.2)
  })
})
