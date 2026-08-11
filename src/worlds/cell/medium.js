import * as THREE from 'three'
import { createPointCloud, createLineBuffer } from '../../render/engine/points.js'

// M7 — Que el medio se vea: hoy los 6 medios de CELL_PROFILE (eco.weather)
// pintan la célula igual. `mediumMods` traduce el medio a un puñado de
// números que el resto del mundo YA sabe usar (más blebbing, menos ATP,
// invasores más seguido); `createMediumEffects` es lo que necesita
// geometría propia (ROS, autofagosomas).

const ROS_CAP = 24
const ROS_SPAWN_R = 1.5     // normalizado: fuera del radio máximo posible de la membrana
const ROS_SPEED = 0.55      // normalizado/s, entra en línea recta hacia el centro
const ROS_POP_TTL = 0.18    // duración del pop al llegar a la membrana
const ROS_MAX_RATE = 7      // como mucho, ROS/seg (con rosDensity=1)
const AUTO_CAP = 2
const AUTO_SPEED = 0.05     // normalizado/s, deriva hacia adentro
const AUTO_RING_SEGS = 10
const AUTO_SPAWN_CHANCE = 0.15 // por segundo, mientras haya slots libres
const C_ROS = [1, 0.22, 0.16]    // rojizo: PALETTE no trae rojo puro
const C_AUTO = [0.7, 0.82, 0.5]  // verdoso apagado: distinto del lisosoma rosado

const TWO_PI = Math.PI * 2

/**
 * Modificadores por medio: puro, sin three/DOM. `weather` es `eco.weather`
 * (una de CELL_MEDIA); `rain` es `eco.rain` (ya sube a 0.55 en oxidative stress).
 */
export function mediumMods(weather, rain = 0) {
  const base = { rosDensity: 0, blebBoost: 0, atpProdMul: 1, spawnEveryMul: 1, mitoDim: 0, tint: 0, autophago: false }
  switch (weather) {
    case 'oxidative stress': return { ...base, rosDensity: rain }
    case 'serum starved': return { ...base, atpProdMul: 0.4, autophago: true }
    case 'acidic': return { ...base, blebBoost: 0.35, tint: 1 }
    case 'hypoxic': return { ...base, atpProdMul: 0.4, mitoDim: 0.6 }
    case 'inflamed': return { ...base, spawnEveryMul: 0.5 }
    default: return base // 'nutrient rich': todo al máximo, es la línea base
  }
}

/**
 * @param {object} p
 * @param {THREE.Scene} p.scene
 * @param {THREE.Material} p.pointMaterial
 * @param {number} p.R  radio de mundo
 * @param {number} p.H  altura de la lámina celular
 * @param {object} p.membrane  el objeto vivo de sim/membrane.js (se lee cada frame)
 * @param {function} p.radiusAt
 * @param {function} p.rnd
 */
export function createMediumEffects({ scene, pointMaterial, R, H, membrane, radiusAt, rnd }) {
  // ── ROS (oxidative stress): entran en línea recta y hacen un pop corto
  // al llegar a la membrana. Densidad ∝ rosDensity (≈ eco.rain del medio).
  const rosCloud = createPointCloud(ROS_CAP, pointMaterial)
  const ros = Array.from({ length: ROS_CAP }, () => ({ active: false, ang: 0, r: 0, popT: -1 }))
  for (let i = 0; i < ROS_CAP; i++) {
    rosCloud.col[i * 3] = C_ROS[0]; rosCloud.col[i * 3 + 1] = C_ROS[1]; rosCloud.col[i * 3 + 2] = C_ROS[2]
  }
  scene.add(rosCloud.mesh)

  // ── Autofagosomas (serum starved): marcadores de doble anillo que derivan
  // hacia adentro. Paisaje simple: no buscan lisosoma, solo migran y se apagan.
  const autoMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6 })
  const autoBuf = createLineBuffer(AUTO_CAP * 2 * AUTO_RING_SEGS, autoMat)
  scene.add(autoBuf.mesh)
  const autos = Array.from({ length: AUTO_CAP }, () => ({ active: false, ang: 0, r: 0 }))

  function updateROS(step, mods) {
    if (mods.rosDensity > 0 && rnd() < ROS_MAX_RATE * mods.rosDensity * step) {
      for (const p of ros) {
        if (!p.active) { p.active = true; p.ang = rnd() * TWO_PI; p.r = ROS_SPAWN_R; p.popT = -1; break }
      }
    }
    for (let i = 0; i < ROS_CAP; i++) {
      const p = ros[i]
      if (!p.active) { rosCloud.pos[i * 3 + 1] = -9999; rosCloud.size[i] = 0; continue }
      if (p.popT < 0) {
        p.r -= ROS_SPEED * step
        rosCloud.pos[i * 3] = Math.cos(p.ang) * p.r * R
        rosCloud.pos[i * 3 + 1] = H * 0.5
        rosCloud.pos[i * 3 + 2] = Math.sin(p.ang) * p.r * R
        rosCloud.size[i] = 0.55
        if (p.r <= radiusAt(membrane, p.ang)) p.popT = 0 // llegó a la membrana: empieza el pop
      } else {
        p.popT += step
        const u = p.popT / ROS_POP_TTL
        rosCloud.size[i] = Math.max(0, 1 - u) * 2.0
        if (u >= 1) p.active = false
      }
    }
    rosCloud.commit()
  }

  function updateAutophago(step, mods) {
    if (mods.autophago) {
      for (const a of autos) {
        if (!a.active && rnd() < AUTO_SPAWN_CHANCE * step) { a.active = true; a.ang = rnd() * TWO_PI; a.r = 0.9; break }
      }
    } else {
      // Fuera de serum starved no quedan autofagosomas dando vueltas.
      for (const a of autos) a.active = false
    }
    autoBuf.begin()
    for (const a of autos) {
      if (!a.active) continue
      a.r -= AUTO_SPEED * step
      if (a.r < 0.08) { a.active = false; continue }
      const cx = Math.cos(a.ang) * a.r * R, cz = Math.sin(a.ang) * a.r * R
      for (const rr of [1.1, 0.65]) { // doble anillo: uno grande y uno chico adentro
        for (let s = 0; s < AUTO_RING_SEGS; s++) {
          const a0 = (s / AUTO_RING_SEGS) * TWO_PI, a1 = ((s + 1) / AUTO_RING_SEGS) * TWO_PI
          autoBuf.push(
            cx + Math.cos(a0) * rr, H * 0.4, cz + Math.sin(a0) * rr,
            cx + Math.cos(a1) * rr, H * 0.4, cz + Math.sin(a1) * rr,
            C_AUTO, C_AUTO,
          )
        }
      }
    }
    autoBuf.commit()
  }

  /** @param {ReturnType<typeof mediumMods>} mods */
  function update(step, mods) {
    updateROS(step, mods)
    updateAutophago(step, mods)
  }

  return { update }
}
