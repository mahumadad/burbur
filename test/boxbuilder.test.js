// test/boxbuilder.test.js
// Puerto fiel de gn (box builder) + finish/_n/vn: verifica invariantes reales
// del acumulador de cajas y sus tres estilos de acabado (lichen/flat/shaded).
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { createBoxBuilder, rgbToHex, shadeGeometry } from '../src/render/boxbuilder.js'

describe('rgbToHex (puerto fiel de vn)', () => {
  it('convierte triples RGB [0,1] a hex 0xRRGGBB', () => {
    expect(rgbToHex([1, 1, 1])).toBe(0xffffff)
    expect(rgbToHex([0, 0, 0])).toBe(0)
    expect(rgbToHex([1, 0.5, 0.2])).toBe((255 << 16) | (Math.round(0.5 * 255) << 8) | Math.round(0.2 * 255))
  })
})

describe('createBoxBuilder (puerto fiel de gn)', () => {
  it('finish(tint, "flat") produce un Group con una Mesh plana del color esperado', () => {
    const b = createBoxBuilder(mulberry(1))
    b.box(2, 2, 2, 0, 0, 0)
    const group = b.finish([1, 0.5, 0.2], 'flat')
    expect(group).toBeInstanceOf(THREE.Group)
    const mesh = group.children[0]
    expect(mesh).toBeInstanceOf(THREE.Mesh)
    expect(mesh.geometry.attributes.position.count).toBeGreaterThan(0)
    expect(mesh.material.color.getHex()).toBe(rgbToHex([1, 0.5, 0.2]))
    expect(mesh.material.side).toBe(THREE.DoubleSide)
  })

  it('finish(tint, "lichen") produce Mesh translúcida + Points de liquen', () => {
    const b = createBoxBuilder(mulberry(2))
    b.box(2, 2, 2, 0, 0, 0)
    const group = b.finish([1, 0.5, 0.2], 'lichen')
    expect(group.children.length).toBe(2)
    const [mesh, points] = group.children
    expect(mesh).toBeInstanceOf(THREE.Mesh)
    expect(mesh.material.transparent).toBe(true)
    expect(mesh.material.opacity).toBe(0.42)
    expect(mesh.material.depthWrite).toBe(false)
    expect(mesh.renderOrder).toBe(-1)

    expect(points).toBeInstanceOf(THREE.Points)
    expect(points.material).toBeInstanceOf(THREE.PointsMaterial)
    expect(points.material.size).toBe(0.15)
    expect(points.frustumCulled).toBe(false)

    const count = points.geometry.attributes.position.count
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(9500)
  })

  it('finish(tint, false) aplica sombreado por vértice (_n) y usa vertexColors', () => {
    const b = createBoxBuilder(mulberry(3))
    b.box(2, 2, 2, 0, 0, 0)
    const group = b.finish([0.5, 0.5, 0.5])
    const mesh = group.children[0]
    expect(mesh.material.vertexColors).toBe(true)
    expect(mesh.geometry.attributes.color).toBeDefined()
    expect(mesh.geometry.attributes.color.count).toBe(mesh.geometry.attributes.position.count)
  })

  it('es determinista: mismo rnd sembrado -> mismo nº de puntos de liquen', () => {
    const b1 = createBoxBuilder(mulberry(42))
    b1.box(3, 4, 3, 0, 0, 0)
    const g1 = b1.finish([1, 0.6, 0.2], 'lichen')

    const b2 = createBoxBuilder(mulberry(42))
    b2.box(3, 4, 3, 0, 0, 0)
    const g2 = b2.finish([1, 0.6, 0.2], 'lichen')

    const c1 = g1.children[1].geometry.attributes.position.count
    const c2 = g2.children[1].geometry.attributes.position.count
    expect(c1).toBe(c2)
  })
})

describe('shadeGeometry (extracción exportada de _n, usada por Tn en city.js)', () => {
  it('pinta color por vértice sobre una geometría THREE cruda (no producida por el box builder)', () => {
    const geo = new THREE.CylinderGeometry(0.7, 0.85, 1.9, 9, 3)
    const out = shadeGeometry(geo, [0.72, 0.74, 0.79], 5)
    expect(out).toBe(geo) // muta y devuelve la misma geometría, igual que _n
    expect(geo.attributes.color).toBeDefined()
    expect(geo.attributes.color.count).toBe(geo.attributes.position.count)
    // Los colores resultantes nunca superan el tinte de entrada (min(1, tint*h)).
    const col = geo.attributes.color
    for (let i = 0; i < col.count; i++) {
      expect(col.getX(i)).toBeLessThanOrEqual(0.72 + 1e-9)
      expect(col.getY(i)).toBeLessThanOrEqual(0.74 + 1e-9)
      expect(col.getZ(i)).toBeLessThanOrEqual(0.79 + 1e-9)
    }
  })
})

// PRNG determinista (mismo estilo que test/cityGrid_real.test.js)
function mulberry(seed) {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
