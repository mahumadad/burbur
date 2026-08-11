import * as THREE from 'three'
import { createLineBuffer, createPointCloud } from '../../render/engine/points.js'

// LA HIJA (§6 spec ciclo-y-division; ampliada dos veces tras revisión visual).
//
// Es un MACRÓFAGO HIJO de verdad: no solo un contorno, sino la MISMA "idea 3D"
// que la madre — cuerpo translúcido, membrana con frente, núcleo con domo
// elevado, organelos y citoesqueleto a distintas alturas. Con la cámara aérea
// 3/4 eso se lee como una célula pequeña con volumen, no como un disco plano.
// Repta por su cuenta en una dirección propia y se va de cuadro; y su borde
// CHOCA con el de la madre (y con el de otra hija): las membranas se empujan
// al acercarse, no se atraviesan.
//
// Pool fijo de 3. Vive DENTRO del grupo `substrate`; su posición combina el
// arrastre del sustrato (madre reptando) + su propio reptar (`ownX/ownZ`), al
// que también se le suman los empujones de colisión.
const POOL = 3
const VERTS = 30
const ORG_PER = 5          // organelos visibles por hija
const TWO_PI = Math.PI * 2
const FADE_START_MUL = 1.9
const FADE_END_MUL = 2.7
const MATURE_TIME = 4      // s hasta re-polarizar y arrancar a reptar

// Direcciones fijas de los organelos dentro de la hija (para que se lea igual
// desde cualquier ángulo, como la "criatura" de los agentes del bosque).
const ORG_DIRS = [
  [0.5, 0.3], [-0.6, 0.4], [0.2, -0.7], [-0.4, -0.5], [0.7, -0.1],
]

