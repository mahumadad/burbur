import * as THREE from 'three'
import { createStage } from '../render/stage.js'
import { createDraw, createPointCloud, createLineBuffer } from '../render/engine/points.js'
import { createAgentKit } from '../render/engine/agents3d.js'
import { createTrails } from '../render/engine/trails.js'
import { PALETTE } from '../config.js'
import { createSubstrate, resourceAt } from '../sim/decay.js'
import { createNetwork, updateNetwork, tipPositions } from '../sim/mycelium.js'
import { createRoamers, updateRoamers } from '../sim/wander.js'

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
// La red: dos micelios reales, no colores de dato. Pleurotus = blanco cálido
// crema (colonia 0); Trametes = gris-azulado pálido (colonia 1). Más orgánico
// que blanco/cian puros.
const C_COLONY = [[1.0, 0.95, 0.82], [0.66, 0.82, 0.86]]
const FAUNA_COLORS = [PALETTE.yellow, PALETTE.orange, PALETTE.bond]

// Cuánto se levanta el tronco en Y por unidad de radio (mundo). Puramente
// estético: sin esto el tronco se lee como una textura plana en vez de un
// cilindro apoyado en el suelo.
const LOG_HEIGHT_SCALE = 0.4
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
  // Macro suave: con la apertura muy alta el fondo se disolvía tanto que las
  // líneas finas de la red desaparecían. Bajamos para que el detalle se lea.
  draw.uniforms.uFocus.value = 75
  draw.uniforms.uAperture.value = 0.5

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
  /** Altura de apoyo en (x,z): sobre el tronco sigue su domo; fuera, el suelo. */
  function surfaceY(x, z) {
    return domeHeight(radialToAxis(x, z))
  }
  function edgeFade(x, z) {
    const rr = Math.hypot(x, z)
    return clamp01(1 - (rr - EDGE_FADE_START) / (EDGE_FADE_END - EDGE_FADE_START))
  }

  // Altura de la superficie del tronco en coords (u = a lo largo del eje,
  // v = perpendicular). El domo semicircular por |v| da el lomo redondeado.
  function surfaceYUV(u, v) {
    const uc = Math.max(-halfLen, Math.min(halfLen, u))
    const overEnd = u - uc                 // >0 más allá de la punta redondeada
    const rad = Math.hypot(overEnd, v)
    return domeHeight(rad)
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
    // (a) Piel de corteza: dither denso y fino de puntos pardos sobre el lomo,
    // con vetas más oscuras en los surcos (bandas a lo largo del eje).
    let placed = 0
    const maxAttempts = cc.logDither * 4
    for (let a = 0; a < maxAttempts && placed < cc.logDither; a++) {
      const u = (rnd() * 2 - 1) * (halfLen + logR)
      const v = (rnd() * 2 - 1) * logR
      if (Math.hypot(Math.max(0, Math.abs(u) - halfLen), v) > logR) continue
      placed++
      const [x, z] = uvToWorld(u, v)
      // Surcos longitudinales: el color se oscurece en franjas de v (la corteza
      // agrietada). Un poco de variación por punto para que no sea liso.
      const furrow = 0.5 + 0.5 * Math.abs(Math.sin(v / logR * 7 + Math.sin(u * 3)))
      const shade = (0.55 + furrow * 0.5) * (0.85 + rnd() * 0.3)
      const y = surfaceYUV(u, v) + 0.15
      draw.pushPoint(x * R, y, z * R, tint(C_BARK, shade * edgeFade(x, z)), 0.28 + rnd() * 0.4, 0)
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
      for (const rad of [logR * 0.94, barkStart, (sapStart + barkStart) / 2, sapStart, sapStart * 0.6, sapStart * 0.3]) {
        const col = ringColor(rad + 1e-4)
        let prev = null
        for (let i = 0; i <= seg; i++) {
          const ang = (i / seg) * Math.PI * 2
          // El anillo vive en el plano de la cara (perpendicular al eje): v y ALTURA.
          const v = Math.cos(ang) * rad
          const yr = domeHeight(0) + Math.sin(ang) * rad * R * LOG_HEIGHT_SCALE
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
  const CORD_W = 0.06                 // grosor a partir del cual una arista es cordón
  const netMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })
  const netBuf = createLineBuffer(cc.mycelium.maxEdges * 3, netMat)
  scene.add(netBuf.mesh)
  const frontMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5 })
  const frontBuf = createLineBuffer(cc.mycelium.maxTips * 6, frontMat)
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
      if (e.width >= CORD_W) {
        // CORDÓN (rizomorfo): haz de 3 hifas paralelas, brillante. Los cordones
        // son las "autopistas" que consolidan el territorio ganado.
        const bright = Math.min(1, 0.7 + e.width * 5)
        let dx = bx - ax, dz = bz - az
        const d = Math.hypot(dx, dz) || 1
        const px = (-dz / d), pz = (dx / d)      // perpendicular en el plano
        const off = Math.min(1.6, 0.5 + e.width * 8)
        for (const s of [-off, 0, off]) {
          netBuf.push(ax + px * s, ya, az + pz * s, bx + px * s, yb, bz + pz * s,
            tint(base, fa * bright), tint(base, fb * bright))
        }
      } else {
        // MALLA FINA: la trama difusa entre cordones, tenue.
        const dim = 0.4 + e.width * 6
        netBuf.push(ax, ya, az, bx, yb, bz, tint(base, fa * dim), tint(base, fb * dim))
      }
    }
    netBuf.commit()
  }

  // Frente de avance PLUMOSO: de cada punta salen 3–4 hifas cortas y finas
  // abriéndose en abanico hacia adelante — el borde difuso que se ve al levantar
  // una corteza. Dinámico: se redibuja cada frame con las puntas.
  function drawFront() {
    frontBuf.begin()
    for (const t of net.tips) {
      if (!t.alive) continue
      const base = C_COLONY[t.colony] || C_COLONY[0]
      const fade = edgeFade(t.x, t.z) * 0.6
      const x0 = t.x * R, z0 = t.z * R, y0 = surfaceY(t.x, t.z) + 0.5
      const n = 3 + ((rnd() * 2) | 0)
      for (let k = 0; k < n; k++) {
        const a = t.ang + (rnd() - 0.5) * 1.1
        const len = (0.4 + rnd() * 0.5) * cc.mycelium.stepLen * R * 2.2
        frontBuf.push(x0, y0, z0, x0 + Math.cos(a) * len, y0, z0 + Math.sin(a) * len,
          tint(base, fade), tint(base, 0))
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
    drawNetwork()
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
