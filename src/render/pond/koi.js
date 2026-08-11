import * as THREE from 'three'

// ─── KOI ───────────────────────────────────────────────────────────────────
// Peces koi con paridad con el modelo de koi-garden (adarose): su `fish.glb` es
// UNA malla esbelta (largo ≈ 2.6× ancho) con aleta DORSAL, y patrones koi en
// COLOR DE VÉRTICE. Aquí el cuerpo es torneado (anillos elípticos, comprimido
// lateralmente) con cabeza redonda y pedúnculo fino, + dorsal + pectorales + una
// COLA BÍFIDA en pivote que coletea; el cuerpo también hace un leve vaivén (la
// referencia flexiona la espina). Parches de color por variante.
//
//   · `buildKoi(rand)` para koi que SON agentes con nombre (pond.js los mueve).
//   · `createKoiSchool(...)` para el CARDUMEN (boids propio, profundidad variable,
//     estela al nadar cerca de la superficie).

// Variantes koi: color base del cuerpo + colores de parche + nº de parches.
const KOI_VARIANTS = [
  { base: [0.96, 0.96, 0.94], patch: [[0.88, 0.15, 0.07]], n: 3 },                 // kohaku (blanco+rojo)
  { base: [0.96, 0.96, 0.94], patch: [[0.88, 0.15, 0.07], [0.08, 0.08, 0.11]], n: 4 }, // sanke (+negro)
  { base: [0.95, 0.74, 0.16], patch: [[1.0, 0.88, 0.34]], n: 2 },                  // ogon (dorado)
  { base: [0.92, 0.92, 0.95], patch: [[0.1, 0.11, 0.16], [0.88, 0.15, 0.07]], n: 4 }, // showa
  { base: [0.9, 0.42, 0.12], patch: [[0.99, 0.82, 0.32]], n: 3 },                  // naranja
]
const FIN = [0.92, 0.94, 0.98] // aletas blanquecinas traslúcidas

const L = 2.2                 // largo del koi
// Perfil del radio del cuerpo a lo largo de X (cola -L/2 → cabeza +L/2), como el
// koi: cola/pedúnculo fino, panza ancha, cabeza redondeada.
const PROFILE = [[0, 0.03], [0.09, 0.11], [0.24, 0.30], [0.5, 0.38], [0.72, 0.35], [0.9, 0.25], [1, 0.15]]
function radiusAt(t) {
  for (let i = 0; i < PROFILE.length - 1; i++) {
    if (t <= PROFILE[i + 1][0]) {
      const [a, ra] = PROFILE[i], [b, rb] = PROFILE[i + 1]
      return ra + (rb - ra) * ((t - a) / (b - a))
    }
  }
  return 0.15
}
const HW = 0.85, HH = 1.16    // sección elíptica: alto > ancho (koi comprimido)

// Construye la malla del koi (una variante al azar). Devuelve pivotes para animar.
export function buildKoi(rand = Math.random) {
  const group = new THREE.Group()
  const bodyPivot = new THREE.Group()   // vaivén suave del cuerpo (flexión de espina)
  group.add(bodyPivot)
  const v = KOI_VARIANTS[(rand() * KOI_VARIANTS.length) | 0]
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true })

  // Parches koi: blobs asimétricos sobre el lomo/costados (colorean vértices cercanos).
  const seeds = []
  for (let p = 0; p < v.n; p++) {
    const x = (rand() - 0.45) * L
    const rr = radiusAt((x + L / 2) / L)
    seeds.push({
      x, y: (rand() < 0.6 ? 1 : -0.4) * (0.2 + rand() * 0.7) * rr * HH,
      z: (rand() - 0.5) * rr, r: 0.26 + rand() * 0.4,
      col: v.patch[p % v.patch.length],
    })
  }
  const colorAt = (x, y, z) => {
    for (const s of seeds) if (Math.hypot(x - s.x, y - s.y, z - s.z) < s.r) return s.col
    return v.base
  }

  // Cuerpo torneado: anillos elípticos entre x0..x1.
  function body(x0, x1, N, S) {
    const pos = [], col = [], idx = []
    for (let i = 0; i <= N; i++) {
      const x = x0 + (x1 - x0) * (i / N)
      const r = radiusAt((x + L / 2) / L)
      for (let s = 0; s < S; s++) {
        const a = (s / S) * 6.2832
        const y = Math.sin(a) * r * HH, z = Math.cos(a) * r * HW
        pos.push(x, y, z)
        const c = colorAt(x, y, z)
        col.push(c[0], c[1], c[2])
      }
    }
    for (let i = 0; i < N; i++) for (let s = 0; s < S; s++) {
      const A = i * S + s, B = i * S + (s + 1) % S
      idx.push(A, A + S, B, B, A + S, B + S)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3))
    g.setIndex(idx); g.computeVertexNormals()
    return new THREE.Mesh(g, mat)
  }

  // Aleta plana (triángulos) con color fijo.
  function fin(verts, color) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3))
    const c = new Float32Array(verts.length)
    for (let i = 0; i < verts.length / 3; i++) { c[i * 3] = color[0]; c[i * 3 + 1] = color[1]; c[i * 3 + 2] = color[2] }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3))
    g.computeVertexNormals()
    return new THREE.Mesh(g, mat)
  }

  bodyPivot.add(body(-L / 2, L / 2, 16, 10))

  // Dorsal: cresta baja sobre el lomo, entre t≈0.42 y 0.68.
  const dx0 = -L / 2 + 0.42 * L, dx1 = -L / 2 + 0.68 * L
  const dy0 = radiusAt(0.42) * HH, dy1 = radiusAt(0.68) * HH
  bodyPivot.add(fin([
    dx0, dy0 * 0.9, 0, dx1, dy1 * 0.9, 0, (dx0 + dx1) / 2, Math.max(dy0, dy1) + 0.32, 0,
  ], FIN))

  // Pectorales: dos aletitas detrás de la cabeza (t≈0.72), a los costados.
  const px = -L / 2 + 0.72 * L, pr = radiusAt(0.72)
  for (const sgn of [1, -1]) {
    bodyPivot.add(fin([
      px, -0.02, sgn * pr * HW * 0.7, px - 0.4, -0.14, sgn * (pr * HW + 0.28), px - 0.02, -0.16, sgn * pr * HW * 0.7,
    ], FIN))
  }

  // Cola BÍFIDA en pivote (coletea). Nace en el pedúnculo (x=-L/2).
  const tail = new THREE.Group()
  tail.position.x = -L / 2
  tail.add(fin([
    0, 0, 0, -0.78, 0.58, 0, -0.5, 0.12, 0,      // lóbulo superior
    0, 0, 0, -0.5, 0.12, 0, -0.5, -0.12, 0,      // centro (muesca)
    0, 0, 0, -0.5, -0.12, 0, -0.78, -0.58, 0,    // lóbulo inferior
  ], FIN))
  group.add(tail)

  return { group, bodyPivot, tail }
}

