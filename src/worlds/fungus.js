import * as THREE from 'three'
import { createStage } from '../render/stage.js'
import { createDraw, createPointCloud, createLineBuffer } from '../render/engine/points.js'
import { createAgentKit } from '../render/engine/agents3d.js'
import { createTrails } from '../render/engine/trails.js'
import { PALETTE } from '../config.js'
import { createSubstrate, resourceAt, consume, decayClass } from '../sim/decay.js'
import { createNetwork, updateNetwork, tipPositions } from '../sim/mycelium.js'
import { createRoamers, updateRoamers } from '../sim/wander.js'
import { noise2 } from '../render/noise.js'

// MUNDO MICELIO — vista cenital de un tramo de tronco podrido colonizado por
// dos hongos en guerra (spec docs/superpowers/specs/2026-08-11-diseno-mundo-micelio.md).
//
// La idea central (spec §0): la estela ES el organismo. La red de `sim/mycelium.js`
// NO es un agente del censo — es el terreno, como la membrana en el mundo célula —
// así que se redibuja entera cada frame desde su propio estado (nodos/aristas
// vivos), sin estelas propias (la red ya es su propia estela).
//
// El tronco (sim/decay.js) es una cápsula 2D (stadium) en el plano x-z: la
// distancia radial al eje clipado a ±logHalfLength decide la capa (corteza/
// albura/duramen). Ese mismo campo de distancia se reutiliza acá para levantar
// un perfil de altura (un semicírculo por distancia radial) — así el tronco
// se lee como un cilindro apoyado en el suelo, no como una textura plana, sin
// tener que inventar una geometría 3D aparte.
//
// Todo lo que decide COMPORTAMIENTO vive en src/sim/* (puro y testeado); este
// archivo solo lo dibuja — igual que cell.js.

const rnd = Math.random

/** Hex de PALETTE → [r,g,b] en 0..1, lo que comen los buffers de línea/punto. */
function rgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
}
function tint(col, k) {
  return [col[0] * k, col[1] * k, col[2] * k]
}

// Paleta del tronco: corteza parda oscura, albura crema, duramen marrón denso
// (spec §2/§10). La hojarasca es un pardo verdoso apagado.
const C_BARK = [0.24, 0.15, 0.09]
const C_SAPWOOD = [0.86, 0.78, 0.56]
const C_HEARTWOOD = [0.40, 0.21, 0.10]
const C_LITTER = [0.42, 0.36, 0.17]
// Musgo (verde húmedo) y liquen (costra gris-verdosa pálida) sobre la corteza,
// como en el tronco escaneado de referencia (GLB).
const C_MOSS = [0.24, 0.44, 0.16]
const C_LICHEN = [0.62, 0.68, 0.55]
// La red: dos micelios reales, no colores de dato. Pleurotus = blanco cálido
// crema (colonia 0); Trametes = gris-azulado pálido (colonia 1). Más orgánico
// que blanco/cian puros.
const C_COLONY = [[1.0, 0.95, 0.82], [0.66, 0.82, 0.86]]
const FAUNA_COLORS = [PALETTE.yellow, PALETTE.orange, PALETTE.bond]

// Cuánto se levanta el tronco en Y por unidad de radio (mundo). Puramente
// estético: sin esto el tronco se lee como una textura plana en vez de un
// cilindro apoyado en el suelo.
// 1.0 = sección semicircular real (la altura del lomo iguala al radio), así el
// tronco se lee como un cilindro acostado y no como un montículo aplastado.
const LOG_HEIGHT_SCALE = 1.0
// Caída a negro en los bordes del disco (coords normalizadas [-1,1]), como
// los otros mundos: se apaga entre estos dos radios normalizados.
const EDGE_FADE_START = 0.86
const EDGE_FADE_END = 1.08
// Cuánto más allá del tronco se busca hojarasca (rejection sampling): más
// ancho que la banda real de decay.js para no dejar huecos por el rechazo.
const LITTER_SEARCH_PAD = 0.4

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

