import * as THREE from 'three'

// M10 — Contexto de tejido: 3–5 contornos PARCIALES de células vecinas
// asomando por el borde del sustrato. Puro paisaje: sin interior, sin
// organelos, sin eventos — solo el contorno, CONGELADO (no se anima como la
// membrana real). Viven DENTRO del grupo `substrate` para deslizarse con él:
// se acercan y se alejan cuando la célula migra, y wrappean con el tile.
//
// El contorno usa el mismo espíritu que membrane.js (una forma base + pocos
// armónicos), pero calculado UNA sola vez al crear la escena.
const TWO_PI = Math.PI * 2

/**
 * @param {THREE.Group} substrate  el grupo que ya se desliza con la célula
 * @param {object} p
 * @param {number} p.R  radio de mundo de la célula (referencia de escala)
 * @param {number} p.H  altura de la lámina celular
 * @param {function} p.rnd
 * @param {number} p.color  hex (0xRRGGBB)
 */
export function addTissueNeighbors(substrate, { R, H, rnd, color }) {
  const count = 3 + Math.floor(rnd() * 3) // 3..5 vecinas
  const VERTS = 40
  const y = -H + 0.1 // entre los puntos del tile (-H) y las fibras (-H+0.2)
  const pos = []
  for (let k = 0; k < count; k++) {
    // Centro a 1.6..2.5 R del origen: asoman por el borde, no invaden el cuadro.
    const dist = R * (1.6 + rnd() * 0.9)
    const cAng = rnd() * TWO_PI
    const cx = Math.cos(cAng) * dist, cz = Math.sin(cAng) * dist
    const rBase = R * (0.75 + rnd() * 0.35)
    const harm = Array.from({ length: 2 + (rnd() < 0.5 ? 0 : 1) }, () => ({
      k: 2 + Math.floor(rnd() * 3), amp: 0.05 + rnd() * 0.08, phase: rnd() * TWO_PI,
    }))
    let prev = null
    for (let i = 0; i <= VERTS; i++) {
      const a = (i / VERTS) * TWO_PI
      let r = rBase
      for (const h of harm) r += rBase * h.amp * Math.sin(h.k * a + h.phase)
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r
      if (prev) pos.push(prev[0], y, prev[1], x, y, z)
      prev = [x, z]
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.16 })
  const mesh = new THREE.LineSegments(geo, mat)
  mesh.frustumCulled = false
  substrate.add(mesh)
}
