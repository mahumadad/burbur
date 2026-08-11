import * as THREE from 'three'
import { createStage } from '../render/stage.js'
import { createDraw, createPointCloud, createLineBuffer } from '../render/engine/points.js'
import { createAgentKit } from '../render/engine/agents3d.js'
import { createTrails } from '../render/engine/trails.js'
import { PALETTE } from '../config.js'
import { createSubstrate, resourceAt, consume, decayClass } from '../sim/decay.js'
import { createNetwork, updateNetwork, tipPositions } from '../sim/mycelium.js'
import { createFruiting, updateFruiting } from '../sim/fruiting.js'
import { createRoamers, updateRoamers } from '../sim/wander.js'
import { noise2 } from '../render/noise.js'
import { barkCell } from '../render/bark.js'

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
  /** Eje CURVO del tronco (arco de círculo): centerline(u) y su perpendicular.
   * En u=0 coincide con el eje recto (logAx/logPx); al alejarse, el tangente
   * rota `k` rad por unidad → tronco curvo tipo banana. */
  const k = cc.substrate.logCurve || 0
  const baseA = cc.substrate.logAngle
  const archAmp = cc.substrate.logArch || 0
  const buryAmp = cc.substrate.logBury || 0
  const liftAmp = cc.substrate.logLift || 0
  const sink = cc.substrate.logSink || 0   // fracción del radio enterrada
  function centerX(u) { return k ? (Math.sin(baseA + k * u) - Math.sin(baseA)) / k : logAx * u }
  function centerZ(u) { return k ? (Math.cos(baseA) - Math.cos(baseA + k * u)) / k : logAz * u }
  /** Arco vertical del eje: el CENTRO se eleva (guata hacia arriba) y las puntas
   * son ASIMÉTRICAS — la punta QUEBRADA (-u) se hunde bajo el suelo (-buryAmp),
   * la punta CORTADA (+u) se LEVANTA (+liftAmp) para que su disco de anillos
   * apoye entero sobre la tierra y se vea. En unidades de MUNDO. */
  function centerY(u) {
    const t = u / halfLen
    const end = t < 0 ? -buryAmp * t * t : liftAmp * t * t
    return (archAmp * (1 - t * t) + end) * R * LOG_HEIGHT_SCALE
  }
  function perpX(u) { return -Math.sin(baseA + k * u) }
  function perpZ(u) { return Math.cos(baseA + k * u) }
  /** El punto más cercano del eje curvo a (x,z): devuelve [u, v] (v = offset
   * perpendicular con signo). Búsqueda numérica gruesa + refinamiento — barata
   * y robusta, evita invertir el arco analíticamente. */
  function worldToUV(x, z) {
    const lo = -halfLen - logR, hi = halfLen + logR
    let bestU = 0, bestD = Infinity
    const N = 48
    for (let i = 0; i <= N; i++) {
      const u = lo + (hi - lo) * (i / N)
      const dx = x - centerX(u), dz = z - centerZ(u)
      const d = dx * dx + dz * dz
      if (d < bestD) { bestD = d; bestU = u }
    }
    let step = (hi - lo) / N
    for (let it = 0; it < 4; it++) {
      step *= 0.5
      for (const s of [-step, step]) {
        const u = bestU + s
        const dx = x - centerX(u), dz = z - centerZ(u)
        const d = dx * dx + dz * dz
        if (d < bestD) { bestD = d; bestU = u }
      }
    }
    const v = (x - centerX(bestU)) * perpX(bestU) + (z - centerZ(bestU)) * perpZ(bestU)
    return [bestU, v]
  }
  /** Altura de apoyo en (x,z): sobre el tronco sigue su domo; fuera, el suelo.
   * Pasa por (u,v) del eje CURVO y usa `surfaceYUV` — la MISMA superficie que
   * dibuja la corteza. Si no, la red se apoyaría en un tronco que ya no existe. */
  function surfaceY(x, z, side = 1) {
    const [u, v] = worldToUV(x, z)
    return surfaceYUV(u, v, side)
  }
  /** Altura por la que CAMINA la red sobre el tronco — no es la superficie
   * geométrica, es la superficie DESPLEGADA: la que recorre una hifa que baja
   * pegada a la corteza desde el lomo hasta la tierra.
   *
   * La diferencia importa. El tronco es un cilindro hundido: en planta, su
   * borde es el ECUADOR, y ahí la superficie real está a ~15 unidades de altura
   * mientras que un milímetro más afuera ya es suelo. Con la superficie cruda
   * ese acantilado hace que la hifa que cruza el canto se dibuje como una recta
   * cayendo por el aire — el micelio "se caía del árbol". Desplegando la sección
   * (el radio en planta se reparte sobre el ARCO del tubo, del lomo al punto
   * donde toca tierra) la altura baja de forma continua hasta 0 justo en el
   * borde, y el mismo trazo se lee bordeando el flanco. */
  function drapeYUV(u, v, side) {
    if (u > halfLen) return 0
    const uc = Math.max(-halfLen, u)
    const rad = Math.hypot(u - uc, v)
    const lr = logRAt(uc)
    if (rad >= lr) return 0                       // tierra
    const A = lr * (1 - sink) * R * LOG_HEIGHT_SCALE + centerY(u)  // eje sobre el suelo
    const RR = lr * R * LOG_HEIGHT_SCALE
    const t = rad / lr
    // La sección circular REAL, sin trucos: el lomo baja del domo al ecuador, y
    // la panza sube del punto más bajo al mismo ecuador. Las dos caras valen lo
    // mismo en el canto (t=1), así que envolver por el flanco es continuo.
    // Antes esto forzaba un descenso hasta el suelo en la franja exterior: eso
    // era una PARED de ~22 unidades en 2 de ancho, y la hifa que la cruzaba se
    // leía como un hilo colgando. Ya no hay que cruzarla: `soilContactXZ` sólo
    // deja pasar a la tierra donde el tronco la toca de verdad.
    const dome = RR * Math.sqrt(Math.max(0, 1 - t * t))
    // Donde la panza queda enterrada, lo que hay ahí es suelo.
    return Math.max(0, side < 0 ? A - dome : A + dome)
  }

  // ─── MAPA DE ALTURAS (LUT). Evaluar el drape muchas veces por arista exige
  // `worldToUV`, que es una búsqueda numérica (≈57 distancias por llamada) y no
  // se puede pagar por muestra. Se precalcula una grilla —una capa para el LOMO
  // y otra para la PANZA— y se muestrea bilineal.
  const HN = 192, HSPAN = 1.08
  const hTop = new Float32Array(HN * HN)
  const hBot = new Float32Array(HN * HN)
  for (let j = 0; j < HN; j++) {
    const z = -HSPAN + (2 * HSPAN) * (j / (HN - 1))
    for (let i = 0; i < HN; i++) {
      const x = -HSPAN + (2 * HSPAN) * (i / (HN - 1))
      const [u, v] = worldToUV(x, z)
      hTop[j * HN + i] = drapeYUV(u, v, 1)
      hBot[j * HN + i] = drapeYUV(u, v, -1)
    }
  }
  function sampleH(x, z, side) {
    const g = side < 0 ? hBot : hTop
    const fx = ((x + HSPAN) / (2 * HSPAN)) * (HN - 1)
    const fz = ((z + HSPAN) / (2 * HSPAN)) * (HN - 1)
    if (!(fx >= 0 && fz >= 0 && fx <= HN - 1 && fz <= HN - 1)) return 0
    const i0 = Math.floor(fx), j0 = Math.floor(fz)
    const i1 = Math.min(HN - 1, i0 + 1), j1 = Math.min(HN - 1, j0 + 1)
    const tx = fx - i0, tz = fz - j0
    const a = g[j0 * HN + i0], b = g[j0 * HN + i1]
    const c = g[j1 * HN + i0], d = g[j1 * HN + i1]
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz
  }
  /** Altura a la que se dibuja un nodo o punta de la red: pegada a la cara del
   * tronco que le toca (lomo o panza) y nunca bajo tierra. Donde la panza está
   * enterrada la altura de apoyo es 0 y la hifa queda a ras del suelo — que es
   * exactamente donde está: comiéndose el tronco por abajo, contra la tierra. */
  function netY(x, z, side) {
    const s = sampleH(x, z, side || 1)
    return s <= 0.01 ? 0.9 : Math.max(0.4, s + 1.3 * (side || 1))
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
  /** ¿(u,v) cae dentro del tronco, con su borde irregular? La punta +u está
   * CORTADA (cara plana: más allá de halfLen no hay tronco) y la -u QUEBRADA,
   * que se redondea al hundirse. */
  function insideLog(u, v) {
    if (u > halfLen) return false
    if (u < -halfLen) return Math.hypot(u + halfLen, v) <= logRAt(-halfLen)
    return Math.abs(v) <= logEdgeAt(u, Math.sign(v) || 1)
  }
  function bump(u, v) {
    // Relieve SUTIL: antes era enorme (±4 unidades) y la superficie se plegaba
    // sobre sí misma, dejando huecos negros vistos en ángulo. Ahora es un
    // rugoso leve de corteza, no montañas.
    return (noise2(u * 2.3 + 5, v * 4.1) - 0.5) * logR * 0.09 * R * LOG_HEIGHT_SCALE
  }
  // Altura de apoyo sobre el tronco en (u, v) para el lado `side`: +1 = LOMO
  // (mitad de arriba), -1 = PANZA (mitad de abajo). El tronco es un cilindro
  // completo hundido en el suelo, así que la panza solo asoma donde el arco lo
  // despega de la tierra; donde está enterrada, lo que hay es suelo.
  //
  // FUERA de la huella del tronco devuelve SUELO. Antes devolvía la altura del
  // EJE para cualquier punto fuera del radio, así que todo el terreno alrededor
  // quedaba levantado ~15 unidades siguiendo el arco: la red entera flotaba en
  // el aire con la forma del eje del tronco.
  function surfaceYUV(u, v, side = 1) {
    if (u > halfLen) return 0            // más allá de la cara CORTADA es suelo
    const uc = Math.max(-halfLen, u)
    const overEnd = u - uc               // solo la punta quebrada se redondea
    const rad = Math.hypot(overEnd, v)
    const lr = logRAt(uc)
    if (rad >= lr) return 0              // fuera de la huella: suelo
    const axisY = lr * (1 - sink) * R * LOG_HEIGHT_SCALE   // hundido en el suelo
    const half = Math.sqrt(lr * lr - rad * rad) * R * LOG_HEIGHT_SCALE
    return Math.max(0, axisY + centerY(u) + side * (half + bump(u, v)))
  }
  function uvToWorld(u, v) {
    return [centerX(u) + perpX(u) * v, centerZ(u) + perpZ(u) * v]
  }
  /** ¿(x,z) cae sobre el tronco? Es lo que le dice a la red dónde termina la
   * madera y empieza la tierra. */
  function onLogXZ(x, z) {
    const [u, v] = worldToUV(x, z)
    return insideLog(u, v)
  }
  /** ¿El tronco TOCA la tierra a la altura de (x,z)? El tronco es un cilindro
   * apoyado: sólo donde su panza llega a y=0 hay contacto, y sólo ahí una hifa
   * puede pasar de la madera al suelo. En el resto el flanco es una pared y la
   * hifa no baja: sigue bordeando el tronco por abajo hasta encontrar contacto.
   * (Con el arco actual el centro NO toca; el contacto está hacia las puntas.) */
  function soilContactXZ(x, z) {
    const [u] = worldToUV(x, z)
    const uc = Math.max(-halfLen, Math.min(halfLen, u))
    const lr = logRAt(uc)
    const axisAbove = lr * (1 - sink) * R * LOG_HEIGHT_SCALE + centerY(u)
    return axisAbove <= lr * R * LOG_HEIGHT_SCALE
  }

  // ─── CORTEZA DE PLACAS. La corteza de un tronco viejo no son surcos
  // paralelos: son PLACAS poligonales irregulares separadas por fisuras hondas
  // casi negras, con motas anaranjadas donde la placa se descascara (fotos de
  // referencia). La técnica es la de alikim (docs/tronco-musgo.md): NO hay imagen
  // de textura — la textura la hace la LUZ sobre la geometría rugosa. Por eso el
  // relieve muerde el radio de verdad y las normales se perturban a mano. ─────
  const C_PLATE = [0.46, 0.44, 0.40]   // cara de la placa (gris apenas pardo)
  const C_RIM = [0.21, 0.20, 0.18]     // borde de la placa, ya en penumbra
  const C_FISS = [0.05, 0.045, 0.04]   // fisura: casi negro
  const C_FLECK = [0.46, 0.26, 0.12]   // descascarado anaranjado
  const C_HEART = [0.42, 0.28, 0.16]   // duramen: centro más oscuro y rojizo
  const C_SPLINTER = [0.78, 0.68, 0.48]   // albura fresca del quiebre
  const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

  /** Relieve + albedo de la corteza en (u, θ). `k` multiplica el radio: las
   * placas sobresalen y las fisuras muerden hacia adentro, así el CONTORNO sale
   * dentado y no un chorizo liso. */
  function barkAt(u, th, around, along) {
    const { edge, id } = barkCell(u, th, around, along)
    // Rampa CORTA: la placa llega enseguida a su altura plena y se queda plana,
    // y la caída a la fisura es un tajo. Con una rampa larga las placas salían
    // abombadas como escamas de piña, no como placas partidas.
    const plate = smoothstep(0, 0.22, edge)
    const grain = noise2(u * 24, th * 3.1)         // veta a lo largo del eje
    const micro = noise2(u * 68 + 9, th * 13)      // grano fino
    const k = 1 + 0.05 * plate - 0.21 * (1 - plate)
      + 0.045 * (id - 0.5) * plate                 // cada placa a distinta altura
      + 0.025 * (grain - 0.5) + 0.022 * (micro - 0.5)
    let c = mix3(C_FISS, C_RIM, smoothstep(0, 0.14, edge))
    c = mix3(c, C_PLATE, smoothstep(0.14, 0.45, edge))
    const tone = 0.76 + 0.44 * id                  // unas placas más claras que otras
    c = [c[0] * tone, c[1] * tone * 0.99, c[2] * tone * 0.96]
    const fleck = noise2(u * 38 + id * 60, th * 7.5)
    if (fleck > 0.78) c = mix3(c, C_FLECK, plate * (fleck - 0.78) * 1.6)
    const ao = (0.28 + 0.72 * plate) * (0.88 + 0.12 * micro)
    return { k, col: [c[0] * ao, c[1] * ao, c[2] * ao] }
  }
  /** Perturbación de la NORMAL (el `noiseNor` de la receta): coherente a escala
   * micro, así el sombreado se vuelve rugoso sin agregar un solo polígono. */
  function barkJitter(u, th) {
    return [
      noise2(u * 55, th * 11) - 0.5,
      noise2(u * 55 + 17, th * 11 + 5) - 0.5,
      noise2(u * 55 + 41, th * 11 + 23) - 0.5,
    ]
  }

  // Todo lo leñoso —tronco, ramas, discos de anillos, astillas— va a la MISMA
  // malla iluminada: una sola geometría, un solo material, una sola luz.
  const wPos = [], wCol = [], wJit = [], wIdx = []
  function wVert(x, y, z, c, jit) {
    wPos.push(x, y, z)
    wCol.push(c[0], c[1], c[2])
    wJit.push(jit ? jit[0] : 0, jit ? jit[1] : 0, jit ? jit[2] : 0)
    return wPos.length / 3 - 1
  }
  function wQuad(a, b, c, d) { wIdx.push(a, b, c, b, d, c) }

  /** Tubo de corteza sobre un eje arbitrario. `axis(u)` da el punto del eje en
   * MUNDO y `dirP/dirQ(u)` los dos ejes unitarios de la sección; `rad(u)` el
   * radio. Devuelve la última corona de vértices, para taparla. */
  function pushBarkTube({ u0, u1, NU, NA, axis, dirP, dirQ, rad, around, along }) {
    const rings = []
    for (let i = 0; i <= NU; i++) {
      const u = u0 + (u1 - u0) * (i / NU)
      const [cx, cy, cz] = axis(u)
      const [px, py, pz] = dirP(u)
      const [qx, qy, qz] = dirQ(u)
      const r0 = rad(u)
      const row = []
      for (let a = 0; a < NA; a++) {
        const th = (a / NA) * Math.PI * 2
        const b = barkAt(u, th, around, along)
        const rr = r0 * b.k
        const st = Math.sin(th) * rr, ct = Math.cos(th) * rr
        row.push(wVert(cx + px * st + qx * ct, cy + py * st + qy * ct, cz + pz * st + qz * ct,
          b.col, barkJitter(u, th)))
      }
      rings.push(row)
    }
    for (let i = 0; i < NU; i++) {
      for (let a = 0; a < NA; a++) {
        const b = (a + 1) % NA
        wQuad(rings[i][a], rings[i + 1][a], rings[i][b], rings[i + 1][b])
      }
    }
    return rings[rings.length - 1]
  }

  /** Cara CORTADA: el disco de anillos de crecimiento. Albura crema afuera,
   * duramen oscuro al centro, anillos concéntricos de espaciado irregular y
   * veta radial — el rasgo que define un tronco serruchado. */
  function pushRingDisc({ cx, cy, cz, dirP, dirQ, nrm, rimR, NRAD, NA, rings, seed, relief }) {
    const face = (t, th) => {
      // La cara no es un plano perfecto: la sierra deja ondulación, y esa
      // ondulación es lo que le da algo a la luz para agarrarse. La parte
      // angular tiene que ser PERIÓDICA en θ (senos de múltiplos enteros): con
      // ruido crudo la cara se partía en gajos y el disco se leía como flor.
      const d = ((noise2(t * 7 + seed, 0.5) - 0.5) + 0.35 * Math.sin(th * 5 + t * 11 + seed)) * relief
      const r = rimR(th) * t
      const st = Math.sin(th) * r, ct = Math.cos(th) * r
      return [cx + dirP[0] * st + dirQ[0] * ct + nrm[0] * d,
        cy + dirP[1] * st + dirQ[1] * ct + nrm[1] * d,
        cz + dirP[2] * st + dirQ[2] * ct + nrm[2] * d]
    }
    const shade = (t, th) => {
      let c = mix3(C_HEART, C_SAPWOOD, smoothstep(0.05, 0.55, t))
      // Anillos de crecimiento: MUCHAS bandas finas por radio (un tronco tiene
      // decenas), con el espaciado modulado por ruido — no son equidistantes.
      const band = 0.5 + 0.5 * Math.sin(t * rings + noise2(t * 5 + seed, 0.5) * 9)
      c = tint(c, 0.76 + 0.3 * band)
      // Veta radial: estrías finas del centro hacia la corteza. Periódica en θ.
      const ray = 0.5 + 0.5 * Math.sin(th * 47 + Math.sin(th * 9 + seed) * 3)
      c = tint(c, 0.92 + 0.12 * ray)
      // El borde se apaga hacia la corteza que orla el corte.
      return mix3(c, C_RIM, smoothstep(0.88, 1, t))
    }
    const center = wVert(...face(0, 0), shade(0, 0))
    let prev = null
    for (let i = 1; i <= NRAD; i++) {
      const t = i / NRAD
      const row = []
      for (let a = 0; a < NA; a++) {
        const th = (a / NA) * Math.PI * 2
        row.push(wVert(...face(t, th), shade(t, th)))
      }
      for (let a = 0; a < NA; a++) {
        const b = (a + 1) % NA
        if (prev) wQuad(prev[a], row[a], prev[b], row[b])
        else wIdx.push(center, row[a], row[b])
      }
      prev = row
    }
  }

  /** Astilla: pirámide de 3 caras, ancha en la base y afilada en la punta.
   * Madera clara — es albura fresca del quiebre, no corteza. */
  function pushSplinter(bx, by, bz, dx, dy, dz, wid, cBase, cTip) {
    const len = Math.hypot(dx, dy, dz) || 1
    const ux = dx / len, uy = dy / len, uz = dz / len
    // Dos perpendiculares a la dirección de la astilla.
    let ax = 0, ay = 1, az = 0
    if (Math.abs(uy) > 0.9) { ax = 1; ay = 0 }
    let e1x = uy * az - uz * ay, e1y = uz * ax - ux * az, e1z = ux * ay - uy * ax
    const e1n = Math.hypot(e1x, e1y, e1z) || 1
    e1x /= e1n; e1y /= e1n; e1z /= e1n
    const e2x = uy * e1z - uz * e1y, e2y = uz * e1x - ux * e1z, e2z = ux * e1y - uy * e1x
    const base = []
    for (let i = 0; i < 3; i++) {
      const an = (i / 3) * Math.PI * 2 + rnd()
      const w = wid * (0.6 + rnd() * 0.8)
      const c = Math.cos(an) * w, s = Math.sin(an) * w
      base.push(wVert(bx + e1x * c + e2x * s, by + e1y * c + e2y * s, bz + e1z * c + e2z * s, cBase))
    }
    const tip = wVert(bx + dx, by + dy, bz + dz, cTip)
    wIdx.push(base[0], base[1], tip, base[1], base[2], tip, base[2], base[0], tip)
  }

  // ─── TRONCO: tubo completo sobre el eje curvo. Punta -u QUEBRADA (redondeada,
  // hundiéndose en la tierra); punta +u CORTADA (cara plana con anillos). ─────
  // Placas CHICAS: en las fotos hay decenas dando la vuelta, no una docena de
  // escamas grandes. La malla tiene que dar para que la fisura tenga ancho.
  const BARK_AROUND = 28, BARK_ALONG = 16
  const axisYAt = (u) => logRAt(Math.max(-halfLen, Math.min(halfLen, u))) * (1 - sink) * R * LOG_HEIGHT_SCALE
  const logAxis = (u) => [centerX(u) * R, axisYAt(u) + centerY(u), centerZ(u) * R]
  const logDirP = (u) => [perpX(u), 0, perpZ(u)]
  const logDirQ = () => [0, 1, 0]
  /** Radio del tubo: se redondea SOLO en la punta quebrada; la cortada termina
   * plana en halfLen. */
  function logTubeR(u) {
    const over = Math.max(0, -halfLen - u)
    const cap = Math.sqrt(Math.max(0, 1 - (over / logR) * (over / logR)))
    return logRAt(Math.max(-halfLen, Math.min(halfLen, u))) * cap * R
  }
  {
    pushBarkTube({
      u0: -halfLen - logR, u1: halfLen, NU: 340, NA: 176,
      axis: logAxis, dirP: logDirP, dirQ: logDirQ, rad: logTubeR,
      around: BARK_AROUND, along: BARK_ALONG,
    })
  }

  // ─── PUNTA CORTADA (+u): el disco de anillos, orlado por la corteza dentada
  // que sobresale del corte. `cutFace` queda a mano porque la cara también se
  // coloniza: es madera fresca expuesta, lo primero que se come el hongo. ────
  const cutFace = {}
  {
    const uEnd = halfLen
    const [cx, cy, cz] = logAxis(uEnd)
    const p = logDirP(uEnd), q = logDirQ()
    // Tangente del eje en la cara: la normal del corte.
    const [ax, ay, az] = logAxis(uEnd - 0.004)
    let nx = cx - ax, ny = cy - ay, nz = cz - az
    const nn = Math.hypot(nx, ny, nz) || 1
    nx /= nn; ny /= nn; nz /= nn
    const rimR = (th) => logTubeR(uEnd) * barkAt(uEnd, th, BARK_AROUND, BARK_ALONG).k
    Object.assign(cutFace, { c: [cx, cy, cz], p, q, n: [nx, ny, nz], rimR })
    pushRingDisc({
      cx: cx + nx * 0.3, cy: cy + ny * 0.3, cz: cz + nz * 0.3,
      dirP: p, dirQ: q, nrm: [nx, ny, nz],
      // NRAD alto: con pocos pasos radiales no se pueden resolver los anillos
      // (quedaban 6 bandas gordas en vez de las decenas finas de la referencia).
      rimR, NRAD: 96, NA: 176, rings: 155, seed: 3.7, relief: 0.35,
    })
    // Orla dentada: la corteza no se corta limpia, sobresale en dientes CHICOS
    // pegados al borde — si son largos el disco se lee como una flor, no como
    // un corte de sierra.
    for (let i = 0; i < 70; i++) {
      const th = rnd() * Math.PI * 2
      const r = rimR(th) * (0.94 + rnd() * 0.08)
      const st = Math.sin(th) * r, ct = Math.cos(th) * r
      const bx = cx + p[0] * st + q[0] * ct, by = cy + p[1] * st + q[1] * ct, bz = cz + p[2] * st + q[2] * ct
      if (by < 0.5) continue
      const len = 0.8 + rnd() * rnd() * 2.2
      const out = 0.5 + rnd() * 0.6
      pushSplinter(bx, by, bz,
        nx * len + (p[0] * st + q[0] * ct) / r * len * out,
        ny * len + (p[1] * st + q[1] * ct) / r * len * out,
        nz * len + (p[2] * st + q[2] * ct) / r * len * out,
        0.35 + rnd() * 0.4, tint(C_RIM, 1.2), tint(C_RIM, 0.5))
    }
  }

  // ─── PUNTA QUEBRADA (-u): el tronco no está serruchado de este lado, está
  // PARTIDO — astillas de albura clara apuntando afuera y arriba mientras se
  // hunde en la tierra. Solo en el arco que queda SOBRE el suelo: la mitad de
  // abajo está enterrada y ahí no se vería nada. ─────────────────────────────
  {
    let placed = 0
    for (let a = 0; a < 900 && placed < 46; a++) {
      // La base va SOBRE la superficie del tubo, cerca del extremo. Naciendo más
      // adentro las astillas quedaban enterradas dentro de la propia geometría
      // del tronco (el tubo sigue hasta -halfLen-logR) y no se veía ninguna.
      const uS = -halfLen - logR * (0.5 + rnd() * 0.45)
      const [cx, cy, cz] = logAxis(uS)
      const p = logDirP(uS), q = logDirQ()
      const [bxx, byy, bzz] = logAxis(uS + 0.004)
      let nx = cx - bxx, ny = cy - byy, nz = cz - bzz
      const nn = Math.hypot(nx, ny, nz) || 1
      nx /= nn; ny /= nn; nz /= nn
      const th = rnd() * Math.PI * 2
      const r = logTubeR(uS) * 0.95
      const rx = p[0] * Math.sin(th) + q[0] * Math.cos(th)
      const ry = p[1] * Math.sin(th) + q[1] * Math.cos(th)
      const rz = p[2] * Math.sin(th) + q[2] * Math.cos(th)
      const bx = cx + rx * r, by = cy + ry * r, bz = cz + rz * r
      if (by < 1.5) continue                       // enterrada: no se vería
      placed++
      // Sale a lo largo del eje (hacia afuera del tronco) abriéndose en abanico
      // por la normal radial, y siempre con algo de subida.
      const len = 4.5 + rnd() * rnd() * 11
      const fan = 0.25 + rnd() * 0.5
      pushSplinter(bx, by, bz,
        (nx + rx * fan) * len + (rnd() - 0.5) * len * 0.3,
        (ny + ry * fan) * len + (0.25 + rnd() * 0.5) * len,
        (nz + rz * fan) * len + (rnd() - 0.5) * len * 0.3,
        0.85 + rnd() * 1.1,
        tint(C_SPLINTER, 1.0), tint(C_SPLINTER, 0.55))
    }
  }

  // ─── TOCONES DE RAMA: un tronco caído no es un cilindro pelado — tiene los
  // muñones de las ramas que se le partieron. Cortos y gruesos, con la misma
  // corteza de placas y su propio disquito de anillos en la punta. ───────────
  for (const br of [
    { u: -0.20, th: 1.05, len: 1.5, rad: 0.36, rise: 0.55, seed: 9.1 },
    { u: 0.18, th: -1.3, len: 1.15, rad: 0.29, rise: 0.8, seed: 14.3 },
  ]) {
    const A = logAxis(br.u)
    const p = logDirP(br.u), q = logDirQ()
    const sa = Math.sin(br.th), ca = Math.cos(br.th)
    const rx = p[0] * sa + q[0] * ca, ry = p[1] * sa + q[1] * ca, rz = p[2] * sa + q[2] * ca
    const trunkR = logTubeR(br.u)
    // La rama sale por la normal del tronco y sube.
    let dx = rx, dy = ry + br.rise, dz = rz
    const dn = Math.hypot(dx, dy, dz) || 1
    dx /= dn; dy /= dn; dz /= dn
    // Arranca DENTRO del tronco: si naciera en la superficie quedaría una
    // juntura abierta entre el muñón y la corteza.
    const sx = A[0] + rx * trunkR * 0.45, sy = A[1] + ry * trunkR * 0.45, sz = A[2] + rz * trunkR * 0.45
    const L = trunkR * br.len, r0 = trunkR * br.rad
    // Dos perpendiculares a la dirección de la rama.
    let e1x = -dz, e1y = 0, e1z = dx
    const e1n = Math.hypot(e1x, e1y, e1z) || 1
    e1x /= e1n; e1y /= e1n; e1z /= e1n
    const e2x = dy * e1z - dz * e1y, e2y = dz * e1x - dx * e1z, e2z = dx * e1y - dy * e1x
    const E1 = [e1x, e1y, e1z], E2 = [e2x, e2y, e2z]
    const brAround = 13, brAlong = 9
    const brRad = (s) => r0 * (1 - 0.28 * s)
    pushBarkTube({
      u0: 0, u1: 1, NU: 30, NA: 56,
      axis: (s) => [sx + dx * L * s, sy + dy * L * s, sz + dz * L * s],
      dirP: () => E1, dirQ: () => E2, rad: brRad,
      around: brAround, along: brAlong,
    })
    // Punta de la rama: también partida, con su cara de anillos y sus astillas.
    const tx = sx + dx * L, ty = sy + dy * L, tz = sz + dz * L
    const rimR = (th) => brRad(1) * barkAt(1, th, brAround, brAlong).k
    pushRingDisc({
      cx: tx, cy: ty, cz: tz, dirP: E1, dirQ: E2, nrm: [dx, dy, dz],
      rimR, NRAD: 26, NA: 56, rings: 52, seed: br.seed, relief: 0.25,
    })
    for (let i = 0; i < 14; i++) {
      const th = rnd() * Math.PI * 2
      const r = rimR(th) * (0.9 + rnd() * 0.15)
      const bx = tx + E1[0] * Math.sin(th) * r + E2[0] * Math.cos(th) * r
      const by = ty + E1[1] * Math.sin(th) * r + E2[1] * Math.cos(th) * r
      const bz = tz + E1[2] * Math.sin(th) * r + E2[2] * Math.cos(th) * r
      const len = 1 + rnd() * rnd() * 4
      pushSplinter(bx, by, bz, dx * len, dy * len, dz * len,
        0.3 + rnd() * 0.4, tint(C_SPLINTER, 0.9), tint(C_SPLINTER, 0.45))
    }
  }

  // ─── La malla leñosa completa + su luz. Lambert (NO basic): la textura la
  // hace la LUZ sobre la geometría rugosa. El resto del mundo es unlit (points/
  // lines/basic) y no ve estas luces; solo la madera las aprovecha. ───────────
  {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wPos), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(wCol), 3))
    geo.setIndex(wIdx)
    geo.computeVertexNormals()
    // `noiseNor` de la receta: perturbar las NORMALES además de las posiciones.
    // Sin esto la corteza se lee lisa aunque el relieve esté ahí.
    const nor = geo.attributes.normal.array
    for (let i = 0; i < nor.length; i += 3) {
      const nx = nor[i] + wJit[i] * 0.7
      const ny = nor[i + 1] + wJit[i + 1] * 0.7
      const nz = nor[i + 2] + wJit[i + 2] * 0.7
      const n = Math.hypot(nx, ny, nz) || 1
      nor[i] = nx / n; nor[i + 1] = ny / n; nor[i + 2] = nz / n
    }
    scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })))
    // Sol RASANTE (~23° sobre el horizonte). Con el sol casi cenital que había
    // antes, las fisuras no proyectaban sombra y toda la corteza quedaba con el
    // mismo valor: plana. La luz baja es lo que convierte el relieve en textura.
    // Intensidades altas a propósito: three ≥r155 usa iluminación física y el
    // Lambert divide por π, así que una direccional de 1.0 deja la superficie a
    // menos de un tercio de su albedo.
    const sun = new THREE.DirectionalLight(0xfff5e8, 3.4)
    sun.position.set(0.94, 0.4, 0.16)
    scene.add(sun)
    // REBOTE frío desde el lado opuesto y bajo. No es un segundo sol: con un
    // solo direccional la cara del quiebre —que mira justo en contra— quedaba
    // siempre a contraluz y las astillas no se veían nunca. Débil, para no
    // aplanar el relieve que consigue el sol rasante.
    const bounce = new THREE.DirectionalLight(0x9fb4d0, 1.1)
    bounce.position.set(-0.85, 0.3, -0.45)
    scene.add(bounce)
    // Ambiente frío y contenido: la fisura tiene que irse casi a negro.
    scene.add(new THREE.AmbientLight(0x39404f, 0.9))
  }

  // ─── TRONCO (textura): la superficie sólida de arriba le da masa; esto le
  // pone la CORTEZA (parda, con grietas a lo largo) y la pelusa de musgo encima.
  // Los anillos de crecimiento solo asoman en los EXTREMOS cortados. ─────────
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
      // Musgo, liquen y corteza desprendida van en MANCHONES. Las frecuencias
      // tienen que caer varias celdas de ruido dentro del rango real de (u,v):
      // el tronco mide ~1.4 de largo y ~0.4 de ancho, así que con frecuencias
      // de 1-3 el ruido no alcanzaba a variar y devolvía casi el mismo valor en
      // todo el tronco — el musgo salía como MANTA y tapaba toda la corteza.
      const mossN = noise2(u * 7 + 20, v * 16 + 9)
      const lichenN = noise2(u * 9 - 12, v * 20 - 4)
      // Corteza DESPRENDIDA: parches donde ya se cayó y asoma la albura clara
      // — el rasgo más característico de un tronco en descomposición.
      const peelN = noise2(u * 5 - 40, v * 11 + 17)
      let col, size
      // Más tupido en el flanco -v (el húmedo), ralo en el lomo.
      const mossThresh = v < -lr * 0.1 ? 0.56 : 0.66
      if (mossN > mossThresh) {
        // MUSGO como hojitas orientadas por la NORMAL de la superficie (técnica
        // de la referencia, doc tronco-musgo.md): en el lomo apuntan hacia
        // arriba, en los flancos salen de costado siguiendo la curva del tronco,
        // inclinadas al azar. Verde con variación (+R, -G) → del verde al
        // amarillento, nunca un verde plano.
        const nvv = Math.max(-1, Math.min(1, v / lr))          // normal transversal
        const nup = Math.sqrt(Math.max(0, 1 - nvv * nvv))       // componente hacia arriba
        // Dirección de la hojita = normal de la sección + inclinación aleatoria.
        const nx = perpX(u) * nvv, nz = perpZ(u) * nvv          // lateral, siguiendo el eje curvo
        const len = (1.0 + rnd() * rnd() * 2.4) * (0.6 + mossN * 0.7)
        const jx = (rnd() - 0.5) * 0.7, jz = (rnd() - 0.5) * 0.7
        const dx = (nx + jx) * len, dy = (nup + 0.2) * len, dz = (nz + jz) * len
        const rr = rnd(), gr = rnd()
        const tone = 0.55 + rnd() * 0.6
        const base = [C_MOSS[0] * 0.4 * fade, C_MOSS[1] * 0.4 * fade, C_MOSS[2] * 0.4 * fade]
        const tip = [(C_MOSS[0] + 0.3 * rr) * tone * fade, (C_MOSS[1] * 1.3 - 0.25 * gr) * tone * fade, C_MOSS[2] * tone * fade]
        draw.pushLine(x * R, y, z * R, x * R + dx, y + dy, z * R + dz, base, tip)
        draw.pushPoint(x * R + dx, y + dy, z * R + dz, tip, 0.16 + rnd() * 0.2, 0)
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
  // (Los anillos de "extremo cortado" se quitaron: el tronco ahora es un tubo
  // de puntas REDONDEADAS, no una viga con caras cortadas — un anillo plano
  // flotaría despegado de la punta curva.)

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
  // Las dos colonias —Pleurotus (0) y Trametes (1)— prenden JUNTAS, en un mismo
  // parche chico sobre el lomo, y desde ahí se comen el tronco. Antes arrancaban
  // en puntas opuestas y el mundo abría con el tronco ya repartido; así se ve el
  // avance y el encuentro. Las semillas van por `uvToWorld` (el eje CURVO): con
  // el eje recto caían fuera del tronco en las puntas.
  const patchU = -0.14
  const [s0x, s0z] = uvToWorld(patchU - 0.05, logR * 0.30)
  const [s1x, s1z] = uvToWorld(patchU + 0.05, -logR * 0.30)
  const seed0 = { x: s0x, z: s0z, colony: 0 }
  const seed1 = { x: s1x, z: s1z, colony: 1 }
  const net = createNetwork(cc.mycelium, [seed0, seed1], rnd)
  // El centro de cada colonia (su punto de inoculación): la dirección RADIAL
  // hacia afuera desde ahí es la que da el rosetón plumoso de una placa real.
  const COLONY_SEED = [seed0, seed1]
  // Pre-crecer: el mundo abre con un tronco YA colonizado, no con dos puntas
  // solas que tardarían un minuto en leerse. Se corre la simulación real con un
  // field de humedad plena antes del primer frame (~la mitad del presupuesto).
  {
    const warmField = {
      resourceAt: (x, z) => Math.min(1, resourceAt(sub, x, z).carbon),
      moisture: 0.9, onLog: onLogXZ, canLeave: soilContactXZ,
    }
    // Solo un arranque: el mundo abre con la colonia recién prendida y se la ve
    // TOMARSE el tronco en vivo, que es la gracia. (Con un pre-crecido largo
    // aparecía todo hecho y no se veía crecer nada.)
    // Arranca con POCO: apenas un puñado de hifas prendidas, para VER cómo la
    // colonia se agranda de a poco sobre el tronco (antes abría casi hecha).
    for (let i = 0; i < 120; i++) updateNetwork(net, cc.mycelium, 1 / 30, rnd, warmField)
  }

  // Dos registros visuales del micelio (spec §10). La red se dibuja con capacidad
  // para bundlear los cordones (una arista gruesa = varias líneas paralelas), y
  // aparte los frentes plumosos que salen de cada punta.
  // Grosor a partir del cual una arista se dibuja como CORDÓN (haz de 3 hifas).
  // Calibrado contra los valores reales que produce la sim (mediana ≈ 5): con un
  // umbral bajo TODAS las aristas salían bundleadas y desbordaban el buffer.
  const CORD_W = 9
  // Blending ADITIVO: el micelio no es un dibujo de líneas, es materia que
  // BRILLA y se acumula. Donde muchas hifas se superponen el aditivo suma y
  // aparece el mat algodonoso blanco; donde hay pocas queda un hilo tenue. Es
  // lo que hace que se lea como micelio y no como un diagrama de red.
  const netMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  // Cada arista se dibuja curva (6 segmentos, para poder bordear el flanco del
  // tronco sin cortar por el aire) y, si es cordón, ×3 hifas paralelas.
  const netBuf = createLineBuffer(cc.mycelium.maxEdges * 10, netMat)
  scene.add(netBuf.mesh)
  // El frente plumoso también aditivo: el borde algodonoso se ve porque muchas
  // hifas finas se suman, no porque cada una sea brillante.
  const frontMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const FAN = 10                       // hifas finas por punta (el borde plumoso)
  // FAN*3 líneas de penacho + 1 hifa de penetración por punta.
  const frontBuf = createLineBuffer(cc.mycelium.maxTips * (FAN * 3 + 1), frontMat)
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
      const fa = edgeFade(a.x, a.z), fb = edgeFade(b.x, b.z)
      // Las hifas CURVAN: una cuerda recta nodo-a-nodo delata la geometría del
      // grafo. Cada arista se dibuja como una polilínea con una comba lateral
      // estable (derivada de los índices, no aleatoria por frame — si no,
      // temblaría). `arc` da la curvatura en unidades de mundo.
      const dx = bx - ax, dz = bz - az
      const d = Math.hypot(dx, dz) || 1
      const px = -dz / d, pz = dx / d
      // BANDAS CONCÉNTRICAS: una colonia real deja anillos de densidad (crece
      // distinto de día que de noche). El brillo se modula con la distancia al
      // inóculo, así aparecen los anillos característicos de una placa.
      const org = net.origins && net.origins[e.colony]
      let band = 1
      if (org) {
        const rr = Math.hypot((a.x + b.x) / 2 - org.x, (a.z + b.z) / 2 - org.z)
        band = 0.55 + 0.45 * Math.abs(Math.sin(rr * 26))
      }
      const wobble = Math.sin((e.a * 12.9898 + e.b * 78.233) % 6.2832)
      const arc = wobble * d * 0.18
      // La hifa NO CUELGA en el aire: la altura de cada muestra sale del mapa de
      // alturas, así el trazo BORDEA la geometría — baja por el flanco del
      // tronco hasta la tierra y sigue por el suelo. Antes se interpolaba entre
      // las alturas de los dos nodos y una arista que cruzaba el canto se
      // dibujaba como una recta por el aire, como si el micelio se cayera.
      // Cuando la arista cambia de lado (una punta que envolvió el canto), el
      // lado se da vuelta a mitad de camino: en el canto las dos caras valen lo
      // mismo, así que el trazo pasa por el ecuador sin saltar.
      const sideA = a.side || 1, sideB = b.side || 1
      const SEG = 6
      const curvePt = (s, lateral) => {
        const t = s / SEG
        const bend = Math.sin(t * Math.PI) * arc
        const wx = ax + dx * t + px * (bend + lateral)
        const wz = az + dz * t + pz * (bend + lateral)
        return [wx, netY(wx / R, wz / R, t < 0.5 ? sideA : sideB), wz]
      }
      if (e.width >= CORD_W) {
        // CORDÓN (rizomorfo): haz de 3 hifas paralelas curvas, brillante — las
        // "autopistas" que consolidan el territorio ganado.
        const bright = Math.min(1, 0.7 + e.width * 5) * band
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
        const dim = (0.4 + e.width * 6) * band
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
      const surf = surfaceY(t.x, t.z, t.side)
      const y0 = netY(t.x, t.z, t.side) + 0.2
      const x0 = t.x * R, z0 = t.z * R
      // PENETRACIÓN: si la punta está sobre el tronco, una hifa se hunde en la
      // madera — el hongo come el tronco por dentro, no solo por encima. Va
      // hacia el EJE del tronco, que es donde está la madera. Antes bajaba en Y
      // a secas: sobre el flanco la madera no está abajo sino al costado, así
      // que la hifa salía del tronco y quedaba COLGANDO EN EL AIRE.
      const [uu, vv] = worldToUV(t.x, t.z)
      if (surf > 0 && Math.abs(vv) < logRAt(Math.max(-halfLen, Math.min(halfLen, uu))) * 0.9) {
        const ax = logAxis(uu)
        let dx = ax[0] - x0, dy = ax[1] - y0, dz = ax[2] - z0
        const dn = Math.hypot(dx, dy, dz) || 1
        const into = (3 + rnd() * 5) / dn
        frontBuf.push(x0, y0, z0, x0 + dx * into, y0 + dy * into, z0 + dz * into,
          tint(base, fade * 0.5), tint(base, fade * 0.06))
      }
      for (let k = 0; k < FAN; k++) {
        const spread = (k / (FAN - 1) - 0.5) * 1.3   // abanico estrecho, no 360°
        const a = baseAng + spread + (rnd() - 0.5) * 0.25
        const len = (0.7 + rnd() * 0.9) * step
        const mx = x0 + Math.cos(a) * len, mz = z0 + Math.sin(a) * len
        // Cada punto del penacho toma su altura de la superficie: el penacho se
        // APOYA en la corteza o en la tierra. Dibujado a una altura fija salía
        // como un abanico plano clavado en el aire al llegar al flanco.
        const my = netY(mx / R, mz / R, t.side)
        // Si el extremo cae por el otro lado del canto, la superficie da un
        // salto y la hifa se dibujaría bajando en vertical hasta la tierra —
        // otra vez el hilo colgando. Esa hifa simplemente no se dibuja: el
        // penacho se detiene en el borde, que es donde se detiene de verdad.
        if (Math.abs(my - y0) > len) continue
        // Tallo de la hifa (más brillante en la base, se apaga hacia la punta).
        frontBuf.push(x0, y0, z0, mx, my, mz, tint(base, fade * 0.7), tint(base, fade * 0.15))
        // Bifurcación dicotómica: dos ramitas finas abriéndose en la punta.
        const fl = len * 0.55
        for (const s of [-0.4, 0.4]) {
          const bx = mx + Math.cos(a + s) * fl, bz = mz + Math.sin(a + s) * fl
          const by = netY(bx / R, bz / R, t.side)
          if (Math.abs(by - my) > fl) continue
          frontBuf.push(mx, my, mz, bx, by, bz, tint(base, fade * 0.15), tint(base, 0))
        }
      }
    }
    frontBuf.commit()
  }

  // ─── EL SUSTRATO SE COME EN VOLUMEN. El micelio que llega a la tierra no se
  // queda en la superficie: se hunde. Se dibuja una capa de hifas que bajan en
  // el suelo, más profundas donde la colonia lleva más tiempo (cerca del
  // inóculo) y someras en el frente que recién llega — así la masa colonizada
  // se lee como un CASQUETE que crece hacia abajo, no como una película. Es la
  // parte del hongo que en el bosque no se ve nunca; acá se ve porque el mundo
  // es un disco flotando en negro. ──────────────────────────────────────────
  const SOIL_STRIDE = 2          // 1 de cada N nodos de tierra emite hifa honda
  const SOIL_DEPTH = 24          // profundidad máxima, en unidades de mundo
  const soilBuf = createLineBuffer(Math.ceil(cc.mycelium.maxNodes / SOIL_STRIDE) * 3, frontMat)
  scene.add(soilBuf.mesh)

  function drawSoilDepth() {
    soilBuf.begin()
    const nodes = net.nodes
    for (let i = 0; i < nodes.length; i += SOIL_STRIDE) {
      const n = nodes[i]
      if (!n.alive) continue
      const surf = netY(n.x, n.z, n.side)
      if (surf > 1.2) continue                  // sigue sobre madera, no en tierra
      const org = net.origins && net.origins[n.colony]
      if (!org) continue
      // Cuanto más cerca del inóculo, más vieja es la colonia ahí y más hondo
      // llegó a comer. En el borde que recién llega, apenas raspa la superficie.
      const d = Math.hypot(n.x - org.x, n.z - org.z)
      const madurez = clamp01(1 - d / (cc.mycelium.bound || 1))
      // Todo derivado del índice: con rnd() la masa entera temblaría por frame.
      const h1 = noise2(i * 0.37, 2.1), h2 = noise2(i * 0.71, 5.3), h3 = noise2(i * 1.13, 9.7)
      // Lóbulos: sin esto todas las hifas bajan lo mismo y la masa se lee como
      // una cortina pareja. Un ruido de baja frecuencia sobre (x,z) le da bultos
      // redondeados — bolsones donde el hongo se comió el sustrato en volumen.
      const lobe = 0.4 + 1.0 * noise2(n.x * 6 + 3, n.z * 6 - 7)
      // Hasta el frente que recién llega raspa algo: si la profundidad cayera a
      // cero en el borde, la masa se cortaría en seco en vez de redondearse.
      const depth = SOIL_DEPTH * (0.22 + 0.78 * madurez) * lobe * (0.35 + 0.65 * h1)
      if (depth < 0.6) continue
      const x = n.x * R, z = n.z * R
      const dx = (h2 - 0.5) * depth * 1.2, dz = (h3 - 0.5) * depth * 1.2
      const base = C_COLONY[n.colony] || C_COLONY[0]
      const bx = x + dx, by = surf - depth, bz = z + dz
      const f = edgeFade(n.x, n.z)
      soilBuf.push(x, surf, z, bx, by, bz, tint(base, f * 0.5), tint(base, f * 0.12))
      // Bifurcación al fondo: la masa se abre, no termina en una punta seca.
      const fl = depth * 0.4
      for (const s of [-1, 1]) {
        soilBuf.push(bx, by, bz,
          bx + s * fl * (0.4 + h3 * 0.6), by - fl * 0.5, bz + s * fl * (0.4 + h2 * 0.6),
          tint(base, f * 0.12), tint(base, 0))
      }
    }
    soilBuf.commit()
  }

  // ─── LÍNEA DE DEMARCACIÓN (zone line). Donde dos colonias incompatibles se
  // traban, ninguna avanza y las dos depositan pigmento: en la madera podrida
  // eso es la raya oscura que separa un hongo del otro. Es una MANCHA, no una
  // estela: se acumula y no se va, así que se dibuja con blending normal (el
  // aditivo del micelio no puede oscurecer) y por encima de la red.
  const ZONE_MAX = 1200
  const zoneMarks = []           // {x, z, side, ang, len}
  const C_ZONE = [0.26, 0.11, 0.03]   // pardo melanizado
  const zoneMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })
  const zoneBuf = createLineBuffer(ZONE_MAX, zoneMat)
  zoneBuf.mesh.renderOrder = 3   // después de la red, para poder taparla
  scene.add(zoneBuf.mesh)
  let zoneDirty = true

  function addZoneMark(ev) {
    // Se muestrea: el frente trabado dispara muchos eventos sobre el mismo punto
    // y no hace falta una marca por cada uno.
    if (rnd() > 0.25) return
    if (zoneMarks.length >= ZONE_MAX) zoneMarks.shift()
    zoneMarks.push({
      x: ev.x, z: ev.z, side: ev.side || 1,
      ang: rnd() * Math.PI * 2, len: 0.9 + rnd() * 1.6,
    })
    zoneDirty = true
  }

  function drawZone() {
    if (!zoneDirty) return
    zoneDirty = false
    zoneBuf.begin()
    for (const m of zoneMarks) {
      const x = m.x * R, z = m.z * R
      const y = netY(m.x, m.z, m.side) + 0.35
      const dx = Math.cos(m.ang) * m.len, dz = Math.sin(m.ang) * m.len
      const f = edgeFade(m.x, m.z)
      zoneBuf.push(x - dx, y, z - dz, x + dx, y, z + dz, tint(C_ZONE, f), tint(C_ZONE, f))
    }
    zoneBuf.commit()
  }

  // ─── LA CARA CORTADA SE COME. El disco de anillos es madera fresca expuesta:
  // es lo primero que coloniza el hongo, y lo hace RADIALMENTE desde el centro
  // hacia la corteza, siguiendo la veta. En planta (x,z) la cara es una línea
  // —no tiene área— así que la red 2D no puede vivir ahí: se dibuja como capa
  // propia, y lo que la dispara es que la red haya LLEGADO de verdad al corte.
  const FACE_RAYS = 130
  const faceBuf = createLineBuffer(FACE_RAYS * 9, frontMat)
  scene.add(faceBuf.mesh)
  // Centro del corte en coordenadas normalizadas, para medir qué tan cerca está
  // la red sin tener que invertir el eje curvo por nodo.
  const [faceNx, faceNz] = uvToWorld(halfLen, 0)
  let faceProgress = 0
  let faceColony = 0

  function updateFace(dt) {
    // ¿Cuánta red llegó al corte? Se mira en planta: los nodos alrededor del eje
    // a la altura de la cara. Barato y suficiente para disparar el avance.
    let near = 0, byColony = [0, 0]
    for (const n of net.nodes) {
      if (!n.alive) continue
      if (Math.hypot(n.x - faceNx, n.z - faceNz) > 0.12) continue
      near++
      byColony[n.colony] = (byColony[n.colony] || 0) + 1
    }
    if (near > 0) faceColony = byColony[1] > byColony[0] ? 1 : 0
    const target = clamp01(near / 45)
    // Se come de a poco y no retrocede de golpe: la madera comida no vuelve.
    faceProgress += (target - faceProgress) * Math.min(1, dt * (target > faceProgress ? 0.25 : 0.05))
  }

  function drawFace() {
    faceBuf.begin()
    if (!cutFace.c || faceProgress < 0.02) { faceBuf.commit(); return }
    const [cx, cy, cz] = cutFace.c
    const p = cutFace.p, q = cutFace.q, n = cutFace.n
    const base = C_COLONY[faceColony] || C_COLONY[0]
    // Un pelo por delante de la cara, para no pelearse en Z con el disco.
    const ox = cx + n[0] * 0.8, oy = cy + n[1] * 0.8, oz = cz + n[2] * 0.8
    const at = (th, r) => [ox + p[0] * Math.sin(th) * r + q[0] * Math.cos(th) * r,
      oy + p[1] * Math.sin(th) * r + q[1] * Math.cos(th) * r,
      oz + p[2] * Math.sin(th) * r + q[2] * Math.cos(th) * r]
    for (let i = 0; i < FACE_RAYS; i++) {
      // Todo derivado del índice, nunca de rnd(): si no, el radio temblaría
      // entero en cada frame.
      const th0 = (i / FACE_RAYS) * Math.PI * 2 + noise2(i * 0.37, 3.1) * 0.55
      const rim = cutFace.rimR(th0)
      // Cada rayo avanza a su propio ritmo: el frente sobre la cara es irregular.
      const reach = rim * faceProgress * (0.5 + 0.8 * noise2(i * 0.91, 7.3))
      // NINGÚN rayo arranca en el centro exacto: si convergen todos, el disco se
      // lee como un sol dibujado y no como un hongo comiéndose la madera.
      const r0 = rim * (0.05 + 0.22 * noise2(i * 1.7, 19.3))
      const SEGF = 6
      // Serpentea sobre la veta, con dos escalas de ondulación.
      const bend = (t) => (noise2(i * 0.53, t * 3 + 11) - 0.5) * 1.2 * t
        + (noise2(i * 2.1, t * 9 + 4) - 0.5) * 0.4
      let prev = null
      for (let s = 0; s <= SEGF; s++) {
        const t = s / SEGF
        const pt = at(th0 + bend(t), r0 + (reach - r0) * t)
        if (prev) {
          const f0 = 0.5 * (1 - 0.5 * (t - 1 / SEGF)), f1 = 0.5 * (1 - 0.5 * t)
          faceBuf.push(prev[0], prev[1], prev[2], pt[0], pt[1], pt[2], tint(base, f0), tint(base, f1))
        }
        prev = pt
      }
      // Bifurcación dicotómica en la punta: el borde algodonoso del frente.
      for (const sgn of [-1, 1]) {
        const tip = at(th0 + bend(1) + sgn * (0.18 + 0.2 * noise2(i * 3.3, sgn)), reach * 1.2)
        faceBuf.push(prev[0], prev[1], prev[2], tip[0], tip[1], tip[2], tint(base, 0.22), tint(base, 0))
      }
    }
    faceBuf.commit()
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
        tipsCloud.pos[i * 3 + 1] = netY(t.x, t.z, t.side)
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

  // ─── FRUCTIFICACIÓN (clímax, spec §7): se gana cazando nitrógeno ──────────
  const fruiting = createFruiting(cc.fruiting)
  let nitrogen = 0             // reservas acumuladas de cazar nematodos
  let lastStage = 'dormant'
  // Ancla de los cuerpos fructíferos: salen del FLANCO del tronco (no del suelo),
  // que es como crece Pleurotus. Se fija un punto en el costado por ciclo.
  const fruitU = halfLen * (rnd() * 1.2 - 0.6)
  const fruitSide = rnd() < 0.5 ? 1 : -1
  const fruitMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const fruitBuf = createLineBuffer(120, fruitMat)
  scene.add(fruitBuf.mesh)
  const spores = createPointCloud(220, draw.pointMaterial)
  scene.add(spores.mesh)
  const sporeState = []          // {x,y,z,vy,age,ttl}
  // Qué slots de la fauna son NEMATODOS (la presa que da nitrógeno).
  const isNematode = agentNames.map((n) => n === 'nematodo')

  // Densidad de la red por celda gruesa: para saber si un nematodo pasa SOBRE
  // el micelio (sin recorrer todas las aristas por bicho y frame).
  function mycelialAt(x, z) {
    let c = 0
    for (const t of net.tips) { if (t.alive && Math.abs(t.x - x) < 0.08 && Math.abs(t.z - z) < 0.08) c++ }
    return c
  }

  // Dibuja los cuerpos fructíferos: repisas escalonadas que crecen con la etapa
  // (o astas deformes si `deformed`). Sobre el flanco del tronco.
  function drawFruit(st) {
    fruitBuf.begin()
    if (st.stage === 'dormant') { fruitBuf.commit(); return }
    const [fx, fz] = uvToWorld(fruitU, fruitSide * logRAt(fruitU) * 0.95)
    const base = surfaceYUV(fruitU, fruitSide * logRAt(fruitU) * 0.95)
    const grow = st.stage === 'primordia' ? st.progress * 0.4
      : st.stage === 'expanding' ? 0.4 + st.progress * 0.6
      : st.stage === 'senescent' ? 1 - st.progress * 0.5 : 1
    const shelves = st.deformed ? 3 : 6
    const col = st.deformed ? [0.5, 0.42, 0.3] : [1.0, 0.9, 0.7]
    const nx = fruitSide * logPx, nz = fruitSide * logPz
    for (let s = 0; s < shelves; s++) {
      const up = (s + 1) / shelves * grow * 7
      const out = st.deformed ? grow * 5 : (2 + s * 0.6) * grow   // asta larga vs repisa ancha
      const ex = fx * R + nx * out, ez = fz * R + nz * out
      fruitBuf.push(fx * R, base + up * 0.4, fz * R, ex, base + up, ez, col, col)
      if (!st.deformed) { // borde de la repisa
        const w = out * 0.7
        fruitBuf.push(ex - logAx * w, base + up, ez - logAz * w, ex + logAx * w, base + up, ez + logAz * w, col, col)
      }
    }
    fruitBuf.commit()
  }

  function updateSpores(st, step) {
    // Durante la esporulación cae una bruma blanca desde el sombrero.
    if (st.stage === 'sporulating' && sporeState.length < 220 && rnd() < 12 * step) {
      const [fx, fz] = uvToWorld(fruitU, fruitSide * logRAt(fruitU) * 0.95)
      const base = surfaceYUV(fruitU, fruitSide * logRAt(fruitU) * 0.95) + 6
      sporeState.push({ x: fx * R + (rnd() - 0.5) * 6, y: base, z: fz * R + (rnd() - 0.5) * 6,
        vy: -3 - rnd() * 3, age: 0, ttl: 3 + rnd() * 3 })
    }
    for (let i = sporeState.length - 1; i >= 0; i--) {
      const s = sporeState[i]; s.age += step; s.y += s.vy * step; s.x += (rnd() - 0.5) * step * 4
      if (s.age > s.ttl || s.y < 0) sporeState.splice(i, 1)
    }
    for (let i = 0; i < 220; i++) {
      const s = sporeState[i]
      if (s) {
        const f = 1 - s.age / s.ttl
        spores.pos[i * 3] = s.x; spores.pos[i * 3 + 1] = s.y; spores.pos[i * 3 + 2] = s.z
        spores.col[i * 3] = 0.9 * f; spores.col[i * 3 + 1] = 0.9 * f; spores.col[i * 3 + 2] = 0.8 * f
        spores.size[i] = 0.4
      } else { spores.pos[i * 3 + 1] = -9999 }
    }
    spores.commit()
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
      moisture, onLog: onLogXZ, canLeave: soilContactXZ,
    }
    const events = []
    const netEvents = updateNetwork(net, cc.mycelium, step * growthMul, rnd, field)
    // Demarcación: dos colonias se tocan y NO se fusionan → línea negra (spec §5).
    for (const ev of netEvents) {
      if (ev.type !== 'barrier') continue
      addZoneMark(ev)
      if (rnd() < 0.02) {
        events.push({ type: 'conflict', agent: 'Pleurotus', agentType: 'colony', kind: 'demarcation' })
      }
    }

    // El micelio COME donde tiene puntas: eso agota el sustrato localmente, y
    // el agotamiento es lo que hace que el cordón deje de recibir flujo, se
    // atrofie y se pode — así la red ABANDONA lo exprimido y sigue avanzando.
    // Sin este consumo el recurso era infinito, nada se podaba nunca y la red
    // quedaba congelada al saturar. Es además la premisa del mundo: el terreno
    // es la comida y se acaba.
    for (const t of net.tips) {
      if (t.alive) {
        const got = consume(sub, t.x, t.z, cc.eatRate * step * growthMul)
        nitrogen += got.nitrogen   // los cadáveres del sustrato también dan N
      }
    }
    drawNetwork()
    drawFront()
    drawSoilDepth()
    updateFace(step)
    drawFace()
    drawZone()
    drawTips()

    // ─── Fauna del suelo: deambula libre, contenida en el disco ───────────
    updateRoamers(roamers, cfg.wander, step, rnd, clock)
    for (let i = 0; i < cc.fauna; i++) {
      const r = roamers[i]
      const x = r.x * R, z = r.z * R
      // La fauna del SUELO camina en el SUELO (nivel de la hojarasca), no sobre
      // el tronco curvo — antes usaba la altura del eje aun lejos del tronco y
      // los bichos caminaban EN EL AIRE. `surfaceY` ya devuelve suelo fuera de
      // la huella, así que solo trepan si están de verdad encima del tronco.
      const y = surfaceY(r.x, r.z) + 1.3
      faunaAgents[i].group.position.set(x, y, z)
      const sp = Math.hypot(r.vx, r.vz)
      if (sp > 1e-4) faunaAgents[i].group.rotation.y = Math.atan2(r.vx * R, r.vz * R)
      worldPos[i * 3] = x; worldPos[i * 3 + 1] = y; worldPos[i * 3 + 2] = z

      // TRAMPA: un nematodo que pasa sobre el micelio queda atrapado (Pleurotus
      // es nematófago). Da nitrógeno — la moneda que habilita la fructificación
      // — y reaparece en otro punto del borde. Es la cadena causal del mundo.
      if (isNematode[i] && Math.hypot(r.x, r.z) < 0.66 && mycelialAt(r.x, r.z) > 0) {
        nitrogen += cc.fruiting.trapNitrogen
        events.push({ type: 'conflict', agent: 'nematodo', agentType: 'soil_fauna', kind: 'trap' })
        const a = rnd() * Math.PI * 2
        r.x = Math.cos(a) * 0.8; r.z = Math.sin(a) * 0.8; r.vx = 0; r.vz = 0
      }
    }
    trails.update(worldPos)

    // ── Fructificación: el clímax. Se gana cazando (nitrógeno), y necesita
    //    además choque de frío + humedad (spec §7). ──────────────────────────
    if (eco) {
      const st = updateFruiting(fruiting, cc.fruiting, step, {
        nitrogen, temperature: eco.temperature, moisture,
        co2: clamp01(1 - activity),   // poco recambio de gas cuando la red está calma
        light: eco.gain,
      })
      if (fruiting.nitrogenSpent > 0) { nitrogen -= fruiting.nitrogenSpent; fruiting.nitrogenSpent = 0 }
      if (st.stage !== lastStage) {
        if (st.stage === 'primordia') {
          events.push({ type: 'fruiting', kind: st.deformed ? 'deformed' : 'primordia' })
        } else if (st.stage === 'sporulating') {
          events.push({ type: 'fruiting', kind: 'sporulating' })
        }
        lastStage = st.stage
      }
      drawFruit(st)
      updateSpores(st, step)
    }

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
    if (eco) {
      scene.fog.density = 0.0009 + eco.fog * 0.0022
      // El slot "estación" del HUD muestra la CLASE DE DESCOMPOSICIÓN (1..5),
      // que sale del consumo, no del reloj (spec §9).
      eco.seasonLabel = decayClass(sub) + '/5'
    }

    stage.render(step)
    return events
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
