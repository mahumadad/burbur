import * as THREE from 'three'
import { createLineBuffer } from '../../render/engine/points.js'

// LA HIJA (§6 spec ciclo-y-division; ampliada tras revisión visual del usuario:
// "que se vea partirse, que salga otro macrófago y se vaya para otro lado a
// repetir el ciclo, hasta salir de pantalla, para que se entienda completo").
//
// Ya no es un contorno pasivo que solo deriva: es un MACRÓFAGO HIJO de verdad
// — cuerpo translúcido + membrana + núcleo + frente de avance — que REPTA por
// su cuenta en una dirección propia (distinta a la de la madre) y se va de
// cuadro. Así la división se lee entera: una célula se vuelve dos, y cada una
// sigue su camino.
//
// Pool fijo de 3 (como el resto de los pools del mundo). Vive DENTRO del grupo
// `substrate` para que el reptar de la MADRE también las separe; encima, cada
// hija acumula su PROPIO desplazamiento (`ownX/ownZ`) en su rumbo, que es lo
// que la manda a otro lado y fuera de pantalla.
const POOL = 3
const VERTS = 30
const TWO_PI = Math.PI * 2
// Distancias (relativas a R) a las que se desvanece y libera el slot.
const FADE_START_MUL = 1.9
const FADE_END_MUL = 2.7
// Maduración: recién nacida está redondeada y quieta; en ~4 s toma forma y
// arranca a reptar (una célula recién dividida tarda en re-polarizarse).
const MATURE_TIME = 4

/**
 * @param {THREE.Group} substrate  el grupo que se desliza con la célula
 * @param {object} p
 * @param {number} p.R  radio de mundo de la célula
 * @param {number} p.H  altura de la lámina celular sobre el sustrato
 * @param {function} p.rnd
 * @param {[number,number,number]} p.membraneCol  color del contorno (rgb 0..1)
 * @param {[number,number,number]} p.frontCol     color del frente de avance
 * @param {number} p.fillColor  hex del relleno translúcido
 */
