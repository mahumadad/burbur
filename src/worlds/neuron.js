import * as THREE from 'three'
import { createStage } from '../render/stage.js'
import { createDraw, createPointCloud } from '../render/engine/points.js'
import { createAgentKit } from '../render/engine/agents3d.js'
import { createTrails } from '../render/engine/trails.js'
import { PALETTE } from '../config.js'
import { createNetwork, outgoing } from '../sim/netwire.js'
import { createSpikes, fire, updateSpikes } from '../sim/spikes.js'
import { createBrain, updateBrain } from '../sim/brainstate.js'
import { createRoamers, updateRoamers } from '../sim/wander.js'

// MUNDO NEURONA — una microred cortical vista desde arriba. Los somas están
// FIJOS (spec §3.1): es el único mundo de burbur donde los individuos con nombre
// no deambulan. Lo que se mueve es la SEÑAL — el potencial de acción recorriendo
// los axones (saltatorio en los mielinizados), y al llegar al terminal empuja a
// la neurona siguiente, así la actividad se propaga en ondas por la red.
//
// El cableado (netwire.js) y la propagación (spikes.js) son puros y testeados;
// este archivo los dibuja. Los astrocitos son los únicos que se desplazan.
//
// Registro visual: se mantiene el wireframe + puntos del proyecto, pero la red y
// los pulsos se dibujan con blending ADITIVO (como el micelio), así el tejido
// BRILLA sobre el negro y los pulsos se leen como corriente eléctrica — la
// energía de una micrografía de fluorescencia, sin salir del lenguaje de líneas.
//
// El arbor dendrítico se genera con un pequeño recursivo (no con mycelium.js como
// sugería §5.2): un árbol controlado se lee más limpio y evita 12 redes en el build.

const rnd = Math.random

function rgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
}
function tint(c, k) { return [c[0] * k, c[1] * k, c[2] * k] }

const C_DEND = rgb(PALETTE.cyanSat)
const C_AXON = rgb(PALETTE.blue)
const C_MYELIN = rgb(PALETTE.cyan)
const C_NODE = rgb(PALETTE.yellow)
const C_TERMINAL = rgb(PALETTE.pink)
const C_CAPILLARY = rgb(PALETTE.magenta)
const C_NEUROPIL = [0.16, 0.20, 0.38]
// Astrocito: ámbar APAGADO. Son soporte de fondo (§3.1), no protagonistas — con
// el bond pleno robaban la escena a los pulsos, que son el sujeto del mundo.
const GLIA_COL = 0x5a3d18
// Jaula del soma: contorno MUY tenue. Antes leía como "diagrama"; ahora es un
// fantasma del cuerpo celular y mandan el núcleo, el halo y las dendritas.
const SOMA_COL = 0x39456a
// Color por TIPO: la excitatoria (glutamato) fluye en CIAN; la inhibitoria
// (GABA) en ROSA. Tiñe las dendritas, el halo del soma y la energía que sale por
// su axón — así un vistazo dice quién excita y quién inhibe.
const C_EXC = [0.42, 1.0, 1.0]
const C_INH = [1.0, 0.42, 0.80]
const kindCol = (kind) => (kind === 'pyramidal' ? C_EXC : C_INH)

// Banda dominante (Hz) de cada estado de sueño → velocidad del throb del drone.
// Delta lento en sueño profundo; alfa/gamma rápido despierto (§7.2 del spec).
const BAND_HZ = {
  'quiet wake': 9, 'alert wake': 14, 'focused': 20, 'drowsy': 6,
  'N1': 5, 'N2 spindles': 13, 'N3 slow wave': 2.5, 'N3 deep': 1.2,
  'N2 return': 13, 'REM': 7, 'REM burst': 8, 'waking': 9,
}
// El pulso: núcleo casi blanco con halo amarillo (el color del spike, §5.3).
const C_SPIKE = [1.0, 0.95, 0.55]
const C_SPIKE_HOT = [1.0, 1.0, 0.9]

