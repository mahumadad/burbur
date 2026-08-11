import * as THREE from 'three'
import { createStage } from '../render/stage.js'
import { createDraw } from '../render/engine/points.js'
import { createAgentKit } from '../render/engine/agents3d.js'
import { createTrails } from '../render/engine/trails.js'
import { PALETTE } from '../config.js'
import { createNetwork } from '../sim/netwire.js'
import { createRoamers, updateRoamers } from '../sim/wander.js'

// MUNDO NEURONA (F1) — una microred cortical vista desde arriba. Los somas están
// FIJOS (spec §3.1): es el único mundo de burbur donde los individuos con nombre
// no deambulan. Lo que se mueve es la señal — pero eso llega en F2 (spikes) y F3
// (sinapsis). F1 es solo la red estática, reconocible, con dispose limpio.
//
// El cableado (quién conecta con quién, dónde está cada soma, los axones y sus
// nodos de Ranvier) vive en sim/netwire.js (puro, testeado). Este archivo lo
// dibuja. Los astrocitos (glía) son los únicos que se desplazan, muy lento.
//
// Nota de implementación: el arbor dendrítico se genera acá con un pequeño
// generador recursivo, no con mycelium.js como sugería §5.2 del spec — un árbol
// controlado se lee más limpio que la maraña de hifas y evita correr 12 redes en
// el build. Es una elección de render, reversible.

const rnd = Math.random

/** Hex de PALETTE → [r,g,b] en 0..1, lo que comen los buffers de línea/punto. */
function rgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
}
function tint(c, k) { return [c[0] * k, c[1] * k, c[2] * k] }

const C_SOMA = rgb(PALETTE.white)
const C_DEND = rgb(PALETTE.cyanSat)
const C_AXON = rgb(PALETTE.blue)
const C_MYELIN = rgb(PALETTE.white)
const C_NODE = rgb(PALETTE.yellow)
const C_TERMINAL = rgb(PALETTE.pink)
const C_GLIA = rgb(PALETTE.bond)
const C_CAPILLARY = rgb(PALETTE.magenta)
const C_NEUROPIL = [0.30, 0.34, 0.52]

