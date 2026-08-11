import * as THREE from 'three'
import { noise2 } from '../noise.js'

// TRONCO CAÍDO compartido: el mismo tubo ahusado + ramas recursivas que usa el
// bosque para sus troncos tumbados (`branch(..., fallen)`), pero empaquetado
// como un THREE.Group centrado en el origen que el mundo posiciona/anima donde
// quiera (p. ej. flotando en la laguna). Sin follaje (madera muerta).

const TREE_FILL = 0x130d09   // relleno casi negro
const TREE_EDGE = 0xd9d9ba   // aristas color hueso
const rnd = Math.random

/**
 * Devuelve un Group con la madera (malla oscura + aristas hueso). El eje largo
 * del tronco queda ~horizontal sobre X, centrado en el origen.
 */
export function buildFallenLog({ length = 14, radius = 1.6, seed = rnd() * 97, edgeColor = TREE_EDGE } = {}) {
  const pos = [], idx = []

  // Tubo alrededor de una espina, ahusado y con radio perturbado por ruido.
  function tube(spine, r0, r1, segs, sd) {
    const base = pos.length / 3
    const n = spine.length
    const tan = new THREE.Vector3(), up = new THREE.Vector3()
    const bx = new THREE.Vector3(), by = new THREE.Vector3()
    for (let c = 0; c < n; c++) {
      tan.subVectors(spine[Math.min(n - 1, c + 1)], spine[Math.max(0, c - 1)]).normalize()
      up.set(0, 1, 0)
      if (Math.abs(tan.y) > 0.9) up.set(1, 0, 0)
      bx.crossVectors(tan, up).normalize()
      by.crossVectors(tan, bx)
      const h = c / (n - 1)
      const g = r0 + (r1 - r0) * Math.pow(h, 0.85)
      const p = spine[c]
      for (let l = 0; l < segs; l++) {
        const a = (l / segs) * 6.2832
        const cv = Math.cos(a), sv = Math.sin(a)
        const rad = g * (1 + (noise2(p.x * 1.4 + sd + l * 3.7, p.z * 1.4 + p.y * 0.9) - 0.5) * 0.34)
        pos.push(
          p.x + (bx.x * cv + by.x * sv) * rad,
          p.y + (bx.y * cv + by.y * sv) * rad,
          p.z + (bx.z * cv + by.z * sv) * rad,
        )
      }
    }
    for (let c = 0; c < n - 1; c++) {
      for (let l = 0; l < segs; l++) {
        const x = base + c * segs + l
        const s2 = base + c * segs + ((l + 1) % segs)
        const C = x + segs, w = s2 + segs
        idx.push(x, C, s2, s2, C, w)
      }
    }
  }

  // Rama recursiva; `fallen` → casi no sube, se arrastra.
  function branch(start, dir, len, r, depth, maxDepth) {
    const SEG = 4
    const spine = [start.clone()]
    const cur = start.clone()
    const d = dir.clone()
    for (let p = 0; p < SEG; p++) {
      d.x += (rnd() - 0.5) * 0.55
      d.y += (rnd() - 0.5) * 0.38 + 0.02 // caído: apenas sube
      d.z += (rnd() - 0.5) * 0.55
      d.normalize()
      cur.addScaledVector(d, len / SEG)
      spine.push(cur.clone())
    }
    const tip = depth >= maxDepth
    const rEnd = tip ? 0.03 : r * (0.52 + rnd() * 0.16)
    tube(spine, r, rEnd, r > 0.8 ? 9 : r > 0.35 ? 7 : 5, seed)
    if (tip) return
    const kids = depth === 0 ? 2 + ((rnd() * 2) | 0) : (rnd() < 0.7 ? 1 : 2) + (rnd() < 0.25 ? 1 : 0)
    const up = new THREE.Vector3()
    for (let i = 0; i < kids; i++) {
      const v = d.clone()
      up.set(0, 1, 0)
      if (Math.abs(v.y) > 0.9) up.set(1, 0, 0)
      const bx = new THREE.Vector3().crossVectors(v, up).normalize()
      const by = new THREE.Vector3().crossVectors(v, bx)
      const az = rnd() * 6.2832, spread = 0.35 + rnd() * 0.65
      const w = bx.multiplyScalar(Math.cos(az)).addScaledVector(by, Math.sin(az))
      v.multiplyScalar(Math.cos(spread)).addScaledVector(w, Math.sin(spread)).normalize()
      const from = i === 0 ? spine[spine.length - 1] : spine[1 + ((rnd() * (spine.length - 1)) | 0)]
      branch(from.clone(), v, len * (0.6 + rnd() * 0.22), rEnd * (0.85 + rnd() * 0.2), depth + 1, maxDepth)
    }
  }

  // Espina principal tumbada sobre X, arrancando a la izquierda del centro.
  branch(new THREE.Vector3(-length * 0.5, 0, 0),
    new THREE.Vector3(1, 0.06, (rnd() - 0.5) * 0.3).normalize(),
    length, radius, 0, 2)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()

  const group = new THREE.Group()
  group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: TREE_FILL, side: THREE.DoubleSide, fog: true,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  })))
  group.add(new THREE.LineSegments(
    new THREE.WireframeGeometry(geo),
    new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.55, fog: true }),
  ))
  return group
}