export function createDaughters(substrate, { R, H, rnd, membraneCol, frontCol, fillColor }) {
  const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 })
  const buf = createLineBuffer(POOL * (VERTS + VERTS + 10), lineMat)
  substrate.add(buf.mesh)

  // Un relleno sólido por slot: le da CUERPO (igual que la membrana de la
  // madre). Círculo plano que se escala y posiciona cada frame.
  const fillMat = new THREE.MeshBasicMaterial({
    color: fillColor, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide,
  })
  const fills = Array.from({ length: POOL }, () => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, VERTS), fillMat.clone())
    m.rotation.x = -Math.PI / 2
    m.visible = false
    substrate.add(m)
    return m
  })

  const slots = Array.from({ length: POOL }, () => ({
    alive: false, age: 0, r: 0,
    bx: 0, bz: 0,           // posición de nacimiento (mundo, centro = la madre)
    sbx: 0, sbz: 0,         // offset del sustrato al nacer
    ownX: 0, ownZ: 0,       // desplazamiento PROPIO acumulado (su reptar)
    heading: 0, speed: 0,   // rumbo y velocidad de su crawl
    // Contorno congelado: armónicos fijos (no respira, como el tejido vecino).
    harm: Array.from({ length: 3 }, () => ({
      k: 2 + Math.floor(rnd() * 3), amp: 0.05 + rnd() * 0.07, phase: rnd() * TWO_PI,
    })),
  }))

  /**
   * Nace una hija en un polo del huso (spindleAngle) y elige un rumbo propio
   * que la aleja de la madre — sesgado hacia AFUERA del origen, así se va de
   * cuadro por su lado.
   * @param {{subX,subZ,motherR,spindleAngle}} p
   */
  function spawn({ subX, subZ, motherR, spindleAngle = 0 }) {
    const slot = slots.find((s) => !s.alive)
    if (!slot) return
    const sign = rnd() < 0.5 ? 1 : -1
    slot.alive = true
    slot.age = 0
    slot.r = motherR * 0.62
    // Nace en un polo del huso, pegada a la madre.
    const poleAng = spindleAngle + (sign > 0 ? 0 : Math.PI)
    const dist = motherR + slot.r * 0.5
    slot.bx = Math.cos(poleAng) * dist
    slot.bz = Math.sin(poleAng) * dist
    slot.sbx = subX; slot.sbz = subZ
    slot.ownX = 0; slot.ownZ = 0
    // Rumbo: sale por su polo, con algo de dispersión → dirección clara y
    // distinta a la de la madre.
    slot.heading = poleAng + (rnd() - 0.5) * 0.8
    slot.speed = R * (0.035 + rnd() * 0.02)   // reptar propio (unidades/s)
  }

  /** @param {{subX,subZ}} p  offset ACTUAL del sustrato */
  function update(step, { subX, subZ }) {
    buf.begin()
    const fadeStart = R * FADE_START_MUL
    const fadeEnd = R * FADE_END_MUL
    for (let si = 0; si < POOL; si++) {
      const s = slots[si]
      if (!s.alive) { fills[si].visible = false; continue }
      s.age += step
      const mature = Math.min(1, s.age / MATURE_TIME)
      // Recién nacida: pequeña y quieta. Madura: crece a su tamaño y repta.
      if (s.age > MATURE_TIME * 0.5) {
        s.ownX += Math.cos(s.heading) * s.speed * step
        s.ownZ += Math.sin(s.heading) * s.speed * step
      }
      // Posición: nacimiento + cuánto corrió el sustrato (la madre reptando) +
      // su propio reptar. Los dos primeros la separan de la madre; el tercero
      // la manda a otro lado.
      const wx = s.bx + (subX - s.sbx) * R + s.ownX
      const wz = s.bz + (subZ - s.sbz) * R + s.ownZ
      const dist = Math.hypot(wx, wz)
      if (dist > fadeEnd) { s.alive = false; fills[si].visible = false; continue }
      const fade = dist < fadeStart ? 1 : 1 - (dist - fadeStart) / (fadeEnd - fadeStart)
      // El grupo `substrate` ya tiene su propio desplazamiento (con wrap); se
      // resta para no aplicarlo dos veces sobre un objeto único.
      const lx = wx - substrate.position.x
      const lz = wz - substrate.position.z
      const rNow = s.r * (0.55 + 0.45 * mature)   // crece al madurar

      // ── Relleno translúcido (cuerpo) ──────────────────────────────────────
      const f = fills[si]
      f.visible = true
      f.position.set(lx, -0.3, lz)
      f.scale.setScalar(rNow)
      f.material.opacity = 0.1 * fade

      // ── Membrana: doble contorno + frente de avance teñido ────────────────
      const mc = [membraneCol[0] * fade, membraneCol[1] * fade, membraneCol[2] * fade]
      const radial = (a) => {
        let r = rNow
        for (const h of s.harm) r += rNow * h.amp * Math.sin(h.k * a + h.phase)
        // Lamelipodio: se abomba un poco hacia el rumbo (lee "va para allá").
        const d = Math.abs(((a - s.heading + Math.PI * 3) % TWO_PI) - Math.PI)
        r += rNow * 0.12 * mature * Math.max(0, 1 - d / 1.0)
        return r
      }
      let prev = null, prevIn = null
      for (let i = 0; i <= VERTS; i++) {
        const a = (i / VERTS) * TWO_PI
        const r = radial(a)
        const x = lx + Math.cos(a) * r, z = lz + Math.sin(a) * r
        // Frente cian, resto membrana.
        const d = Math.abs(((a - s.heading + Math.PI * 3) % TWO_PI) - Math.PI)
        const lead = Math.max(0, 1 - d / 1.1) * mature
        const c = [
          (mc[0] + (frontCol[0] * fade - mc[0]) * lead),
          (mc[1] + (frontCol[1] * fade - mc[1]) * lead),
          (mc[2] + (frontCol[2] * fade - mc[2]) * lead),
        ]
        const inx = lx + Math.cos(a) * r * 0.97, inz = lz + Math.sin(a) * r * 0.97
        if (prev) {
          buf.push(prev[0], 0, prev[1], x, 0, z, prev[2], c)       // contorno externo
          buf.push(prevIn[0], 0, prevIn[1], inx, 0, inz, prev[2], c) // lámina interna (bicapa)
        }
        prev = [x, z, c]; prevIn = [inx, inz]
      }
      // ── Núcleo: un aro pequeño, para que se lea como célula con centro ────
      const nr = rNow * 0.32
      let np = null
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * TWO_PI
        const x = lx + Math.cos(a) * nr, z = lz + Math.sin(a) * nr
        if (np) buf.push(np[0], 0, np[1], x, 0, z, mc, mc)
        np = [x, z]
      }
    }
    buf.commit()
  }

  return { spawn, update }
}