export function createDaughters(substrate, { R, H, rnd, membraneCol, frontCol, fillColor, orgColors, pointMaterial }) {
  const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 })
  // por slot: contorno (VERTS×2) + núcleo (2 aros×13) + citoesqueleto (4) ≈ 90
  const buf = createLineBuffer(POOL * 100, lineMat)
  substrate.add(buf.mesh)

  // Relleno del cuerpo (círculo plano) + domo del núcleo (media esfera elevada):
  // dos meshes por slot, como en la madre, para el "cuerpo con volumen".
  const fillMat = new THREE.MeshBasicMaterial({
    color: fillColor, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide,
  })
  const domeMat = new THREE.MeshBasicMaterial({
    color: 0xffb15a, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.BackSide,
  })
  const mk = (geo, mat) => { const m = new THREE.Mesh(geo, mat.clone()); m.visible = false; substrate.add(m); return m }
  const fills = Array.from({ length: POOL }, () => {
    const m = mk(new THREE.CircleGeometry(1, VERTS), fillMat); m.rotation.x = -Math.PI / 2; return m
  })
  const domes = Array.from({ length: POOL }, () => mk(new THREE.SphereGeometry(1, 14, 10), domeMat))

  // Organelos: puntos tamaño-mundo (reusa el shader de puntos del engine).
  const orgCloud = createPointCloud(POOL * ORG_PER, pointMaterial)
  substrate.add(orgCloud.mesh)
  for (let i = 0; i < POOL * ORG_PER; i++) {
    const c = orgColors[i % orgColors.length]
    orgCloud.col[i * 3] = c[0]; orgCloud.col[i * 3 + 1] = c[1]; orgCloud.col[i * 3 + 2] = c[2]
    orgCloud.size[i] = 0.9
  }

  const slots = Array.from({ length: POOL }, () => ({
    alive: false, age: 0, r: 0,
    bx: 0, bz: 0, sbx: 0, sbz: 0,
    ownX: 0, ownZ: 0, heading: 0, speed: 0,
    harm: Array.from({ length: 3 }, () => ({
      k: 2 + Math.floor(rnd() * 3), amp: 0.05 + rnd() * 0.07, phase: rnd() * TWO_PI,
    })),
  }))

  function spawn({ subX, subZ, motherR, spindleAngle = 0 }) {
    const slot = slots.find((s) => !s.alive)
    if (!slot) return
    const sign = rnd() < 0.5 ? 1 : -1
    slot.alive = true
    slot.age = 0
    slot.r = motherR * 0.62
    const poleAng = spindleAngle + (sign > 0 ? 0 : Math.PI)
    const dist = motherR + slot.r * 0.5
    slot.bx = Math.cos(poleAng) * dist
    slot.bz = Math.sin(poleAng) * dist
    slot.sbx = subX; slot.sbz = subZ
    slot.ownX = 0; slot.ownZ = 0
    slot.heading = poleAng + (rnd() - 0.5) * 0.8
    slot.speed = R * (0.035 + rnd() * 0.02)
  }

  /**
   * @param {number} step
   * @param {object} p
   * @param {number} p.subX
   * @param {number} p.subZ
   * @param {(angle:number)=>number} p.motherRadiusAt  radio de la MADRE (mundo)
   *   en un ángulo dado — para que el borde de la hija choque con el de la madre.
   */
  function update(step, { subX, subZ, motherRadiusAt }) {
    // 1) Posición de mundo de cada hija viva (nacimiento + arrastre + reptar).
    const live = []
    for (let si = 0; si < POOL; si++) {
      const s = slots[si]
      if (!s.alive) continue
      s.age += step
      const mature = Math.min(1, s.age / MATURE_TIME)
      if (s.age > MATURE_TIME * 0.5) {
        s.ownX += Math.cos(s.heading) * s.speed * step
        s.ownZ += Math.sin(s.heading) * s.speed * step
      }
      const rNow = s.r * (0.55 + 0.45 * mature)
      const wx = s.bx + (subX - s.sbx) * R + s.ownX
      const wz = s.bz + (subZ - s.sbz) * R + s.ownZ
      live.push({ si, s, wx, wz, rNow, mature })
    }

    // 2) Colisión de bordes. La MADRE está en el origen: si la hija penetra su
    //    membrana, se la empuja hacia afuera. Entre hijas, se separan mutuamente.
    for (const L of live) {
      const d = Math.hypot(L.wx, L.wz) || 1e-3
      const mr = motherRadiusAt ? motherRadiusAt(Math.atan2(L.wz, L.wx)) : 0
      const overlap = (mr + L.rNow * 0.92) - d
      if (overlap > 0) {
        const push = overlap
        L.s.ownX += (L.wx / d) * push; L.s.ownZ += (L.wz / d) * push
        L.wx += (L.wx / d) * push; L.wz += (L.wz / d) * push
      }
    }
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const A = live[i], B = live[j]
        const dx = B.wx - A.wx, dz = B.wz - A.wz
        const d = Math.hypot(dx, dz) || 1e-3
        const overlap = (A.rNow + B.rNow) * 0.92 - d
        if (overlap > 0) {
          const hx = (dx / d) * overlap * 0.5, hz = (dz / d) * overlap * 0.5
          A.s.ownX -= hx; A.s.ownZ -= hz; A.wx -= hx; A.wz -= hz
          B.s.ownX += hx; B.s.ownZ += hz; B.wx += hx; B.wz += hz
        }
      }
    }

    // 3) Dibujo.
    buf.begin()
    const fadeStart = R * FADE_START_MUL, fadeEnd = R * FADE_END_MUL
    let dead = new Set()
    for (const L of live) {
      const { s, rNow, mature } = L
      const dist = Math.hypot(L.wx, L.wz)
      if (dist > fadeEnd) { s.alive = false; dead.add(L.si); continue }
      const fade = dist < fadeStart ? 1 : 1 - (dist - fadeStart) / (fadeEnd - fadeStart)
      const lx = L.wx - substrate.position.x
      const lz = L.wz - substrate.position.z

      // Cuerpo translúcido.
      const f = fills[L.si]
      f.visible = true; f.position.set(lx, -0.3, lz); f.scale.setScalar(rNow)
      f.material.opacity = 0.1 * fade
      // Domo del núcleo, ELEVADO en Y → volumen con la cámara 3/4.
      const dm = domes[L.si]
      dm.visible = true; dm.position.set(lx, H * 0.15, lz); dm.scale.setScalar(rNow * 0.34)
      dm.material.opacity = 0.16 * fade

      // Membrana: doble contorno + frente teñido.
      const mc = [membraneCol[0] * fade, membraneCol[1] * fade, membraneCol[2] * fade]
      const radial = (a) => {
        let r = rNow
        for (const h of s.harm) r += rNow * h.amp * Math.sin(h.k * a + h.phase)
        const d = Math.abs(((a - s.heading + Math.PI * 3) % TWO_PI) - Math.PI)
        r += rNow * 0.12 * mature * Math.max(0, 1 - d / 1.0)
        return r
      }
      let prev = null, prevIn = null
      for (let i = 0; i <= VERTS; i++) {
        const a = (i / VERTS) * TWO_PI
        const r = radial(a)
        const x = lx + Math.cos(a) * r, z = lz + Math.sin(a) * r
        const d = Math.abs(((a - s.heading + Math.PI * 3) % TWO_PI) - Math.PI)
        const lead = Math.max(0, 1 - d / 1.1) * mature
        const c = [
          mc[0] + (frontCol[0] * fade - mc[0]) * lead,
          mc[1] + (frontCol[1] * fade - mc[1]) * lead,
          mc[2] + (frontCol[2] * fade - mc[2]) * lead,
        ]
        const inx = lx + Math.cos(a) * r * 0.97, inz = lz + Math.sin(a) * r * 0.97
        if (prev) {
          buf.push(prev[0], 0, prev[1], x, 0, z, prev[2], c)
          buf.push(prevIn[0], 0, prevIn[1], inx, 0, inz, prev[2], c)
        }
        prev = [x, z, c]; prevIn = [inx, inz]
      }

      // Núcleo: dos aros a altura elevada (envoltura), como el de la madre.
      const nr = rNow * 0.32, ny = H * 0.15
      const chrom = [membraneCol[0] * 0.9 * fade + 0.1, membraneCol[1] * 0.8 * fade, membraneCol[2] * 0.7 * fade]
      for (const [rr, yy] of [[nr, ny], [nr * 0.6, ny + 0.4]]) {
        let np = null
        for (let i = 0; i <= 12; i++) {
          const a = (i / 12) * TWO_PI
          const x = lx + Math.cos(a) * rr, z = lz + Math.sin(a) * rr
          if (np) buf.push(np[0], yy, np[1], x, yy, z, chrom, chrom)
          np = [x, z]
        }
      }
      // Citoesqueleto: 4 microtúbulos cortos desde el centro, a media altura.
      const railCol = [0.2, 0.3, 0.9]
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TWO_PI + 0.4
        buf.push(lx, H * 0.1, lz, lx + Math.cos(a) * rNow * 0.7, H * 0.1, lz + Math.sin(a) * rNow * 0.7, railCol, railCol)
      }

      // Organelos: puntos a media altura, en direcciones fijas dentro de la hija.
      for (let k = 0; k < ORG_PER; k++) {
        const idx = L.si * ORG_PER + k
        const dir = ORG_DIRS[k]
        orgCloud.pos[idx * 3] = lx + dir[0] * rNow * 0.55
        orgCloud.pos[idx * 3 + 1] = H * 0.2
        orgCloud.pos[idx * 3 + 2] = lz + dir[1] * rNow * 0.55
        orgCloud.size[idx] = 0.9 * mature
      }
    }
    // Apagar los organelos/meshes de slots muertos o vacíos.
    for (let si = 0; si < POOL; si++) {
      const alive = slots[si].alive && !dead.has(si)
      if (!alive) {
        fills[si].visible = false; domes[si].visible = false
        for (let k = 0; k < ORG_PER; k++) orgCloud.pos[(si * ORG_PER + k) * 3 + 1] = -9999
      }
    }
    buf.commit(); orgCloud.commit()
  }

  return { spawn, update }
}