export function createNeuronScene(container, cfg, agentNames = []) {
  const R = cfg.world.radius
  const cc = cfg.neuron
  const rc = cfg.render
  const H = cc.height

  const stage = createStage(container, cfg)
  const { scene, camera, controls } = stage
  // La red es FIJA: no hay movimiento propio que la órbita pueda tapar, así que
  // se deja la auto-rotación del stage tal cual (decisión 8 del spec). El giro
  // lento ayuda a leer la profundidad de los axones que se cruzan.
  const draw = createDraw(rc)
  const kit = createAgentKit(rc)

  // ─── El cableado (puro, sim/netwire.js) ───────────────────────────────────
  const net = createNetwork(cc.network, rnd)

  // Empuja un anillo horizontal (segmentos de línea) al buffer estático.
  function pushRing(cx, cy, cz, r, segs, col) {
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2, b = ((i + 1) / segs) * Math.PI * 2
      draw.pushLine(cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r,
        cx + Math.cos(b) * r, cy, cz + Math.sin(b) * r, col, col)
    }
  }

  // ─── NEUROPILO: la maraña de procesos que no se dibuja, como fondo apagado ─
  for (let i = 0; i < cc.neuropil; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.98
    const k = 0.5 + rnd() * 0.6
    draw.pushPoint(Math.cos(a) * r * R, H - 0.6 + rnd() * 1.2, Math.sin(a) * r * R,
      tint(C_NEUROPIL, k), 0.16 + rnd() * 0.22, 0)
  }

  // ─── CAPILAR: línea serpenteante cruzando el fondo, con glóbulos ───────────
  {
    const segs = cc.capillarySegs
    const y = H - 1.2
    const phase = rnd() * 6.28, amp = 0.28
    let prev = null
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const x = (t * 2 - 1) * 0.95
      const z = Math.sin(t * 6 + phase) * amp + Math.sin(t * 2.3) * 0.15
      const col = tint(C_CAPILLARY, 0.45)
      if (prev) draw.pushLine(prev[0] * R, y, prev[1] * R, x * R, y, z * R, col, col)
      // Glóbulos: puntos apagados pasando de a uno.
      if (i % 4 === 0) draw.pushPoint(x * R, y, z * R, tint(C_CAPILLARY, 0.7), 0.5, 0)
      prev = [x, z]
    }
  }

  // ─── DENDRITAS: árbol ramificado en el plano, desde cada soma ──────────────
  const d = cc.dendrite
  function growDendrite(x, z, ang, len, level) {
    if (level <= 0) return
    for (let b = 0; b < d.branches; b++) {
      const a = ang + (b - (d.branches - 1) / 2) * (d.spread / d.branches) + (rnd() - 0.5) * d.jitter
      const ex = x + Math.cos(a) * len, ez = z + Math.sin(a) * len
      const bright = 0.28 + 0.20 * level
      const c = tint(C_DEND, bright)
      draw.pushLine(x * R, H, z * R, ex * R, H, ez * R, c, tint(C_DEND, 0.18))
      // Espinas dendríticas: puntitos sobre la rama.
      for (let s = 0; s < d.spines; s++) {
        const t = (s + 1) / (d.spines + 1)
        draw.pushPoint((x + (ex - x) * t) * R, H, (z + (ez - z) * t) * R, tint(C_DEND, 0.4), 0.22, 0)
      }
      growDendrite(ex, ez, a, len * d.lenDecay, level - 1)
    }
  }
  const NR = 4 // dendritas primarias por soma, repartidas alrededor
  for (const nrn of net.neurons) {
    for (let k = 0; k < NR; k++) {
      const a = (k / NR) * Math.PI * 2 + rnd() * 0.6
      growDendrite(nrn.x, nrn.z, a, d.len, d.levels)
    }
  }

  // ─── AXONES: mielinizado (doble vaina + nodos) vs amielínico (línea fina) ──
  const SO = cc.somaR * 1.3 // separación de la vaina (mundo normalizado)
  for (const syn of net.synapses) {
    const ax = syn.axon
    if (syn.myelinated) {
      // Doble contorno paralelo (la vaina), segmento a segmento.
      for (let i = 1; i < ax.length; i++) {
        const p = ax[i - 1], q = ax[i]
        const dx = q.x - p.x, dz = q.z - p.z
        const dl = Math.hypot(dx, dz) || 1e-6
        const nx = -dz / dl * SO, nz = dx / dl * SO
        const c = tint(C_MYELIN, 0.5)
        draw.pushLine((p.x + nx) * R, H, (p.z + nz) * R, (q.x + nx) * R, H, (q.z + nz) * R, c, c)
        draw.pushLine((p.x - nx) * R, H, (p.z - nz) * R, (q.x - nx) * R, H, (q.z - nz) * R, c, c)
      }
      // Nodos de Ranvier: puntos brillantes donde el pulso se regenera.
      for (const t of syn.nodes) {
        const f = t * (ax.length - 1), i = Math.floor(f), u = f - i
        const j = Math.min(ax.length - 1, i + 1)
        const x = ax[i].x + (ax[j].x - ax[i].x) * u, z = ax[i].z + (ax[j].z - ax[i].z) * u
        draw.pushPoint(x * R, H, z * R, C_NODE, 0.6, 0)
      }
    } else {
      // Amielínico: una sola línea fina y tenue.
      for (let i = 1; i < ax.length; i++) {
        const p = ax[i - 1], q = ax[i]
        const c = tint(C_AXON, 0.6)
        draw.pushLine(p.x * R, H, p.z * R, q.x * R, H, q.z * R, c, c)
      }
    }
    // Cono axónico: un punto amarillo apagado donde nace el pulso (arranque).
    draw.pushPoint(ax[0].x * R, H, ax[0].z * R, tint(C_NODE, 0.5), 0.4, 0)
    // Botón terminal: bulbo (anillo + puntos de vesículas) en el final del axón.
    const end = ax[ax.length - 1]
    pushRing(end.x * R, H, end.z * R, cc.somaR * R * 0.7, 8, tint(C_TERMINAL, 0.8))
    for (let v = 0; v < 5; v++) {
      draw.pushPoint((end.x + (rnd() - 0.5) * cc.somaR) * R, H, (end.z + (rnd() - 0.5) * cc.somaR) * R,
        tint(C_TERMINAL, 0.9), 0.3, 0)
    }
  }

  draw.finalizeLines(scene, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }))
  draw.finalizePoints(scene)

  // ─── SOMAS (fijos): 12 neuronas con jaula, nombre y voz ───────────────────
  // Piramidal = cono truncado de 4 lados (frustumCage). Interneurona = anillo +
  // esfera, más chica y apretada. La forma distingue E de I, no el color (§3.1).
  const n = cfg.fireflies.count
  const agents = []
  const worldPos = new Float32Array(n * 3)
  const sr = cc.somaR * R
  for (const nrn of net.neurons) {
    const group = new THREE.Group()
    if (nrn.kind === 'pyramidal') {
      group.add(kit.frustumCage(sr * 1.4, sr * 0.35, sr * 2.4, PALETTE.white))
    } else {
      group.add(kit.ringLoop(sr * 0.9, 10, PALETTE.white))
      group.add(new THREE.Mesh(new THREE.SphereGeometry(sr * 0.55, 10, 8),
        new THREE.MeshBasicMaterial({ color: PALETTE.white })))
    }
    group.position.set(nrn.x * R, H, nrn.z * R)
    scene.add(group)
    agents.push({ group, kind: nrn.kind, fixed: true, x: nrn.x, z: nrn.z, baseScale: 1 })
  }

  // ─── ASTROCITOS (glía): los únicos que se mueven, muy lento ───────────────
  // Estrella: radios finos desde un centro (es lo que significa su nombre).
  const gliaCount = n - net.neurons.length
  const gliaRoamers = createRoamers(cc.wander, gliaCount, rnd)
  function makeStar() {
    const seg = []
    const arms = cc.glia.arms, L = cc.glia.armLen * R
    for (let k = 0; k < arms; k++) {
      const a = (k / arms) * Math.PI * 2
      seg.push(0, 0, 0, Math.cos(a) * L, (rnd() - 0.5) * L * 0.3, Math.sin(a) * L)
    }
    const g = new THREE.Group()
    g.add(kit.fatLine(seg, PALETTE.bond))
    return g
  }
  for (let k = 0; k < gliaCount; k++) {
    const group = makeStar()
    scene.add(group)
    agents.push({ group, kind: 'glia', fixed: false, baseScale: 0.9, roamer: k })
  }
  const gliaColors = new Array(gliaCount).fill(PALETTE.bond)
  const trails = createTrails(scene, gliaCount, gliaColors, rc, draw.pointMaterial, 0.6)

  stage.setResizeHook((m) => {
    draw.uniforms.uProj.value = m.proj
    kit.setResolution(m.w * m.dpr, m.h * m.dpr)
  })

  // ─── Etiqueta flotante al pasar el mouse (idéntico a cell/fungus) ─────────
  const _proj = new THREE.Vector3()
  let _lx = 0, _ly = 0
  let ptrX = null, ptrY = null
  function setPointer(x, y) { ptrX = x; ptrY = y }
  const _fk = Math.min(rc.fisheye, 0.62)
  function lensNDC(px, py) {
    let sx = px, sy = py
    for (let it = 0; it < 3; it++) {
      const rnorm = Math.hypot(sx, sy) / 0.7071
      const f = (1 - _fk) + _fk * rnorm * rnorm
      sx = px / f; sy = py / f
    }
    return [sx, sy]
  }

  let clock = 0

  function update(swarm, dt, eco) {
    const step = dt || 0.016
    clock += step
    draw.uniforms.uT.value = clock

    // Los astrocitos derivan lento por el fondo; contenidos en el disco.
    updateRoamers(gliaRoamers, cc.wander, step, rnd, clock)

    for (let i = 0; i < n; i++) {
      const a = agents[i]
      // El latido del swarm hincha el soma un instante (placeholder de F1: en F2
      // esto pasa a ser el disparo real que larga spikes por el axón).
      const flash = swarm ? swarm.flash[i] : 0
      const pulse = 1 + flash * 0.4
      if (a.fixed) {
        worldPos[i * 3] = a.x * R; worldPos[i * 3 + 1] = H; worldPos[i * 3 + 2] = a.z * R
      } else {
        const r = gliaRoamers[a.roamer]
        const x = r.x * R, z = r.z * R
        a.group.position.set(x, H, z)
        a.group.rotation.y += 0.15 * step
        worldPos[i * 3] = x; worldPos[i * 3 + 1] = H; worldPos[i * 3 + 2] = z
      }
      a.group.scale.setScalar(a.baseScale * pulse)
    }
    // Estelas SOLO de la glía (los índices fijos apuntan a su soma inmóvil, así
    // que su estela es un punto quieto — inofensiva).
    trails.update(worldPos)

    // Etiqueta: solo al pasar el mouse por encima de un individuo.
    let bestI = -1
    if (ptrX !== null) {
      let bestD = 0.14
      for (let i = 0; i < n; i++) {
        _proj.set(worldPos[i * 3], worldPos[i * 3 + 1] + 4, worldPos[i * 3 + 2]).project(camera)
        if (_proj.z > 1) continue
        const [vx, vy] = lensNDC(_proj.x, _proj.y)
        const dd = Math.hypot(vx - ptrX, vy - ptrY)
        if (dd < bestD) { bestD = dd; bestI = i; _lx = vx; _ly = vy }
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

    if (eco) scene.fog.density = 0.0009 + eco.fog * 0.0022
    stage.render(step)
    return [] // F1: la red no emite eventos propios todavía (spikes/sinapsis en F2/F3)
  }

  /** Shake: dispersa a los astrocitos (las neuronas están fijas). */
  function scare(strength = 1) {
    for (const r of gliaRoamers) {
      const m = Math.hypot(r.x, r.z) || 1e-3
      const k = (0.3 + Math.random() * 0.5) * strength
      r.vx += (r.x / m) * k + (Math.random() - 0.5) * k
      r.vz += (r.z / m) * k + (Math.random() - 0.5) * k
    }
  }

  return {
    update, scare, setPointer,
    resize: stage.resize, flash: stage.flash, dispose: stage.dispose,
  }
}
