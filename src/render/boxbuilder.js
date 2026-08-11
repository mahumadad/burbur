// Puerto fiel de `gn` (bundle minificado real de murmur): acumulador de cajas
// que produce el LOOK exacto de edificios y mobiliario. `.box()` añade una
// BoxGeometry trasladada (y rotada en Z opcional) al acumulador de posiciones
// e índices; `.finish()` cierra la geometría y arma el Group final en uno de
// tres estilos: 'lichen' (edificios, con nube de puntos ámbar), 'flat' (mallas
// planas), o sombreado por vértice (grúas/charcos) vía `_n`.
import * as THREE from 'three'
import { fbm } from './noise.js'

// hn(e) del original: segmentos de una BoxGeometry según su tamaño.
function segments(e) {
  return Math.max(1, Math.round(e / 1.35))
}

// clamp Ne(v,a,b) del original.
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v))
}

// vn(triple) del original: RGB [0,1] -> entero 0xRRGGBB.
export function rgbToHex(triple) {
  return (Math.round(triple[0] * 255) << 16) | (Math.round(triple[1] * 255) << 8) | Math.round(triple[2] * 255)
}

// _n(geo, tint, seed) del original: sombreado por vértice. Calcula un factor
// de luz a partir de la normal, la altura relativa dentro de la geometría y
// fbm(2 octavas), y lo multiplica contra el tinte para pintar `color` por vértice.
function shadeVertices(geo, tint, seed) {
  geo.computeVertexNormals()
  const pos = geo.attributes.position
  const nrm = geo.attributes.normal
  const count = pos.count
  let minY = 1e9
  let maxY = -1e9
  for (let i = 0; i < count; i++) {
    const y = pos.getY(i)
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const range = Math.max(0.001, maxY - minY)
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const lightFactor = nrm.getX(i) * 0.52 + nrm.getY(i) * 0.66 + nrm.getZ(i) * 0.31
    const heightRatio = (pos.getY(i) - minY) / range
    const n = fbm(pos.getX(i) * 0.3 + seed, pos.getZ(i) * 0.3 + pos.getY(i) * 0.26, 2)
    const h = clamp(0.24 + 0.4 * (lightFactor * 0.5 + 0.5) + 0.22 * heightRatio + (n - 0.5) * 0.26, 0.05, 1.05)
    colors[i * 3] = Math.min(1, tint[0] * h)
    colors[i * 3 + 1] = Math.min(1, tint[1] * h)
    colors[i * 3 + 2] = Math.min(1, tint[2] * h)
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geo
}

// _n(geo, tint, seed) del original, expuesto para geometrías THREE crudas
// (Cylinder/Box/Icosahedron) fuera del acumulador de cajas — lo usa `Tn`
// (escombros/adoquines) del port de city.js. Misma función que usa `finish`
// internamente para el estilo sombreado (false).
export function shadeGeometry(geo, tint, seed) {
  return shadeVertices(geo, tint, seed)
}

/**
 * Crea un acumulador de cajas (puerto de gn). `rnd` es inyectable para que
 * el liquen/sombreado sea determinista en tests o por-mundo.
 */
export function createBoxBuilder(rnd = Math.random) {
  const P = []
  const I = []

  function box(w, h, d, x, y, z, rotZ) {
    const geo = new THREE.BoxGeometry(w, h, d, segments(w), segments(h), segments(d))
    const m = new THREE.Matrix4().makeTranslation(x, y, z)
    if (rotZ) m.multiply(new THREE.Matrix4().makeRotationZ(rotZ))
    geo.applyMatrix4(m)
    const positions = geo.attributes.position.array
    const indices = geo.index.array
    const offset = P.length / 3
    for (let i = 0; i < positions.length; i++) P.push(positions[i])
    for (let i = 0; i < indices.length; i++) I.push(indices[i] + offset)
    geo.dispose()
  }

  function finish(colorTriple, style) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(P), 3))
    geo.setIndex(I)
    const group = new THREE.Group()

    if (style === 'lichen') {
      geo.computeVertexNormals()
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: rgbToHex(colorTriple), side: THREE.DoubleSide,
        transparent: true, opacity: 0.42, depthWrite: false,
      }))
      mesh.renderOrder = -1
      group.add(mesh)

      const posAttr = geo.attributes.position
      const nrmAttr = geo.attributes.normal
      const triCount = (I.length / 3) | 0
      const target = Math.min(9500, Math.max(700, (triCount * 2) | 0))
      const seed = rnd() * 83
      const points = []
      const colors = []
      let tries = 0
      while (points.length / 3 < target && tries++ < target * 6) {
        const triBase = ((rnd() * triCount) | 0) * 3
        const ia = I[triBase]
        const ib = I[triBase + 1]
        const ic = I[triBase + 2]
        let u = rnd()
        let v = rnd()
        if (u + v > 1) { u = 1 - u; v = 1 - v }
        const w0 = 1 - u - v
        const bx = posAttr.getX(ia) * w0 + posAttr.getX(ib) * u + posAttr.getX(ic) * v
        const by = posAttr.getY(ia) * w0 + posAttr.getY(ib) * u + posAttr.getY(ic) * v
        const bz = posAttr.getZ(ia) * w0 + posAttr.getZ(ib) * u + posAttr.getZ(ic) * v
        if (fbm(bx * 0.4 + seed, bz * 0.4 + by * 0.35, 2) < 0.4) continue
        points.push(
          bx + nrmAttr.getX(ia) * 0.09,
          by + nrmAttr.getY(ia) * 0.09,
          bz + nrmAttr.getZ(ia) * 0.09,
        )
        colors.push(1, 0.44 + rnd() * 0.22, 0.05 + rnd() * 0.04)
      }

      const pointsGeo = new THREE.BufferGeometry()
      pointsGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(points), 3))
      pointsGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(colors), 3))
      const cloud = new THREE.Points(pointsGeo, new THREE.PointsMaterial({
        vertexColors: true, size: 0.15, sizeAttenuation: true,
      }))
      cloud.frustumCulled = false
      group.add(cloud)
    } else if (style === 'flat') {
      group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: rgbToHex(colorTriple), side: THREE.DoubleSide })))
    } else {
      shadeVertices(geo, colorTriple, rnd() * 61)
      group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })))
    }

    return group
  }

  return { box, finish }
}
