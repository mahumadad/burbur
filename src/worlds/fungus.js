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
// La red: blancos/cian (spec §10). Pleurotus=colonia 0, Trametes=colonia 1.
const C_COLONY = [rgb(PALETTE.white), rgb(PALETTE.cyanSat)]
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
  draw.uniforms.uFocus.value = 55
  draw.uniforms.uAperture.value = 1.1

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

  // ─── TRONCO: dither de puntos por capa (rejection sampling sobre la cápsula) ─
  {
    const alongHalf = halfLen + logR
    const acrossHalf = logR
    let placed = 0
    const maxAttempts = cc.logDither * 6
    for (let a = 0; a < maxAttempts && placed < cc.logDither; a++) {
      const u = (rnd() * 2 - 1) * alongHalf
      const v = (rnd() * 2 - 1) * acrossHalf
      const x = logAx * u + logPx * v
      const z = logAz * u + logPz * v
      const res = resourceAt(sub, x, z)
      if (res.layer !== 'bark' && res.layer !== 'sapwood' && res.layer !== 'heartwood') continue
      placed++
      const col = res.layer === 'bark' ? C_BARK : res.layer === 'sapwood' ? C_SAPWOOD : C_HEARTWOOD
      const y = surfaceY(x, z) + 0.15
      const fade = edgeFade(x, z)
      draw.pushPoint(x * R, y, z * R, tint(col, fade), 0.5 + rnd() * 0.7, 0)
    }
  }

  // ─── TRONCO: wireframe — 3 anillos concéntricos (una capa cada uno) + la
  // línea de cresta central. Un anillo a distancia radial `rad` del eje es
  // exactamente el contorno iso-radial de decay.js: dos tramos rectos más dos
  // semicírculos en las puntas (la misma cápsula 2D, vista de perfil). ─────
  function stadiumRing(rad, color) {
    if (rad <= 1e-4) {
      // Degenerado: la cresta central es solo el segmento del eje.
      const x0 = logAx * -halfLen, z0 = logAz * -halfLen
      const x1 = logAx * halfLen, z1 = logAz * halfLen
      const y = domeHeight(0)
      draw.pushLine(x0 * R, y, z0 * R, x1 * R, y, z1 * R,
        tint(color, edgeFade(x0, z0)), tint(color, edgeFade(x1, z1)))
      return
    }
    const straightSegs = 18, arcSegs = 12
    const pts = []
    for (let i = 0; i <= straightSegs; i++) pts.push([-halfLen + (2 * halfLen) * (i / straightSegs), -rad])
    for (let i = 1; i <= arcSegs; i++) {
      const ang = -Math.PI / 2 + Math.PI * (i / arcSegs)
      pts.push([halfLen + Math.cos(ang) * rad, Math.sin(ang) * rad])
    }
    for (let i = 1; i <= straightSegs; i++) pts.push([halfLen - (2 * halfLen) * (i / straightSegs), rad])
    for (let i = 1; i <= arcSegs; i++) {
      const ang = Math.PI / 2 + Math.PI * (i / arcSegs)
      pts.push([-halfLen + Math.cos(ang) * rad, Math.sin(ang) * rad])
    }
    const y = domeHeight(rad)
    for (let i = 0; i < pts.length; i++) {
      const [u0, v0] = pts[i], [u1, v1] = pts[(i + 1) % pts.length]
      const x0 = logAx * u0 + logPx * v0, z0 = logAz * u0 + logPz * v0
      const x1 = logAx * u1 + logPx * v1, z1 = logAz * u1 + logPz * v1
      draw.pushLine(x0 * R, y, z0 * R, x1 * R, y, z1 * R,
        tint(color, edgeFade(x0, z0)), tint(color, edgeFade(x1, z1)))
    }
  }
  stadiumRing(logR, C_BARK)
  stadiumRing(logR * (1 - cc.substrate.barkFrac), C_SAPWOOD)
  stadiumRing(logR * (1 - cc.substrate.barkFrac - cc.substrate.sapwoodFrac), C_HEARTWOOD)
  stadiumRing(0, C_HEARTWOOD)

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

  const netMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 })
  const netBuf = createLineBuffer(cc.mycelium.maxEdges, netMat)
  scene.add(netBuf.mesh)
  const tipsCloud = createPointCloud(cc.mycelium.maxTips, draw.pointMaterial)
  scene.add(tipsCloud.mesh)

  function drawNetwork() {
    netBuf.begin()
    for (const e of net.edges) {
      if (!e.alive) continue
      const a = net.nodes[e.a], b = net.nodes[e.b]
      const base = C_COLONY[e.colony] || C_COLONY[0]
      // Los cordones gruesos (más flujo acumulado) se leen más brillantes que
      // el frente difuso recién tendido (spec §10).
      const bright = Math.min(1, 0.32 + e.width * 6)
      const fa = edgeFade(a.x, a.z) * bright
      const fb = edgeFade(b.x, b.z) * bright
      const ya = surfaceY(a.x, a.z) + 0.4, yb = surfaceY(b.x, b.z) + 0.4
      netBuf.push(a.x * R, ya, a.z * R, b.x * R, yb, b.z * R, tint(base, fa), tint(base, fb))
    }
    netBuf.commit()
  }
  function drawTips() {
    const tp = tipPositions(net)
    for (let i = 0; i < cc.mycelium.maxTips; i++) {
      if (i < tp.length) {
        const t = tp[i]
        const base = C_COLONY[t.colony] || C_COLONY[0]
        // Las puntas son el latido visual del mundo: más claras que la red,
        // sin el atenuado por grosor de las aristas.
        const glow = [
          base[0] + (1 - base[0]) * 0.4,
          base[1] + (1 - base[1]) * 0.4,
          base[2] + (1 - base[2]) * 0.4,
        ]
        const fade = edgeFade(t.x, t.z)
        tipsCloud.pos[i * 3] = t.x * R
        tipsCloud.pos[i * 3 + 1] = surfaceY(t.x, t.z) + 0.7
        tipsCloud.pos[i * 3 + 2] = t.z * R
        tipsCloud.col[i * 3] = glow[0] * fade
        tipsCloud.col[i * 3 + 1] = glow[1] * fade
        tipsCloud.col[i * 3 + 2] = glow[2] * fade
        tipsCloud.size[i] = 0.9
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
