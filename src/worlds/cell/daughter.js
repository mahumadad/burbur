import * as THREE from 'three'
import { createLineBuffer } from '../../render/engine/points.js'

// LA HIJA (§6 del spec ciclo-y-division-celula): hasta ahora, dividirse era
// un evento narrado que no cambiaba nada — seguía habiendo una sola célula.
// Esto la hace real: al `divide` del ciclo (sim/cellCycle.js) nace una hija.
// Pool FIJO de 3, como el resto de los pools del mundo: con más divisiones
// que slots libres, alguna simplemente no nace.
//
// CONTORNO: armónicos fijos POR SLOT, calculados una sola vez al crear el
// pool (mismo espíritu que tissue.js) — una hija recién nacida no reptó
// nunca, así que su forma no debe respirar como la membrana viva de la
// madre.
//
// POSICIÓN: el surco estrangula el ECUADOR, así que las dos mitades se
// separan A LO LARGO del eje del huso (donde viajaron los cromosomas): la
// hija nace en un polo, pegada a la madre. Sigue la MISMA matemática que
// las adhesiones focales (ver `drawAdhesions` en cell.js): se guarda dónde
// nació (bx/bz) y el offset del sustrato de ESE instante (sbx/sbz, SIN
// escalar por R). La posición de cada frame es bx + (subX-sbx)*R — así,
// aunque la madre siga reptando, la hija se queda clavada donde nació y se
// aleja SOLA, sin animarla. Sin wrap: a diferencia del tile de fondo (que se
// repite y puede recortar su posición módulo P sin que se note), la hija es
// un objeto único — un salto modular SÍ se vería. El buffer vive DENTRO de
// `substrate` (mismo grupo que el tejido vecino de tissue.js), así que cada
// frame restamos la posición actual del grupo para no aplicar el offset dos
// veces.
const POOL = 3
const VERTS = 26
const TWO_PI = Math.PI * 2
// Distancia (en unidades de mundo) a la que empieza a desvanecerse y a la
// que ya liberó el slot.
const FADE_START_MUL = 1.7
const FADE_END_MUL = 2.6
// Empujón propio: la separación física real, además de que la madre siga
// reptando. Se apaga a los ~10 s (§6).
const PUSH_TIME = 10

/**
 * @param {THREE.Group} substrate  el grupo que se desliza con la célula
 * @param {object} p
 * @param {number} p.R  radio de mundo de la célula (referencia de escala)
 * @param {function} p.rnd
 * @param {[number,number,number]} p.color  rgb 0..1
 */
export function createDaughters(substrate, { R, rnd, color }) {
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 })
  const buf = createLineBuffer(POOL * VERTS, mat)
  substrate.add(buf.mesh)

  // Un contorno congelado por slot: se genera una sola vez y se reutiliza en
  // cada renacimiento de ese slot (nunca se anima, a diferencia de la
  // membrana viva de la madre).
  const slots = Array.from({ length: POOL }, () => ({
    alive: false,
    age: 0,
    r: 0,
    bx: 0, bz: 0,           // posición de nacimiento (mundo, centro = la madre)
    sbx: 0, sbz: 0,         // offset del sustrato en el instante de nacer
    pushAngle: 0, pushSpeed: 0, pushX: 0, pushZ: 0,
    harm: Array.from({ length: 2 }, () => ({
      k: 2 + Math.floor(rnd() * 3), amp: 0.06 + rnd() * 0.07, phase: rnd() * TWO_PI,
    })),
  }))

  /**
   * Nace una hija en el slot más libre (si los 3 están vivos, esta división
   * en particular no produce una: el pool es fijo a propósito).
   * @param {{subX:number, subZ:number, motherR:number}} p
   */
  function spawn({ subX, subZ, motherR }) {
    const slot = slots.find((s) => !s.alive)
    if (!slot) return
    const sign = rnd() < 0.5 ? 1 : -1
    slot.alive = true
    slot.age = 0
    slot.r = motherR * 0.7
    // A LO LARGO del eje del huso (eje x local, ver cell/mitosis.js): los
    // cromosomas viajaron a los dos polos (±x) y el surco estrangula el
    // ecuador, así que las dos mitades se separan sobre ese eje — no
    // perpendicular a él. Nace en un polo, pegada a la madre.
    const dist = motherR + slot.r * 0.55
    slot.bx = sign * dist
    slot.bz = 0
    slot.sbx = subX
    slot.sbz = subZ
    slot.pushX = 0
    slot.pushZ = 0
    slot.pushAngle = sign > 0 ? 0 : Math.PI
    slot.pushSpeed = motherR * 0.05
  }

  /** @param {{subX:number, subZ:number}} p  offset ACTUAL del sustrato */
  function update(step, { subX, subZ }) {
    buf.begin()
    const fadeStart = R * FADE_START_MUL
    const fadeEnd = R * FADE_END_MUL
    for (const s of slots) {
      if (!s.alive) continue
      s.age += step
      // Empuje propio: decae linealmente hasta apagarse en PUSH_TIME.
      if (s.age < PUSH_TIME) {
        const decay = 1 - s.age / PUSH_TIME
        s.pushX += Math.cos(s.pushAngle) * s.pushSpeed * decay * step
        s.pushZ += Math.sin(s.pushAngle) * s.pushSpeed * decay * step
      }
      // Posición en el mundo: nacimiento + cuánto corrió el sustrato desde
      // entonces + el empujón propio acumulado.
      const wx = s.bx + (subX - s.sbx) * R + s.pushX
      const wz = s.bz + (subZ - s.sbz) * R + s.pushZ
      const dist = Math.hypot(wx, wz)
      if (dist > fadeEnd) { s.alive = false; continue }
      const fade = dist < fadeStart ? 1 : 1 - (dist - fadeStart) / (fadeEnd - fadeStart)
      // `substrate` ya tiene su propio desplazamiento (con wrap, invisible
      // porque su contenido se repite); acá restamos para no aplicarlo dos
      // veces sobre un objeto único que NO puede wrappear sin que se note.
      const lx = wx - substrate.position.x
      const lz = wz - substrate.position.z
      const c = [color[0] * fade, color[1] * fade, color[2] * fade]
      let prev = null
      for (let i = 0; i <= VERTS; i++) {
        const a = (i / VERTS) * TWO_PI
        let r = s.r
        for (const h of s.harm) r += s.r * h.amp * Math.sin(h.k * a + h.phase)
        const x = lx + Math.cos(a) * r, z = lz + Math.sin(a) * r
        if (prev) buf.push(prev[0], 0, prev[1], x, 0, z, c, c)
        prev = [x, z]
      }
    }
    buf.commit()
  }

  return { spawn, update }
}