export function createFungusScene(container, cfg, agentNames = []) {
  const R = cfg.world.radius
  const cc = cfg.fungus
  const rc = cfg.render

  const stage = createStage(container, cfg)
  const { scene, camera, controls } = stage
  const draw = createDraw(rc)
  const kit = createAgentKit(rc)

  // Lente macro (spec §1 decisión 2): se sube el DOF falso que ya existe —NO
  // se toca el DOF global de otros mundos— así el fondo se disuelve sin perder
  // el mapa. La auto-rotación queda TAL CUAL la deja el stage: esto no es un
  // microscopio, un tronco sí puede girar lento.
  // Foco EN el tronco (la cámara orbita a ~118) y apertura discreta. Con el
  // foco corto y apertura alta que tenía antes, el tronco entero se convertía
  // en bokeh gigante: se perdía la forma y no se leía como un tronco.
  draw.uniforms.uFocus.value = 115
  draw.uniforms.uAperture.value = 0.12

  // ─── Sustrato: el tronco podrido + su despensa (puro, de sim/decay.js) ────
  const sub = createSubstrate(cc.substrate, rnd)
  const logAx = Math.cos(cc.substrate.logAngle), logAz = Math.sin(cc.substrate.logAngle)
  const logPx = -logAz, logPz = logAx // perpendicular al eje, en el plano x-z
  const halfLen = cc.substrate.logHalfLength
  const logR = cc.substrate.logRadius

  /** Distancia radial de (x,z) al eje del tronco, clipado a ±halfLen — el
   * mismo cálculo (no exportado) que decay.js usa para decidir la capa. */
  function radialToAxis(x, z) {
    const t = Math.max(-halfLen, Math.min(halfLen, x * logAx + z * logAz))
    const cx = logAx * t, cz = logAz * t
    return Math.hypot(x - cx, z - cz)
  }
  /** Perfil de altura del tronco: un semicírculo de radio `logR` sobre la
   * distancia radial al eje — así el borde toca el suelo y la cresta central
   * queda arriba, sea a lo largo del cuerpo o rodeando las puntas redondeadas. */
  function domeHeight(radial) {
    const rr = Math.min(radial, logR)
    return Math.sqrt(Math.max(0, logR * logR - rr * rr)) * R * LOG_HEIGHT_SCALE
  }
  /** Altura de apoyo en (x,z): sobre el tronco sigue su domo; fuera, el suelo.
   * Pasa por (u,v) y usa `surfaceYUV` — la MISMA superficie que dibuja la
   * corteza. Si no, la red se apoyaría en un tronco que ya no existe. */
  function surfaceY(x, z) {
    const u = x * logAx + z * logAz
    const v = x * logPx + z * logPz
    return surfaceYUV(u, v)
  }
  function edgeFade(x, z) {
    const rr = Math.hypot(x, z)
    return clamp01(1 - (rr - EDGE_FADE_START) / (EDGE_FADE_END - EDGE_FADE_START))
  }

  // Un tronco real no es una cápsula lisa: se AHÚSA (una punta más gruesa que la
  // otra) y tiene bultos, nudos y corteza irregular. `logRAt` da el radio local
  // a lo largo del eje; `bump` el relieve de la corteza.
  function logRAt(u) {
    const s = (u / halfLen) * 0.5 + 0.5           // 0 en un extremo, 1 en el otro
    const taper = 1 - s * 0.35                     // se adelgaza hacia +eje
    const knot = 0.08 * noise2(u * 3.1, 1.7)       // nudos/engrosamientos
    return logR * Math.max(0.4, taper + knot)
  }
  /** Silueta IRREGULAR: el borde no es una cápsula perfecta — se muerde con
   * ruido, como el contorno comido de un tronco podrido de verdad. */
  function logEdgeAt(u, side) {
    return logRAt(u) * (0.82 + 0.3 * noise2(u * 4.7 + (side > 0 ? 31 : 61), side * 2.3))
  }
  /** ¿(u,v) cae dentro del tronco, con su borde irregular? */
  function insideLog(u, v) {
    const uc = Math.max(-halfLen, Math.min(halfLen, u))
    const over = u - uc
    if (over !== 0) return Math.hypot(over, v) <= logRAt(uc) // puntas redondeadas
    return Math.abs(v) <= logEdgeAt(u, Math.sign(v) || 1)
  }
  function bump(u, v) {
    return (noise2(u * 2.3 + 5, v * 4.1) - 0.5) * logR * 0.4 * R * LOG_HEIGHT_SCALE
  }
  // Altura de la superficie del tronco en coords (u = a lo largo del eje,
  // v = perpendicular). El domo semicircular por el radio LOCAL + relieve.
  function surfaceYUV(u, v) {
    const uc = Math.max(-halfLen, Math.min(halfLen, u))
    const overEnd = u - uc                 // >0 más allá de la punta redondeada
    const rad = Math.hypot(overEnd, v)
    const lr = logRAt(uc)
    const rr = Math.min(rad, lr)
    const h = Math.sqrt(Math.max(0, lr * lr - rr * rr)) * R * LOG_HEIGHT_SCALE
    return h + (rad < lr ? bump(u, v) : 0)
  }
  function uvToWorld(u, v) {
    return [logAx * u + logPx * v, logAz * u + logPz * v]
  }

  // ─── TRONCO: se ve como un tronco CAÍDO, no como un corte transversal. Desde
  // arriba la superficie es CORTEZA (parda, texturada, con grietas a lo largo);
  // los anillos de crecimiento solo asoman en los EXTREMOS cortados. (Antes las
  // capas de decay.js se pintaban como bandas radiales a lo largo de todo el
  // lomo — leía como mirar por el hueco del tronco.) ────────────────────────
  {
    // (a) Piel de corteza: dither denso y fino de puntos pardos sobre el lomo
    // AHUSADO, con vetas más oscuras en los surcos + parches de MUSGO (verde, en
    // el flanco húmedo) y LIQUEN (costras gris-verdosas) — de la referencia GLB.
    let placed = 0
    const maxAttempts = cc.logDither * 5
    for (let a = 0; a < maxAttempts && placed < cc.logDither; a++) {
      const u = (rnd() * 2 - 1) * (halfLen + logR)
      const uc = Math.max(-halfLen, Math.min(halfLen, u))
      const lr = logRAt(uc)
      const v = (rnd() * 2 - 1) * lr
      if (!insideLog(u, v)) continue
      placed++
      const [x, z] = uvToWorld(u, v)
      const y = surfaceYUV(u, v) + 0.15
      const fade = edgeFade(x, z)
      // Musgo: parches en el flanco -v (húmedo), donde el ruido lo permite.
      const mossN = noise2(u * 1.7 + 20, v * 2.3 + 9)
      const lichenN = noise2(u * 3.3 - 12, v * 3.7 - 4)
      // Corteza DESPRENDIDA: parches donde ya se cayó y asoma la albura clara
      // — el rasgo más característico de un tronco en descomposición.
      const peelN = noise2(u * 2.1 - 40, v * 2.9 + 17)
      let col, size
      if (v < -lr * 0.15 && mossN > 0.62) {
        // Musgo: grumoso y con VOLUMEN (ref. imoss) — el parche no es una mancha
        // plana: cada punto se levanta un poco sobre la corteza y varía de tono,
        // así se lee como cojín y no como pintura.
        const lift = rnd() * rnd() * 1.6
        const tone = 0.55 + rnd() * 0.6
        draw.pushPoint(x * R, y + lift, z * R,
          [C_MOSS[0] * tone * fade, C_MOSS[1] * tone * fade, C_MOSS[2] * tone * fade],
          0.14 + rnd() * 0.22, 0)
        continue
      } else if (peelN > 0.70) {
        col = tint(C_SAPWOOD, (0.55 + rnd() * 0.4) * fade); size = 0.14 + rnd() * 0.16
      } else if (lichenN > 0.72) {
        col = tint(C_LICHEN, (0.7 + rnd() * 0.4) * fade); size = 0.14 + rnd() * 0.16
      } else {
        // Corteza: surcos longitudinales (bandas de v) + variación por punto.
        const furrow = 0.5 + 0.5 * Math.abs(Math.sin(v / lr * 7 + Math.sin(u * 3)))
        const shade = (0.5 + furrow * 0.5) * (0.85 + rnd() * 0.3)
        col = tint(C_BARK, shade * fade); size = 0.13 + rnd() * 0.16
      }
      draw.pushPoint(x * R, y, z * R, col, size, 0)
    }
  }
  {
    // (b) Grietas de la corteza: líneas onduladas a lo largo del eje sobre el lomo.
    const cracks = 26
    for (let c = 0; c < cracks; c++) {
      const v = (rnd() * 2 - 1) * logR * 0.92
      const phase = rnd() * 6.28, amp = logR * 0.06
      let prev = null
      const segs = 22
      for (let i = 0; i <= segs; i++) {
        const u = -halfLen - logR * 0.3 + (2 * halfLen + logR * 0.6) * (i / segs)
        const vv = v + Math.sin(u * 6 + phase) * amp
        if (Math.hypot(Math.max(0, Math.abs(u) - halfLen), vv) > logR * 0.98) { prev = null; continue }
        const [x, z] = uvToWorld(u, vv)
        const y = surfaceYUV(u, vv) + 0.2
        if (prev) draw.pushLine(prev[0] * R, prev[1], prev[2] * R, x * R, y, z * R,
          tint(C_BARK, 0.35 * edgeFade(prev[3], prev[4])), tint(C_BARK, 0.35 * edgeFade(x, z)))
        prev = [x, y, z, x, z]
      }
    }
  }
  {
    // (c) Anillos de crecimiento en los DOS extremos cortados: círculos
    // concéntricos (duramen → albura → corteza) en el disco de la cara cortada,
    // que en la vista 3/4 se leen como los anillos de un tronco.
    const barkStart = logR * (1 - cc.substrate.barkFrac)
    const sapStart = logR * (1 - cc.substrate.barkFrac - cc.substrate.sapwoodFrac)
    const ringColor = (rad) => rad >= barkStart ? C_BARK : rad >= sapStart ? C_SAPWOOD : C_HEARTWOOD
    for (const endU of [-halfLen, halfLen]) {
      const seg = 30
      // Los anillos siguen el radio LOCAL del extremo (el tronco se ahúsa): si
      // usan el radio nominal salen como halos flotando fuera de la madera.
      const endR = logRAt(endU)
      const k = endR / logR
      for (const rad of [endR * 0.94, barkStart * k, ((sapStart + barkStart) / 2) * k, sapStart * k, sapStart * 0.6 * k, sapStart * 0.3 * k]) {
        const col = ringColor(rad + 1e-4)
        let prev = null
        for (let i = 0; i <= seg; i++) {
          const ang = (i / seg) * Math.PI * 2
          // El anillo vive en el plano de la cara (perpendicular al eje): v y ALTURA.
          // El EJE del tronco está a nivel del suelo (y=0) y el lomo sube hasta
          // `domeHeight(0)`. Centrar el anillo en la cresta lo dejaba flotando
          // un radio por encima de la madera, despegado del tronco.
          const v = Math.cos(ang) * rad
          const yr = Math.sin(ang) * rad * R * LOG_HEIGHT_SCALE
          const [x, z] = uvToWorld(endU, v)
          if (prev) draw.pushLine(prev[0] * R, prev[1], prev[2] * R, x * R, Math.max(0, yr), z * R,
            tint(col, 0.8 * edgeFade(x, z)), tint(col, 0.8 * edgeFade(x, z)))
          prev = [x, Math.max(0, yr), z]
        }
      }
    }
  }

  // ─── HOJARASCA: dither disperso fuera del tronco (layer === 'litter') ─────
  {
    const alongHalf = halfLen + logR + LITTER_SEARCH_PAD
    const acrossHalf = logR + LITTER_SEARCH_PAD
    let placed = 0
    const maxAttempts = cc.litter * 6
    for (let a = 0; a < maxAttempts && placed < cc.litter; a++) {
      const u = (rnd() * 2 - 1) * alongHalf
      const v = (rnd() * 2 - 1) * acrossHalf
      const x = logAx * u + logPx * v
      const z = logAz * u + logPz * v
      const res = resourceAt(sub, x, z)
      if (res.layer !== 'litter') continue
      placed++
      const fade = edgeFade(x, z) * (0.7 + rnd() * 0.5)
      draw.pushPoint(x * R, rnd() * 0.6, z * R, tint(C_LITTER, fade), 0.35 + rnd() * 0.35, 0)
    }
  }

  draw.finalizeLines(scene, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }))
  draw.finalizePoints(scene)

  // ─── LA RED (dinámica): sim/mycelium.js, el corazón del mundo (spec §3) ───
  // Dos colonias, arrancando en puntos separados sobre el tronco — Pleurotus
  // (colonia 0) y Trametes (colonia 1). Armillaria queda para una ola futura.
  const seedT = halfLen * 0.5, seedV = logR * 0.5
  const seed0 = { x: logAx * -seedT + logPx * seedV, z: logAz * -seedT + logPz * seedV, colony: 0 }
  const seed1 = { x: logAx * seedT + logPx * -seedV, z: logAz * seedT + logPz * -seedV, colony: 1 }
  const net = createNetwork(cc.mycelium, [seed0, seed1], rnd)
  // El centro de cada colonia (su punto de inoculación): la dirección RADIAL
  // hacia afuera desde ahí es la que da el rosetón plumoso de una placa real.
  const COLONY_SEED = [seed0, seed1]
  // Pre-crecer: el mundo abre con un tronco YA colonizado, no con dos puntas
  // solas que tardarían un minuto en leerse. Se corre la simulación real con un
  // field de humedad plena antes del primer frame (~la mitad del presupuesto).
  {
    const warmField = { resourceAt: (x, z) => Math.min(1, resourceAt(sub, x, z).carbon), moisture: 0.9 }
    for (let i = 0; i < 700; i++) updateNetwork(net, cc.mycelium, 1 / 30, rnd, warmField)
  }

  // Dos registros visuales del micelio (spec §10). La red se dibuja con capacidad
  // para bundlear los cordones (una arista gruesa = varias líneas paralelas), y
  // aparte los frentes plumosos que salen de cada punta.
  // Grosor a partir del cual una arista se dibuja como CORDÓN (haz de 3 hifas).
  // Calibrado contra los valores reales que produce la sim (mediana ≈ 5): con un
  // umbral bajo TODAS las aristas salían bundleadas y desbordaban el buffer.
  const CORD_W = 9
  const netMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })
  // Cada arista se dibuja curva (3 segmentos) y, si es cordón, ×3 hifas.
  const netBuf = createLineBuffer(cc.mycelium.maxEdges * 9, netMat)
  scene.add(netBuf.mesh)
  const frontMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 })
  const FAN = 10                       // hifas finas por punta (el borde plumoso)
  const frontBuf = createLineBuffer(cc.mycelium.maxTips * FAN * 3, frontMat)
  scene.add(frontBuf.mesh)
  const tipsCloud = createPointCloud(cc.mycelium.maxTips, draw.pointMaterial)
  scene.add(tipsCloud.mesh)

  function drawNetwork() {
    netBuf.begin()
    for (const e of net.edges) {
      if (!e.alive) continue
      const a = net.nodes[e.a], b = net.nodes[e.b]
      const base = C_COLONY[e.colony] || C_COLONY[0]
      const ax = a.x * R, az = a.z * R, bx = b.x * R, bz = b.z * R
      const ya = surfaceY(a.x, a.z) + 0.35, yb = surfaceY(b.x, b.z) + 0.35
      const fa = edgeFade(a.x, a.z), fb = edgeFade(b.x, b.z)
      // Las hifas CURVAN: una cuerda recta nodo-a-nodo delata la geometría del
      // grafo. Cada arista se dibuja como una polilínea con una comba lateral
      // estable (derivada de los índices, no aleatoria por frame — si no,
      // temblaría). `arc` da la curvatura en unidades de mundo.
      const dx = bx - ax, dz = bz - az
      const d = Math.hypot(dx, dz) || 1
      const px = -dz / d, pz = dx / d
      const wobble = Math.sin((e.a * 12.9898 + e.b * 78.233) % 6.2832)
      const arc = wobble * d * 0.18
      const SEG = 3
      const curvePt = (s, lateral) => {
        const t = s / SEG
        const bend = Math.sin(t * Math.PI) * arc
        return [
          ax + dx * t + px * (bend + lateral),
          ya + (yb - ya) * t,
          az + dz * t + pz * (bend + lateral),
        ]
      }
      if (e.width >= CORD_W) {
        // CORDÓN (rizomorfo): haz de 3 hifas paralelas curvas, brillante — las
        // "autopistas" que consolidan el territorio ganado.
        const bright = Math.min(1, 0.7 + e.width * 5)
        const off = Math.min(1.6, 0.5 + e.width * 8)
        for (const lat of [-off, 0, off]) {
          for (let s = 0; s < SEG; s++) {
            const p0 = curvePt(s, lat), p1 = curvePt(s + 1, lat)
            netBuf.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2],
              tint(base, fa * bright), tint(base, fb * bright))
          }
        }
      } else {
        // MALLA FINA: la trama difusa entre cordones, tenue y también curva.
        const dim = 0.4 + e.width * 6
        for (let s = 0; s < SEG; s++) {
          const p0 = curvePt(s, 0), p1 = curvePt(s + 1, 0)
          netBuf.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2],
            tint(base, fa * dim), tint(base, fb * dim))
        }
      }
    }
    netBuf.commit()
  }

  // Frente de avance PLUMOSO y RADIAL — el rosetón de una placa de cultivo
  // (referencia del usuario): de cada punta sale un penacho de hifas finas
  // orientadas HACIA AFUERA desde el centro de su colonia, cada una con una
  // bifurcación dicotómica al final (así crecen las hifas de verdad). Es el
  // borde algodonoso que se ve en una placa. Dinámico: se redibuja cada frame.
  function drawFront() {
    frontBuf.begin()
    const step = cc.mycelium.stepLen * R
    for (const t of net.tips) {
      if (!t.alive) continue
      const base = C_COLONY[t.colony] || C_COLONY[0]
      const seed = COLONY_SEED[t.colony] || COLONY_SEED[0]
      // Dirección radial hacia afuera desde el inóculo (da el rosetón); se mezcla
      // con el rumbo real de la punta para que no sea un abanico perfecto.
      const radAng = Math.atan2(t.z - seed.z, t.x - seed.x)
      const baseAng = Math.atan2(
        Math.sin(radAng) * 0.7 + Math.sin(t.ang) * 0.3,
        Math.cos(radAng) * 0.7 + Math.cos(t.ang) * 0.3)
      const fade = edgeFade(t.x, t.z)
      const x0 = t.x * R, z0 = t.z * R, y0 = surfaceY(t.x, t.z) + 0.5
      for (let k = 0; k < FAN; k++) {
        const spread = (k / (FAN - 1) - 0.5) * 1.3   // abanico estrecho, no 360°
        const a = baseAng + spread + (rnd() - 0.5) * 0.25
        const len = (0.7 + rnd() * 0.9) * step
        const mx = x0 + Math.cos(a) * len, mz = z0 + Math.sin(a) * len
        // Tallo de la hifa (más brillante en la base, se apaga hacia la punta).
        frontBuf.push(x0, y0, z0, mx, y0, mz, tint(base, fade * 0.7), tint(base, fade * 0.15))
        // Bifurcación dicotómica: dos ramitas finas abriéndose en la punta.
        const fl = len * 0.55
        for (const s of [-0.4, 0.4]) {
          frontBuf.push(mx, y0, mz,
            mx + Math.cos(a + s) * fl, y0, mz + Math.sin(a + s) * fl,
            tint(base, fade * 0.15), tint(base, 0))
        }
      }
    }
    frontBuf.commit()
  }

  function drawTips() {
    const tp = tipPositions(net)
    for (let i = 0; i < cc.mycelium.maxTips; i++) {
      if (i < tp.length) {
        const t = tp[i]
        const base = C_COLONY[t.colony] || C_COLONY[0]
        // Spitzenkörper: la punta apical brilla (el latido visual del mundo).
        const glow = [
          base[0] + (1 - base[0]) * 0.5,
          base[1] + (1 - base[1]) * 0.5,
          base[2] + (1 - base[2]) * 0.5,
        ]
        const fade = edgeFade(t.x, t.z)
        tipsCloud.pos[i * 3] = t.x * R
        tipsCloud.pos[i * 3 + 1] = surfaceY(t.x, t.z) + 0.6
        tipsCloud.pos[i * 3 + 2] = t.z * R
        tipsCloud.col[i * 3] = glow[0] * fade
        tipsCloud.col[i * 3 + 1] = glow[1] * fade
        tipsCloud.col[i * 3 + 2] = glow[2] * fade
        tipsCloud.size[i] = 0.7
      } else {
        tipsCloud.pos[i * 3 + 1] = -9999 // slot sin punta: aparcado (convención del repo)
      }
    }
    tipsCloud.commit()
  }

  // ─── FAUNA DEL SUELO: los individuos con jaula, nombre y estela ──────────
  // (spec §6): la red NO tiene censo — los ~10 visibles con jaula son los
  // colémbolos/nematodos/ácaros/etc. deambulando por el disco, como en el bosque.
  const faunaAgents = []
  for (let i = 0; i < cc.fauna; i++) {
    const color = FAUNA_COLORS[i % FAUNA_COLORS.length]
    const group = new THREE.Group()
    group.add(kit.boxCage(1.6, 1.1, 1.6, color))
    group.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color })))
    scene.add(group)
    faunaAgents.push({ group })
  }
  const roamers = createRoamers(cfg.wander, cc.fauna, rnd)
  const trails = createTrails(scene, cc.fauna, FAUNA_COLORS, rc, draw.pointMaterial)
  const worldPos = new Float32Array(cc.fauna * 3)

  stage.setResizeHook((m) => {
    draw.uniforms.uProj.value = m.proj
    kit.setResolution(m.w * m.dpr, m.h * m.dpr)
  })

  // ─── Etiqueta flotante: solo al pasar el mouse por encima de un bicho ─────
  // (idéntico a cell.js: deshace la distorsión del fisheye para que el hover
  // matchee lo que se ve).
  const _proj = new THREE.Vector3()
  let _lx = 0, _ly = 0
  let ptrX = null, ptrY = null
  function setPointer(x, y) { ptrX = x; ptrY = y }
  const _fk = Math.min(rc.fisheye, 0.62)
  function lensNDC(px, py) {
    let sx = px, sy = py
    for (let it = 0; it < 3; it++) {
      const rn = Math.hypot(sx, sy) / 0.7071
      const f = (1 - _fk) + _fk * rn * rn
      sx = px / f; sy = py / f
    }
    return [sx, sy]
  }

  let clock = 0

  function update(swarm, dt, eco) {
    const step = dt || 0.016
    clock += step
    draw.uniforms.uT.value = clock

    // Humedad derivada del clima (spec §9): mojado + niebla = crece; seco se
    // frena. El "día" adicional aporta la actividad (crece de noche/al alba).
    const moisture = eco ? clamp01(eco.fog * 0.6 + eco.rain * 0.6) : 0.5
    const activity = eco ? eco.activity : 0.6
    // Nunca del todo cero: hasta en la siesta seca hay un goteo mínimo de
    // crecimiento — lo que se detiene es el ritmo, no la vida.
    const growthMul = Math.max(0.08, moisture * 0.6 + activity * 0.4)

    const field = {
      resourceAt: (x, z) => Math.min(1, resourceAt(sub, x, z).carbon),
      moisture,
    }
    updateNetwork(net, cc.mycelium, step * growthMul, rnd, field)

    // El micelio COME donde tiene puntas: eso agota el sustrato localmente, y
    // el agotamiento es lo que hace que el cordón deje de recibir flujo, se
    // atrofie y se pode — así la red ABANDONA lo exprimido y sigue avanzando.
    // Sin este consumo el recurso era infinito, nada se podaba nunca y la red
    // quedaba congelada al saturar. Es además la premisa del mundo: el terreno
    // es la comida y se acaba.
    for (const t of net.tips) {
      if (t.alive) consume(sub, t.x, t.z, cc.eatRate * step * growthMul)
    }
    drawFront()
    drawTips()

    // ─── Fauna del suelo: deambula libre, contenida en el disco ───────────
    updateRoamers(roamers, cfg.wander, step, rnd, clock)
    for (let i = 0; i < cc.fauna; i++) {
      const r = roamers[i]
      const x = r.x * R, z = r.z * R
      const y = surfaceY(r.x, r.z) + 1.3
      faunaAgents[i].group.position.set(x, y, z)
      const sp = Math.hypot(r.vx, r.vz)
      if (sp > 1e-4) faunaAgents[i].group.rotation.y = Math.atan2(r.vx * R, r.vz * R)
      worldPos[i * 3] = x; worldPos[i * 3 + 1] = y; worldPos[i * 3 + 2] = z
    }
    trails.update(worldPos)

    // Etiqueta: solo al pasar el mouse por encima de un bicho de la fauna.
    let bestI = -1
    if (ptrX !== null) {
      let bestD = 0.14
      for (let i = 0; i < cc.fauna; i++) {
        _proj.set(worldPos[i * 3], worldPos[i * 3 + 1] + 3, worldPos[i * 3 + 2]).project(camera)
        if (_proj.z > 1) continue
        const [vx, vy] = lensNDC(_proj.x, _proj.y)
        const d = Math.hypot(vx - ptrX, vy - ptrY)
        if (d < bestD) { bestD = d; bestI = i; _lx = vx; _ly = vy }
      }
    }
    if (bestI >= 0 && agentNames[bestI]) {
      const { w, h, ox, oy } = stage.metrics
      stage.labelEl.style.left = ox + (_lx * 0.5 + 0.5) * w + 'px'
      stage.labelEl.style.top = oy + (-_ly * 0.5 + 0.5) * h + 'px'
      stage.labelEl.textContent = agentNames[bestI]
      stage.labelEl.style.opacity = '1'
    } else {
      stage.labelEl.style.opacity = '0'
    }

    // La niebla se espesa con el medio, igual que en los otros mundos.
    if (eco) scene.fog.density = 0.0009 + eco.fog * 0.0022

    stage.render(step)
    // Los eventos narrados grandes (fusión, trampa de nematodo, fructificación,
    // …) son de la Ola D: por ahora este mundo no reporta nada al log.
    return []
  }

  /** Sacude a la fauna del suelo (mismo patrón que los demás mundos). */
  function scare(strength = 1) {
    for (const r of roamers) {
      const m = Math.hypot(r.x, r.z) || 1e-3
      const k = (0.5 + Math.random() * 0.8) * strength
      r.vx += (r.x / m) * k + (Math.random() - 0.5) * k
      r.vz += (r.z / m) * k + (Math.random() - 0.5) * k
    }
  }

  return {
    update, scare, setPointer,
    resize: stage.resize, flash: stage.flash, dispose: stage.dispose,
  }
}
