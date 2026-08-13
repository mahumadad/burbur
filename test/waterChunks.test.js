import { describe, it, expect } from 'vitest'
import { HASH_NOISE_FBM, GERSTNER, CAUSTIC_FIELD, PROC_NORMAL } from '../src/render/engine/waterChunks.js'

describe('waterChunks', () => {
  it('exporta chunks GLSL no vacíos', () => {
    for (const c of [HASH_NOISE_FBM, GERSTNER, CAUSTIC_FIELD, PROC_NORMAL]) {
      expect(typeof c).toBe('string')
      expect(c.length).toBeGreaterThan(20)
    }
  })

  it('cada chunk declara su firma esperada', () => {
    expect(HASH_NOISE_FBM).toContain('float hash21(')
    expect(HASH_NOISE_FBM).toContain('float fbm(')
    expect(GERSTNER).toContain('vec3 gerstnerWave(')
    expect(CAUSTIC_FIELD).toContain('float caustics(')
    expect(PROC_NORMAL).toContain('vec3 rippleNormal(')
  })

  it('no referencia funciones antes de definirlas dentro de su propio chunk', () => {
    // caustics/rippleNormal usan fbm; el consumidor DEBE anteponer HASH_NOISE_FBM.
    // Acá solo verificamos que no se redefine fbm dentro de esos chunks (evita
    // choque de definición al concatenar).
    expect(CAUSTIC_FIELD).not.toContain('float fbm(')
    expect(PROC_NORMAL).not.toContain('float fbm(')
  })
})
