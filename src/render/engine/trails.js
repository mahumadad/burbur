import * as THREE from 'three'
import { createPointCloud } from './points.js'

// Estelas: puntos de tamaño-mundo que persisten y se desvanecen.
export function createTrails(scene, n, agentColors, rc, pointMaterial) {
  const TRAIL = rc.trailLen
  const cloud = createPointCloud(n * TRAIL, pointMaterial)
  const { pos: tPos, col: tCol, size: tSize } = cloud
  const tmpC = new THREE.Color()
  for (let i = 0; i < n; i++) {
    tmpC.set(agentColors[i % agentColors.length])
    for (let s = 0; s < TRAIL; s++) {
      const k = (i * TRAIL + s) * 3
      tCol[k] = tmpC.r; tCol[k + 1] = tmpC.g; tCol[k + 2] = tmpC.b
    }
  }
  scene.add(cloud.mesh)
  let tHead = 0, tFrame = 0

  function update(worldPos) {
    // Estelas: siembra espaciada y desvanecido lento → puntos separados, no manchones.
    for (let k = 0; k < n * TRAIL; k++) tSize[k] *= 0.997
    if (tFrame % 7 === 0) {
      for (let i = 0; i < n; i++) {
        const slot = (i * TRAIL + tHead) * 3
        tPos[slot] = worldPos[i * 3]
        tPos[slot + 1] = worldPos[i * 3 + 1] - 1.2
        tPos[slot + 2] = worldPos[i * 3 + 2]
        tSize[i * TRAIL + tHead] = rc.trailSize * 0.17 // puntos un poco más gruesos (paridad murmur)
      }
      tHead = (tHead + 1) % TRAIL
    }
    tFrame++
    cloud.commit()
  }

  return { update }
}