// Anima un koi (vaivén de cuerpo + coleteo). `speed` escala la frecuencia.
export function swimKoi(k, t) {
  k.bodyPivot.rotation.y = Math.sin(t * k.spd * 5 + k.phase) * 0.09
  k.tail.rotation.y = Math.sin(t * k.spd * 5 + k.phase - 0.6) * 0.7
}

// Cardumen anónimo: boids ligero (cohesión + separación + wander), PROFUNDIDAD
// variable (algunos en superficie, otros hondo), bordea islas, y deja ESTELA
// cuando nada cerca de la superficie (via callback `wake`).
export function createKoiSchool(scene, count, rand, { radius, surfaceY, floorY, obstacles, wake }) {
  const koi = []
  for (let i = 0; i < count; i++) {
    const built = buildKoi(rand)
    built.group.scale.setScalar(1.2 + rand() * 0.9)
    scene.add(built.group)
    const a = rand() * 6.2832, r = Math.sqrt(rand()) * radius * 0.85
    koi.push({
      ...built, x: Math.cos(a) * r, z: Math.sin(a) * r,
      vx: Math.cos(a + 1.6), vz: Math.sin(a + 1.6),
      phase: rand() * 6.2832, spd: 0.7 + rand() * 0.6, bob: rand() * 6.2832,
      depth: rand(), depthT: 2 + rand() * 6, wakeT: 0,          // depth 0=superficie, 1=fondo
    })
  }
  function update(dt, t) {
    let cx = 0, cz = 0
    for (const k of koi) { cx += k.x; cz += k.z }
    cx /= count; cz /= count
    for (const k of koi) {
      k.vx += (cx - k.x) * 0.0016; k.vz += (cz - k.z) * 0.0016            // cohesión
      for (const o of koi) {
        if (o === k) continue
        const dx = k.x - o.x, dz = k.z - o.z, d2 = dx * dx + dz * dz
        if (d2 < 9 && d2 > 1e-4) { const inv = 1 / d2; k.vx += dx * inv * 0.05; k.vz += dz * inv * 0.05 } // separación
      }
      k.vx += (rand() - 0.5) * 0.03; k.vz += (rand() - 0.5) * 0.03        // wander
      const sp = Math.hypot(k.vx, k.vz) || 1e-4
      k.vx = k.vx / sp * k.spd; k.vz = k.vz / sp * k.spd
      let nx = k.x + k.vx * dt * 6, nz = k.z + k.vz * dt * 6
      const rr = Math.hypot(nx, nz)
      if (rr > radius) { const n = 1 / rr; k.vx -= nx * n * 0.06; k.vz -= nz * n * 0.06 }
      if (obstacles) for (const ob of obstacles) {
        const dx = nx - ob.x, dz = nz - ob.z, d = Math.hypot(dx, dz)
        if (d < ob.r) { const n = 1 / (d || 1e-4); k.vx += dx * n * 0.25; k.vz += dz * n * 0.25; nx = k.x; nz = k.z }
      }
      k.x = nx; k.z = nz
      // Profundidad: cada koi sube y baja despacio hacia una meta que cambia.
      k.depthT -= dt
      if (k.depthT <= 0) { k.depth = Math.pow(rand(), 1.4); k.depthT = 3 + rand() * 7 }
      const yTarget = surfaceY + (floorY - surfaceY) * k.depth
      k.y = (k.y ?? yTarget) + (yTarget - (k.y ?? yTarget)) * 0.02
      k.group.position.set(k.x, k.y + Math.sin(t * 1.2 + k.bob) * 0.12, k.z)
      k.group.rotation.y = Math.atan2(-k.vz, k.vx)
      swimKoi(k, t)
      // Estela: sólo los koi cerca de la superficie mueven el agua.
      if (wake && k.depth < 0.28) {
        k.wakeT -= dt
        if (k.wakeT <= 0) { wake(k.x, k.z, 0.3 + (0.28 - k.depth) * 0.5); k.wakeT = 0.5 + rand() * 0.6 }
      }
    }
  }
  // AGITAR: los koi se dispersan (dardo hacia afuera) y suben hacia la superficie.
  function scatter(strength = 1) {
    for (const k of koi) {
      const m = Math.hypot(k.x, k.z) || 1e-3
      k.vx += (k.x / m) * (0.6 + rand() * 0.8) * strength
      k.vz += (k.z / m) * (0.6 + rand() * 0.8) * strength
      k.depth = Math.min(k.depth, 0.1 * rand()); k.depthT = 1 + rand() * 2
    }
  }
  return { koi, update, scatter }
}
