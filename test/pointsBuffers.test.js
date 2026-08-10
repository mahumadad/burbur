import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { createPointCloud, createLineBuffer } from '../src/render/engine/points.js'

describe('createLineBuffer', () => {
  it('ajusta drawRange al nº de segmentos empujados', () => {
    const buf = createLineBuffer(10, new THREE.LineBasicMaterial())
    buf.begin()
    buf.push(0,0,0, 1,1,1, [1,0,0], [0,1,0])
    buf.push(1,1,1, 2,2,2, [0,0,1], [1,1,0])
    buf.commit()
    expect(buf.mesh.geometry.drawRange.count).toBe(4) // 2 segmentos * 2 vértices
  })
  it('no desborda por encima de maxSegments', () => {
    const buf = createLineBuffer(1, new THREE.LineBasicMaterial())
    buf.begin(); buf.push(0,0,0,1,1,1,[1,1,1],[1,1,1]); buf.push(0,0,0,1,1,1,[1,1,1],[1,1,1])
    buf.commit()
    expect(buf.mesh.geometry.drawRange.count).toBe(2)
  })
})

describe('createPointCloud', () => {
  it('preasigna buffers del tamaño pedido y commit no lanza', () => {
    const pc = createPointCloud(5, new THREE.PointsMaterial())
    expect(pc.pos).toHaveLength(15)
    expect(pc.size).toHaveLength(5)
    pc.pos[0] = 3; pc.commit()
    expect(pc.mesh.geometry.attributes.position.array[0]).toBe(3)
  })
})