/** Punto (x,z) sobre la polilínea de un axón en el parámetro t∈0..1. */
function axonAt(axon, t) {
  const f = Math.max(0, Math.min(1, t)) * (axon.length - 1)
  const i = Math.floor(f), j = Math.min(axon.length - 1, i + 1), u = f - i
  return { x: axon[i].x + (axon[j].x - axon[i].x) * u, z: axon[i].z + (axon[j].z - axon[i].z) * u }
}

export function createNeuronScene(container, cfg, agentNames = []) {
  const R = cfg.world.radius
  const cc = cfg.neuron
  const rc = cfg.render
  const H = cc.height

  const stage = createStage(container, cfg)
  const { scene, camera } = stage
  const draw = createDraw(rc)          // geometría estática (red + fondo)
  const kit = createAgentKit(rc)
  // Segunda instancia SOLO por su material de puntos, que pasamos a ADITIVO: es
  // el que usan los pulsos y los halos de disparo para brillar sobre el negro.
  const glow = createDraw(rc)
  glow.pointMaterial.blending = THREE.AdditiveBlending
  glow.pointMaterial.depthWrite = false

  // ─── El cableado (puro, sim/netwire.js) ───────────────────────────────────
  const net = createNetwork(cc.network, rnd)
  const spikes = createSpikes(cc.spikes)
  const brain = createBrain(cc.brain)
  let baseOmegas = null      // omegas del swarm sin escalar (se captura al 1er frame)
  let seizeFlash = 0         // beat del destello de la convulsión
  // Sinapsis salientes por neurona, precomputadas (para lanzar al disparar).
  const outs = net.neurons.map((nrn) => outgoing(net, nrn.i))

  function pushRing(cx, cy, cz, r, segs, col) {
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2, b = ((i + 1) / segs) * Math.PI * 2
      draw.pushLine(cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r,
        cx + Math.cos(b) * r, cy, cz + Math.sin(b) * r, col, col)
    }
  }

  // ─── NEUROPILO: la maraña de fondo, MUY apagada (que el flujo destaque) ─────
  for (let i = 0; i < cc.neuropil; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.98
    const k = 0.25 + rnd() * 0.3
    draw.pushPoint(Math.cos(a) * r * R, H - 0.6 + rnd() * 1.2, Math.sin(a) * r * R,
      tint(C_NEUROPIL, k), 0.16 + rnd() * 0.20, 0)
  }

  // ─── CAPILAR: línea serpenteante de fondo, con glóbulos ────────────────────
  {
    const segs = cc.capillarySegs, y = H - 1.2
    const phase = rnd() * 6.28, amp = 0.28
    let prev = null
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const x = (t * 2 - 1) * 0.95
      const z = Math.sin(t * 6 + phase) * amp + Math.sin(t * 2.3) * 0.15
      const col = tint(C_CAPILLARY, 0.4)
      if (prev) draw.pushLine(prev[0] * R, y, prev[1] * R, x * R, y, z * R, col, col)
      if (i % 4 === 0) draw.pushPoint(x * R, y, z * R, tint(C_CAPILLARY, 0.6), 0.5, 0)
      prev = [x, z]
    }
  }

  // ─── DENDRITAS: árbol ramificado desde cada soma ───────────────────────────
  // Dendritas EN EL COLOR DE SU NEURONA (cian excitatoria / rosa inhibitoria):
  // así cada cuerpo celular luce su penacho de procesos, del mismo color que la
  // energía que maneja — es lo que lo hace leer como neurona y no como nodo.
  const d = cc.dendrite
  function growDendrite(x, z, ang, len, level, col) {
    if (level <= 0) return
    for (let b = 0; b < d.branches; b++) {
      const a = ang + (b - (d.branches - 1) / 2) * (d.spread / d.branches) + (rnd() - 0.5) * d.jitter
      const ex = x + Math.cos(a) * len, ez = z + Math.sin(a) * len
      // Más brillante cerca del soma (nivel alto), se apaga hacia las puntas.
      const c = tint(col, 0.16 + 0.14 * level)
      draw.pushLine(x * R, H, z * R, ex * R, H, ez * R, c, tint(col, 0.08))
      for (let s = 0; s < d.spines; s++) {
        const t = (s + 1) / (d.spines + 1)
        draw.pushPoint((x + (ex - x) * t) * R, H, (z + (ez - z) * t) * R, tint(col, 0.30), 0.20, 0)
      }
      growDendrite(ex, ez, a, len * d.lenDecay, level - 1, col)
    }
  }
  const NR = 5 // dendritas primarias por soma (un penacho más tupido)
  for (const nrn of net.neurons) {
    const col = kindCol(nrn.kind)
    for (let k = 0; k < NR; k++) {
      const a = (k / NR) * Math.PI * 2 + rnd() * 0.6
      growDendrite(nrn.x, nrn.z, a, d.len, d.levels, col)
    }
  }

  // ─── AXONES: mielinizado (doble vaina + nodos) vs amielínico (línea fina) ──
  const SO = cc.somaR * 1.3
  for (const syn of net.synapses) {
    const ax = syn.axon
    if (syn.myelinated) {
      for (let i = 1; i < ax.length; i++) {
        const p = ax[i - 1], q = ax[i]
        const dx = q.x - p.x, dz = q.z - p.z
        const dl = Math.hypot(dx, dz) || 1e-6
        const nx = -dz / dl * SO, nz = dx / dl * SO
        const c = tint(C_MYELIN, 0.28)
        draw.pushLine((p.x + nx) * R, H, (p.z + nz) * R, (q.x + nx) * R, H, (q.z + nz) * R, c, c)
        draw.pushLine((p.x - nx) * R, H, (p.z - nz) * R, (q.x - nx) * R, H, (q.z - nz) * R, c, c)
      }
    } else {
      for (let i = 1; i < ax.length; i++) {
        const p = ax[i - 1], q = ax[i]
        const c = tint(C_AXON, 0.5)
        draw.pushLine(p.x * R, H, p.z * R, q.x * R, H, q.z * R, c, c)
      }
    }
    // Cono axónico: punto amarillo apagado donde nace el pulso.
    draw.pushPoint(ax[0].x * R, H, ax[0].z * R, tint(C_NODE, 0.4), 0.4, 0)
    // Botón terminal: anillo + vesículas.
    const end = ax[ax.length - 1]
    pushRing(end.x * R, H, end.z * R, cc.somaR * R * 0.7, 8, tint(C_TERMINAL, 0.7))
    for (let v = 0; v < 5; v++) {
      draw.pushPoint((end.x + (rnd() - 0.5) * cc.somaR) * R, H, (end.z + (rnd() - 0.5) * cc.somaR) * R,
        tint(C_TERMINAL, 0.8), 0.3, 0)
    }
  }

  // La red brilla: blending ADITIVO sobre el negro (como el micelio). Los nodos
  // de Ranvier viven en un buffer aparte porque se ENCIENDEN al pasar el pulso.
  draw.finalizeLines(scene, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }))
  draw.finalizePoints(scene)

  // ─── NODOS DE RANVIER (dinámicos): se encienden cuando pasa el pulso ───────
  // Cada nodo es un punto aditivo que late al ser cruzado — el latido saltatorio.
  const nodeList = [] // {x, z, glow}
  for (const syn of net.synapses) {
    if (!syn.myelinated) continue
    for (const t of syn.nodes) {
      const p = axonAt(syn.axon, t)
      nodeList.push({ x: p.x, z: p.z, glow: 0 })
    }
  }
  const nodeCloud = createPointCloud(Math.max(1, nodeList.length), glow.pointMaterial)
  scene.add(nodeCloud.mesh)

  // ─── FLUJO CONTINUO (dinámico): el murmullo de energía por cada axón ───────
  // Muchos puntos tenues corriendo sin parar por los axones: es lo que hace que
  // la red se lea VIVA, con energía intercambiándose todo el tiempo (como las
  // referencias). Los spikes brillantes de abajo son los potenciales de acción
  // REALES que corren ENCIMA de este murmullo.
  const flow = []
  for (let s = 0; s < net.synapses.length; s++) {
    for (let k = 0; k < cc.flow.perAxon; k++) {
      flow.push({ syn: s, t: k / cc.flow.perAxon, speed: cc.flow.speed * (0.7 + rnd() * 0.6) })
    }
  }
  const flowCloud = createPointCloud(Math.max(1, flow.length), glow.pointMaterial)
  scene.add(flowCloud.mesh)

  // ─── HALO de cada soma: un glow suave que lo hace leer como cuerpo celular ─
  const somaGlow = createPointCloud(net.neurons.length, glow.pointMaterial)
  scene.add(somaGlow.mesh)

  // ─── PULSOS (dinámicos): halo + cabeza caliente + estela, aditivos ─────────
  const SPK = cc.spikes.trail + 2 // halo + cabeza + estela
  const spikeCloud = createPointCloud(cc.spikes.cap * SPK, glow.pointMaterial)
  scene.add(spikeCloud.mesh)

  // ─── SOMAS (fijos): 12 neuronas con jaula, NÚCLEO encendido, nombre y voz ──
  const n = cfg.fireflies.count
  const agents = []
  const worldPos = new Float32Array(n * 3)
  const sr = cc.somaR * R
  for (const nrn of net.neurons) {
    const group = new THREE.Group()
    if (nrn.kind === 'pyramidal') {
      group.add(kit.frustumCage(sr * 1.4, sr * 0.35, sr * 2.4, SOMA_COL))
    } else {
      group.add(kit.ringLoop(sr * 0.9, 10, SOMA_COL))
    }
    // Núcleo: esfera que se ENCIENDE al disparar (el color del soma en las refs).
    const nucMat = new THREE.MeshBasicMaterial({ color: PALETTE.magenta })
    group.add(new THREE.Mesh(new THREE.SphereGeometry(sr * 0.5, 12, 10), nucMat))
    group.position.set(nrn.x * R, H, nrn.z * R)
    scene.add(group)
    agents.push({ group, kind: nrn.kind, fixed: true, x: nrn.x, z: nrn.z, baseScale: 1, nucMat })
  }

  // ─── ASTROCITOS (glía): estrellas que derivan lento ───────────────────────
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
    g.add(kit.fatLine(seg, GLIA_COL))
    return g
  }
  for (let k = 0; k < gliaCount; k++) {
    const group = makeStar()
    scene.add(group)
    agents.push({ group, kind: 'glia', fixed: false, baseScale: 0.9, roamer: k })
  }
  const trails = createTrails(scene, gliaCount, new Array(gliaCount).fill(GLIA_COL), rc, draw.pointMaterial, 0.6)

  stage.setResizeHook((m) => {
    draw.uniforms.uProj.value = m.proj
    glow.uniforms.uProj.value = m.proj
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
  let lastThrobHz = null // última banda emitida al drone (para no repetir por frame)
  let lastSwarm = null   // referencia al swarm (para el shock del botón agitar)
  let shockT = 0         // tiempo restante del fogonazo del shock (0 = sin shock)

  // Escribe un pulso en el buffer aditivo desde `base`: un halo grande y tenue
  // (bloom) + una cabeza caliente casi blanca + una estela que se apaga detrás.
  function put(idx, x, z, col, size) {
    spikeCloud.pos[idx * 3] = x * R; spikeCloud.pos[idx * 3 + 1] = H; spikeCloud.pos[idx * 3 + 2] = z * R
    spikeCloud.col[idx * 3] = col[0]; spikeCloud.col[idx * 3 + 1] = col[1]; spikeCloud.col[idx * 3 + 2] = col[2]
    spikeCloud.size[idx] = size
  }
  function writeSpike(base, sp) {
    const ax = net.synapses[sp.syn].axon
    const head = axonAt(ax, sp.t)
    put(base, head.x, head.z, tint(C_SPIKE, 0.55), 5.0)       // halo (bloom)
    put(base + 1, head.x, head.z, C_SPIKE_HOT, 2.6)           // cabeza caliente
    for (let k = 1; k <= cc.spikes.trail; k++) {              // estela
      const idx = base + 1 + k
      const tt = sp.t - k * 0.04
      if (tt < 0) { spikeCloud.pos[idx * 3 + 1] = -9999; continue }
      const p = axonAt(ax, tt)
      const f = 1 - k / (cc.spikes.trail + 1)
      put(idx, p.x, p.z, tint(C_SPIKE, f), 1.4 * f)
    }
  }

  function update(swarm, dt, eco) {
    const step = dt || 0.016
    clock += step
    draw.uniforms.uT.value = clock
    glow.uniforms.uT.value = clock
    lastSwarm = swarm
    const events = []

    // ── SHOCK del botón agitar: TODO el sistema encendido, luego reset ────────
    // Mientras dura, `blaze` (1→0) enciende somas, flujo y nodos y mantiene el
    // fogonazo de pantalla. Al terminar, la red se resetea y cae en calma.
    const blaze = shockT > 0 ? Math.max(0, Math.min(1, shockT / cc.shock.dur)) : 0
    if (shockT > 0) {
      shockT -= step
      stage.flash(blaze * 0.6)
      if (shockT <= 0 && swarm) {
        brain.mode = 'postictal'; brain.timer = 0; brain.risk = 0; brain.down = false
        for (let i = 0; i < swarm.phases.length; i++) { swarm.phases[i] = Math.random() * Math.PI * 2; swarm.flash[i] = 0 }
      }
    }

    // ── Estado cerebral: el eje del mundo (sim/brainstate.js) ─────────────────
    // Traduce el estado de sueño + el neuromodulador en cómo se comporta la red:
    // sincronía, ritmo, estados UP/DOWN, husos y la convulsión.
    let activity = 1, excMul = 1, inhMul = 1
    if (swarm) {
      if (!baseOmegas) baseOmegas = Float32Array.from(swarm.omegas)
      const bs = updateBrain(brain, cc.brain, step, {
        phase: eco ? eco.phase : 'quiet wake',
        excitatory: eco ? ['noradrenergic', 'caffeine', 'dopaminergic'].includes(eco.weather) : false,
        calming: eco ? eco.weather === 'gabaergic' : false,
        tension: eco ? eco.tension : 0.2,
      }, rnd)
      activity = bs.firing; excMul = bs.excMul; inhMul = bs.inhMul
      // Ritmo: reescala las frecuencias propias (lento dormido, rápido despierto).
      for (let i = 0; i < baseOmegas.length; i++) swarm.omegas[i] = baseOmegas[i] * bs.omegaScale
      // Sincronía: empuja las fases hacia la media según cuánto falte para el
      // objetivo. Es el knob que hace latir la red entera en sueño profundo y
      // que la desboca en la convulsión.
      const nn = net.neurons.length
      let sx = 0, sy = 0
      for (let i = 0; i < nn; i++) { sx += Math.cos(swarm.phases[i]); sy += Math.sin(swarm.phases[i]) }
      const meanA = Math.atan2(sy, sx), order = Math.hypot(sx, sy) / nn
      const k = cc.brain.syncPull * Math.max(0, bs.syncTarget - order) * step
      if (k > 0) for (let i = 0; i < nn; i++) {
        const dph = Math.atan2(Math.sin(meanA - swarm.phases[i]), Math.cos(meanA - swarm.phases[i]))
        swarm.phases[i] = (swarm.phases[i] + k * dph + Math.PI * 2) % (Math.PI * 2)
      }
      // Destello que barre la red durante la crisis, latiendo a ~3 Hz.
      if (bs.flash > 0) { seizeFlash += step; if (seizeFlash > 0.33) { seizeFlash = 0; stage.flash(0.4) } }
      for (const ev of bs.events) {
        const conflict = ev.kind === 'seizure' || ev.kind === 'postictal'
        events.push({ type: conflict ? 'conflict' : 'moment', kind: ev.kind })
      }
    }

    // ── Disparo: cuando el swarm cruza el umbral, la neurona larga un pulso por
    //    cada axón saliente. En estado DOWN o postictal (activity 0) la red calla.
    if (swarm && activity > 0) {
      for (let i = 0; i < net.neurons.length; i++) {
        if (swarm.flash[i] > cc.spikes.fireThresh && fire(spikes, net, cc.spikes, i, outs[i])) {
          // Un click seco por disparo (el registro multiunidad): paneado por la
          // posición de la neurona, más agudo si es una interneurona (dispara rápido).
          events.push({ type: 'spike', pan: Math.max(-1, Math.min(1, net.neurons[i].x)),
            bright: net.neurons[i].kind === 'pyramidal' ? 0.7 : 1.3 })
        }
      }
    }
    // ── Los pulsos avanzan; las llegadas empujan la fase de la postsináptica
    //    (+ excita / − inhibe): así la actividad se propaga en ondas visibles.
    const arrivals = updateSpikes(spikes, net, cc.spikes, step)
    for (const arr of arrivals) {
      const syn = net.synapses[arr.syn]
      if (swarm) {
        // El desbalance E/I de la convulsión amplifica la excitación y hunde la
        // inhibición: cada disparo provoca los siguientes (reclutamiento).
        const bump = syn.sign > 0 ? cc.spikes.exciteBump * excMul : -cc.spikes.inhibitBump * inhMul
        swarm.phases[syn.post] = (swarm.phases[syn.post] + bump + Math.PI * 2) % (Math.PI * 2)
      }
      // Enciende el terminal (glía/postsináptica) — un destello en la hendidura.
      const end = syn.axon[syn.axon.length - 1]
      for (const nd of nodeList) { // el nodo más cercano al terminal se aviva
        if (Math.abs(nd.x - end.x) < 0.04 && Math.abs(nd.z - end.z) < 0.04) nd.glow = 1
      }
    }

    // ── Flujo continuo de energía por los axones (el murmullo de fondo) ───────
    for (let i = 0; i < flow.length; i++) {
      const fp = flow[i]
      fp.t += fp.speed * step
      if (fp.t >= 1) fp.t -= 1
      const p = axonAt(net.synapses[fp.syn].axon, fp.t)
      // Parpadeo × gate de actividad: en estado DOWN o postictal el flujo se
      // apaga casi del todo, y la red se ve callar entera.
      const tw = (0.6 + 0.4 * (0.5 + 0.5 * Math.sin(clock * 3 + i * 1.7))) * (0.25 + 0.75 * activity)
      // La energía sale con el color de la neurona que la manda (cian/rosa); en
      // el shock, todo el flujo blanquea y se enciende a pleno.
      const col = net.synapses[fp.syn].sign > 0 ? C_EXC : C_INH
      const cr = col[0] + (1 - col[0]) * blaze, cg = col[1] + (1 - col[1]) * blaze, cb = col[2] + (1 - col[2]) * blaze
      const bw = Math.max(tw, blaze)
      flowCloud.pos[i * 3] = p.x * R; flowCloud.pos[i * 3 + 1] = H; flowCloud.pos[i * 3 + 2] = p.z * R
      flowCloud.col[i * 3] = cr * bw
      flowCloud.col[i * 3 + 1] = cg * bw
      flowCloud.col[i * 3 + 2] = cb * bw
      flowCloud.size[i] = cc.flow.size * (1 + blaze * 0.8)
    }
    flowCloud.commit()

    // ── Astrocitos derivando ─────────────────────────────────────────────────
    updateRoamers(gliaRoamers, cc.wander, step, rnd, clock)

    for (let i = 0; i < n; i++) {
      const a = agents[i]
      // Durante el shock, todas las neuronas se encienden a la vez (blaze).
      const flash = Math.max(swarm ? swarm.flash[i] : 0, blaze)
      const pulse = 1 + flash * 0.45
      if (a.fixed) {
        worldPos[i * 3] = a.x * R; worldPos[i * 3 + 1] = H; worldPos[i * 3 + 2] = a.z * R
        // El núcleo se ENCIENDE al disparar: de magenta apagado a casi blanco.
        const g = 0.5 + flash * 0.5
        a.nucMat.color.setRGB(1.0 * g, (0.12 + flash * 0.8) * g, (0.56 + flash * 0.3) * g)
        // Halo del cuerpo celular EN SU COLOR (cian/rosa): glow suave que crece
        // con el disparo hasta casi blanco.
        const gb = 0.30 + flash * 1.0
        const hc = kindCol(a.kind)
        somaGlow.pos[i * 3] = a.x * R; somaGlow.pos[i * 3 + 1] = H; somaGlow.pos[i * 3 + 2] = a.z * R
        somaGlow.col[i * 3] = (hc[0] + (1 - hc[0]) * flash) * gb
        somaGlow.col[i * 3 + 1] = (hc[1] + (1 - hc[1]) * flash) * gb
        somaGlow.col[i * 3 + 2] = (hc[2] + (1 - hc[2]) * flash) * gb
        somaGlow.size[i] = 5.5 + flash * 4
      } else {
        const r = gliaRoamers[a.roamer]
        const x = r.x * R, z = r.z * R
        a.group.position.set(x, H, z)
        a.group.rotation.y += 0.15 * step
        worldPos[i * 3] = x; worldPos[i * 3 + 1] = H; worldPos[i * 3 + 2] = z
      }
      a.group.scale.setScalar(a.baseScale * pulse)
    }
    somaGlow.commit()
    trails.update(worldPos)

    // ── Dibujo de los pulsos en vuelo ─────────────────────────────────────────
    let slot = 0
    for (const sp of spikes.active) {
      if (slot >= cc.spikes.cap) break
      writeSpike(slot * SPK, sp)
      // El pulso mielinizado enciende el nodo que va cruzando (saltatorio).
      if (sp.node >= 0) {
        const ax = net.synapses[sp.syn].axon
        const p = axonAt(ax, net.synapses[sp.syn].nodes[sp.node])
        for (const nd of nodeList) if (Math.abs(nd.x - p.x) < 0.02 && Math.abs(nd.z - p.z) < 0.02) nd.glow = 1
      }
      slot++
    }
    // Apaga los slots del pool que no se usaron este frame.
    for (let s = slot * SPK; s < cc.spikes.cap * SPK; s++) spikeCloud.pos[s * 3 + 1] = -9999
    spikeCloud.commit()

    // ── Nodos de Ranvier: laten y se apagan ───────────────────────────────────
    const nodeDecay = Math.exp(-step / 0.12)
    for (let i = 0; i < nodeList.length; i++) {
      const nd = nodeList[i]
      nd.glow *= nodeDecay
      // En el shock todos los nodos se encienden a la vez.
      const base = 0.25, g = base + Math.max(nd.glow, blaze) * 1.4
      nodeCloud.pos[i * 3] = nd.x * R; nodeCloud.pos[i * 3 + 1] = H; nodeCloud.pos[i * 3 + 2] = nd.z * R
      nodeCloud.col[i * 3] = C_NODE[0] * g; nodeCloud.col[i * 3 + 1] = C_NODE[1] * g; nodeCloud.col[i * 3 + 2] = C_NODE[2] * g
      nodeCloud.size[i] = 0.45 + nd.glow * 0.5
    }
    nodeCloud.commit()

    // ── Etiqueta al pasar el mouse ────────────────────────────────────────────
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

    if (eco) {
      scene.fog.density = 0.0009 + eco.fog * 0.0022
      // El ritmo cerebral del estado actual modula el throb del drone. Se emite
      // solo cuando cambia la banda (al entrar al mundo y al cambiar de estado).
      const hz = BAND_HZ[eco.phase] || 6
      if (hz !== lastThrobHz) { events.push({ type: 'throb', hz }); lastThrobHz = hz }
    }
    stage.render(step)
    return events
  }

  // El botón AGITAR de este mundo no dispersa: es una DESCARGA ELÉCTRICA que
  // enciende TODO el sistema a la vez — como una terapia de shock — y después
  // resetea y calma la red (el reset ocurre al terminar el fogonazo, en update).
  function scare(strength = 1) {
    shockT = cc.shock.dur                          // arranca el fogonazo
    stage.flash(cc.shock.flash * strength)         // pantalla iluminada
    // Descarga SINCRONIZADA: cada neurona dispara a la vez y suelta un pulso por
    // todos sus axones — un frente de luz que barre el sistema entero. Se limpia
    // el refractario para que ninguna quede afuera del choque.
    if (lastSwarm) {
      for (let i = 0; i < net.neurons.length; i++) {
        lastSwarm.flash[i] = 1
        spikes.refractory[i] = 0
        fire(spikes, net, cc.spikes, i, outs[i])
      }
    }
    // Los astrocitos también reaccionan al choque.
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
