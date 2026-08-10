import * as THREE from 'three'
import { createStage } from '../render/stage.js'
import { createDraw, createPointCloud, createLineBuffer } from '../render/engine/points.js'
import { createAgentKit } from '../render/engine/agents3d.js'
import { createTrails } from '../render/engine/trails.js'
import { PALETTE } from '../config.js'
import { createMembrane, updateMembrane, radiusAt, containsPoint } from '../sim/membrane.js'
import { createMotility, updateMotility } from '../sim/motility.js'
import { createRails, updateRails, nearestOnRails } from '../sim/rails.js'
import { createAtpPool, spawnQuantum, updateAtp } from '../sim/atp.js'
import { createInvaders, spawnInvader, updateInvaders } from '../sim/invaders.js'
import { createRoamers, updateRoamers } from '../sim/wander.js'
import { MITOTIC_PHASES } from '../sim/ecosystem.js'

// MUNDO CÉLULA — un macrófago reptando sobre un sustrato, visto desde arriba.
//
// La célula queda CENTRADA en el origen y el que se desplaza es el sustrato
// (decisión §3.3 del doc de diseño): así la órbita de la cámara y la cuenca de
// `wander.js` siguen valiendo, y el avance se lee por la forma polarizada y por
// las adhesiones que desfilan hacia atrás.
//
// Todo lo que decide COMPORTAMIENTO vive en `src/sim/*` (puro y testeado);
// este archivo solo lo dibuja.

const rnd = Math.random

/** Hex de PALETTE → [r,g,b] en 0..1, que es lo que comen los buffers de línea. */
function rgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
}
const C_MEMBRANE = rgb(PALETTE.white)
const C_FRONT = rgb(PALETTE.cyan)
const C_CORTEX = rgb(PALETTE.cyanSat)
const C_RAIL = rgb(PALETTE.blue)
const C_CHROMATIN = rgb(PALETTE.bond)
const C_ER = rgb(PALETTE.cyanSat)
const C_GOLGI = rgb(PALETTE.pink)
const C_ADHESION = rgb(PALETTE.bond)
const C_INVADER = rgb(PALETTE.magenta)
const C_SUBSTRATE = [0.30, 0.34, 0.52]

export function createCellScene(container, cfg, agentNames = []) {
  const R = cfg.world.radius
  const cc = cfg.cell
  const rc = cfg.render
  const H = cc.height

  const stage = createStage(container, cfg)
  const { scene, camera } = stage
  const draw = createDraw(rc)
  const kit = createAgentKit(rc)

  // ─── Simulación (todo puro, de src/sim) ───────────────────────────────────
  const membrane = createMembrane(cc.membrane, rnd)
  const motility = createMotility(cc.motility, rnd)
  const rails = createRails(cc.rails, rnd)
  const atp = createAtpPool(cc.atp)
  const invaders = createInvaders(cc.invaders)
  const n = cfg.fireflies.count
  const roamers = createRoamers(cc.wander, n, rnd)
  // Fuente de quimioatrayente: la célula la persigue. Al alcanzarla, aparece otra.
  let source = { x: Math.cos(1.1) * 1.2, z: Math.sin(1.1) * 1.2 }
  let invaderClock = 0

  // ─── SUSTRATO: lo único que se mueve bajo la célula ───────────────────────
  // Va en su propio grupo; deslizarlo es mover el grupo, no reescribir buffers.
  const substrate = new THREE.Group()
  scene.add(substrate)
  {
    const pos = [], col = [], size = []
    for (let i = 0; i < cc.substrateDots; i++) {
      const a = rnd() * Math.PI * 2
      const r = Math.sqrt(rnd()) * 1.75 * R
      pos.push(Math.cos(a) * r, -H, Math.sin(a) * r)
      const k = 0.5 + rnd() * 0.5
      col.push(C_SUBSTRATE[0] * k, C_SUBSTRATE[1] * k, C_SUBSTRATE[2] * k)
      size.push(0.25 + rnd() * 0.4)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('hcol', new THREE.BufferAttribute(new Float32Array(col), 3))
    geo.setAttribute('hsize', new THREE.BufferAttribute(new Float32Array(size), 1))
    geo.setAttribute('hphs', new THREE.BufferAttribute(new Float32Array(pos.length / 3), 1))
    const pts = new THREE.Points(geo, draw.pointMaterial)
    pts.frustumCulled = false
    substrate.add(pts)
  }

  // ─── ADHESIONES FOCALES: nacen bajo el frente y quedan CLAVADAS al sustrato ─
  // Por eso viven en el grupo del sustrato: desfilan hacia atrás solas, que es
  // el indicador de velocidad más honesto que tiene el mundo.
  const adhesionMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true })
  const adhesionBuf = createLineBuffer(cc.adhesions, adhesionMat)
  substrate.add(adhesionBuf.mesh)
  const adhesions = []

  // ─── NÚCLEO, NUCLEOLO, ER Y GOLGI: el paisaje interior, estático ──────────
  {
    const NR = cc.nucleusR * R
    // Núcleo: esfera de wireframe + cromatina enredada dentro.
    const sphere = new THREE.SphereGeometry(NR, 18, 12)
    const wire = new THREE.WireframeGeometry(sphere)
    const nucLines = new THREE.LineSegments(wire,
      new THREE.LineBasicMaterial({ color: PALETTE.white, transparent: true, opacity: 0.22 }))
    nucLines.position.y = H * 0.25
    scene.add(nucLines)
    sphere.dispose()

    // Poros nucleares: anillitos sobre la superficie.
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2, b = Math.acos(rnd() * 2 - 1)
      const ring = kit.ringLoop(NR * 0.09, 10, PALETTE.cyanEye)
      ring.position.set(
        Math.sin(b) * Math.cos(a) * NR,
        H * 0.25 + Math.cos(b) * NR,
        Math.sin(b) * Math.sin(a) * NR,
      )
      ring.lookAt(0, H * 0.25, 0)
      scene.add(ring)
    }
    // Cromatina: hebras que serpentean dentro del núcleo.
    for (let i = 0; i < 26; i++) {
      let x = (rnd() - 0.5) * NR, y = (rnd() - 0.5) * NR, z = (rnd() - 0.5) * NR
      for (let k = 0; k < 7; k++) {
        const nx = x + (rnd() - 0.5) * NR * 0.5
        const ny = y + (rnd() - 0.5) * NR * 0.5
        const nz = z + (rnd() - 0.5) * NR * 0.5
        draw.pushLine(x, H * 0.25 + y, z, nx, H * 0.25 + ny, nz, C_CHROMATIN, C_CHROMATIN)
        x = nx; y = ny; z = nz
      }
    }
    // Nucleolo: nube densa de puntos.
    for (let i = 0; i < 420; i++) {
      const a = rnd() * Math.PI * 2, b = Math.acos(rnd() * 2 - 1)
      const r = Math.pow(rnd(), 0.4) * NR * 0.3
      draw.pushPoint(
        Math.sin(b) * Math.cos(a) * r - NR * 0.25,
        H * 0.25 + Math.cos(b) * r,
        Math.sin(b) * Math.sin(a) * r,
        [1, 0.72, 0.4], 0.45, 0,
      )
    }

    // ER rugoso: red poligonal alrededor del núcleo, salpicada de ribosomas.
    const erPts = []
    for (let i = 0; i < 34; i++) {
      const a = rnd() * Math.PI * 2
      const r = NR * (1.25 + rnd() * 1.5)
      let x = Math.cos(a) * r, z = Math.sin(a) * r
      for (let k = 0; k < 5; k++) {
        const nx = x + (rnd() - 0.5) * R * 0.16
        const nz = z + (rnd() - 0.5) * R * 0.16
        const y = H * 0.1 + rnd() * H * 0.3
        draw.pushLine(x, y, z, nx, y, nz, C_ER, C_ER)
        erPts.push([x, y, z])
        x = nx; z = nz
      }
    }
    // Ribosomas: los puntos que dan la densidad del estilo Goodsell.
    for (let i = 0; i < cc.ribosomes; i++) {
      const p = erPts[(rnd() * erPts.length) | 0]
      if (!p) break
      draw.pushPoint(
        p[0] + (rnd() - 0.5) * R * 0.1,
        p[1] + (rnd() - 0.5) * H * 0.3,
        p[2] + (rnd() - 0.5) * R * 0.1,
        [0.55, 0.95, 0.9], 0.16, 0,
      )
    }

    // Golgi: cisternas apiladas, arcos ligeramente curvos junto al núcleo.
    const gx = NR * 1.5, gz = -NR * 0.7
    for (let c = 0; c < 5; c++) {
      const rr = NR * (0.5 + c * 0.07)
      let px = null, pz = null
      for (let s = 0; s <= 16; s++) {
        const a = -0.9 + (s / 16) * 1.8
        const x = gx + Math.cos(a) * rr, z = gz + Math.sin(a) * rr
        if (px !== null) {
          const y = H * 0.2 + c * H * 0.08
          draw.pushLine(px, y, pz, x, y, z, C_GOLGI, C_GOLGI)
        }
        px = x; pz = z
      }
    }
  }
  draw.finalizeLines(scene, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 }))
  draw.finalizePoints(scene)

  // ─── MEMBRANA: dos contornos (la bicapa) + un punto por vértice ───────────
  const MV = cc.membrane.verts
  const memMat = new THREE.LineBasicMaterial({ vertexColors: true })
  const memBuf = createLineBuffer(MV * 2 + 8, memMat)
  scene.add(memBuf.mesh)
  const memDots = createPointCloud(MV, draw.pointMaterial)
  scene.add(memDots.mesh)

  // ─── CORTEZA DE ACTINA: hebras cortas tangenciales al borde interno ───────
  const cortexMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5 })
  const cortexBuf = createLineBuffer(cc.cortexStrands, cortexMat)
  scene.add(cortexBuf.mesh)

  // ─── MICROTÚBULOS: crecen y se derrumban, así que se redibujan cada frame ─
  const railMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 })
  const railBuf = createLineBuffer(cc.rails.count, railMat)
  scene.add(railBuf.mesh)

  // ─── ATP: los cuantos, que son también el latido sonoro del mundo ─────────
  const atpCloud = createPointCloud(cc.atp.capacity, draw.pointMaterial)
  for (let i = 0; i < cc.atp.capacity; i++) {
    atpCloud.col[i * 3] = 1; atpCloud.col[i * 3 + 1] = 0.89; atpCloud.col[i * 3 + 2] = 0.10
    atpCloud.size[i] = 0.8
  }
  scene.add(atpCloud.mesh)

  // ─── INVASORES ────────────────────────────────────────────────────────────
  const invMat = new THREE.LineBasicMaterial({ vertexColors: true })
  const invBuf = createLineBuffer(cc.invaders.capacity * 7, invMat)
  scene.add(invBuf.mesh)

  // ─── ORGANELOS: los individuos con jaula, nombre y estela ─────────────────
  const KINDS = ['mitochondrion', 'vesicle', 'lysosome', 'endosome']
  const agents = []
  for (let i = 0; i < n; i++) {
    const kind = KINDS[i % KINDS.length]
    const group = new THREE.Group()
    if (kind === 'mitochondrion') {
      // Cápsula alargada con crestas: la silueta que se reconoce al instante.
      const L = 5.2, W = 2.1
      group.add(kit.edgesOf(new THREE.BoxGeometry(L, W, W), PALETTE.orange))
      const cristae = []
      for (let c = -2; c <= 2; c++) {
        const x = (c / 2.5) * L * 0.4
        cristae.push(x, -W / 2, -W / 2, x, W / 2, W / 2)
        cristae.push(x, W / 2, -W / 2, x, -W / 2, W / 2)
      }
      group.add(kit.fatLine(cristae, PALETTE.yellow))
    } else if (kind === 'vesicle') {
      // La cubierta real de clatrina se llama "cage" en la literatura.
      group.add(kit.edgesOf(new THREE.IcosahedronGeometry(2.2, 0), PALETTE.pink))
    } else if (kind === 'lysosome') {
      group.add(kit.edgesOf(new THREE.DodecahedronGeometry(2.4, 0), PALETTE.magenta))
      group.add(new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10),
        new THREE.MeshBasicMaterial({ color: PALETTE.pink })))
    } else {
      group.add(kit.edgesOf(new THREE.OctahedronGeometry(2.6), PALETTE.cyanSat))
      group.add(kit.ringLoop(1.4, 22, PALETTE.cyanEye))
    }
    const baseScale = 0.85 + rnd() * 0.5
    group.scale.setScalar(baseScale)
    scene.add(group)
    // Los organelos NO ruedan como esferas: van orientados sobre el riel.
    agents.push({ group, kind, baseScale, glide: true, spinY: kind === 'endosome' ? 0.5 : 0 })
  }

  const AGENT_COLORS = [PALETTE.orange, PALETTE.pink, PALETTE.magenta, PALETTE.cyanSat]
  const trails = createTrails(scene, n, AGENT_COLORS, rc, draw.pointMaterial)
  const worldPos = new Float32Array(n * 3)

  stage.setResizeHook((m) => {
    draw.uniforms.uProj.value = m.proj
    kit.setResolution(m.w * m.dpr, m.h * m.dpr)
  })

  // ─── Etiqueta flotante: el organelo más cercano al centro de pantalla ─────
  const _proj = new THREE.Vector3()
  let _lx = 0, _ly = 0

  let clock = 0
  let rounding = 0, roundTarget = 0
  let calciumCooldown = 5

  function drawMembrane(front) {
    memBuf.begin()
    const step = (Math.PI * 2) / MV
    for (let i = 0; i < MV; i++) {
      const a = i * step, b = ((i + 1) % MV) * step
      const r1 = radiusAt(membrane, a) * R, r2 = radiusAt(membrane, b) * R
      const x1 = Math.cos(a) * r1, z1 = Math.sin(a) * r1
      const x2 = Math.cos(b) * r2, z2 = Math.sin(b) * r2
      // El frente activo se pinta cian; el resto, blanco.
      let d = Math.abs(((a - front + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
      const lead = Math.max(0, 1 - d / 1.1)
      const col = [
        C_MEMBRANE[0] + (C_FRONT[0] - C_MEMBRANE[0]) * lead,
        C_MEMBRANE[1] + (C_FRONT[1] - C_MEMBRANE[1]) * lead,
        C_MEMBRANE[2] + (C_FRONT[2] - C_MEMBRANE[2]) * lead,
      ]
      memBuf.push(x1, 0, z1, x2, 0, z2, col, col)
      // Segunda lámina de la bicapa, un pelo más adentro.
      const k = 0.982
      memBuf.push(x1 * k, 0, z1 * k, x2 * k, 0, z2 * k, col, col)
      // Cabezas de fosfolípido: un punto por vértice.
      memDots.pos[i * 3] = x1
      memDots.pos[i * 3 + 1] = 0
      memDots.pos[i * 3 + 2] = z1
      memDots.col[i * 3] = col[0]; memDots.col[i * 3 + 1] = col[1]; memDots.col[i * 3 + 2] = col[2]
      memDots.size[i] = 0.5 + lead * 0.5
    }
    memBuf.commit()
    memDots.commit()
  }

  function drawCortex() {
    cortexBuf.begin()
    for (let i = 0; i < cc.cortexStrands; i++) {
      const a = (i / cc.cortexStrands) * Math.PI * 2
      const r = radiusAt(membrane, a) * R
      const a2 = a + 0.05
      cortexBuf.push(
        Math.cos(a) * r * 0.965, 0, Math.sin(a) * r * 0.965,
        Math.cos(a2) * r * 0.90, 0, Math.sin(a2) * r * 0.90,
        C_CORTEX, C_MEMBRANE,
      )
    }
    cortexBuf.commit()
  }

  function drawRails() {
    railBuf.begin()
    const ox = rails.origin.x * R, oz = rails.origin.z * R
    for (const r of rails.rails) {
      railBuf.push(
        ox, H * 0.15, oz,
        ox + Math.cos(r.ang) * r.len * R, H * 0.15, oz + Math.sin(r.ang) * r.len * R,
        C_RAIL, C_CORTEX,
      )
    }
    railBuf.commit()
  }

  function drawInvaders() {
    invBuf.begin()
    for (const inv of invaders) {
      if (!inv.alive) continue
      const x = inv.x * R, z = inv.z * R, y = H * 0.5
      if (inv.kind === 'bacterium') {
        // Bastón + flagelo: la silueta y el movimiento son ajenos al resto.
        const dx = Math.cos(inv.ang) * 3.2, dz = Math.sin(inv.ang) * 3.2
        invBuf.push(x - dx, y, z - dz, x + dx, y, z + dz, C_INVADER, C_INVADER)
        for (let k = 0; k < 3; k++) {
          const t = k / 3
          const w = Math.sin(clock * 12 + k * 2) * 1.4
          invBuf.push(
            x - dx - dx * t, y, z - dz - dz * t,
            x - dx - dx * (t + 0.34) + w * Math.sin(inv.ang), y,
            z - dz - dz * (t + 0.34) - w * Math.cos(inv.ang),
            C_INVADER, C_MEMBRANE,
          )
        }
      } else {
        // Virión: icosaedro diminuto con espículas. Casi invisible, a propósito.
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + clock * 0.4
          invBuf.push(x, y, z, x + Math.cos(a) * 1.5, y + 0.6, z + Math.sin(a) * 1.5,
            C_MEMBRANE, C_INVADER)
        }
      }
    }
    invBuf.commit()
  }

  function drawAdhesions() {
    adhesionBuf.begin()
    for (const ad of adhesions) {
      const f = Math.min(1, ad.age * 1.6) * Math.max(0, 1 - ad.age / ad.ttl)
      const c = [C_ADHESION[0] * f, C_ADHESION[1] * f, C_ADHESION[2] * f]
      const dx = Math.cos(ad.ang) * 2.4, dz = Math.sin(ad.ang) * 2.4
      adhesionBuf.push(ad.x - dx, -H + 0.2, ad.z - dz, ad.x + dx, -H + 0.2, ad.z + dz, c, c)
    }
    adhesionBuf.commit()
  }

  function update(swarm, dt, eco) {
    const step = dt || 0.016
    clock += step
    draw.uniforms.uT.value = clock

    // El medio pinta la célula: el "clima" modula energía y tensión.
    const demand = 0.25 + (eco ? eco.tension : 0) * 0.8
    // En mitosis la célula suelta las adherencias, se redondea y deja de reptar.
    // Entra y sale con rampa: el redondeo real tarda, no es un interruptor.
    const inMitosis = eco ? MITOTIC_PHASES.has(eco.phase) : false
    roundTarget = inMitosis ? 1 : 0
    rounding += (roundTarget - rounding) * (1 - Math.exp(-step / 2.5))

    // ── Simulación ──────────────────────────────────────────────────────────
    updateMotility(motility, cc.motility, step, rnd, {
      source, atp: atp.budget, adhesion: 0.5, rounding,
    })
    updateMembrane(membrane, cc.membrane, step, rnd, clock, {
      frontAngle: motility.frontAngle,
      protrusion: motility.protrusion,
      blebbing: motility.blebbing,
      rounding,
    })
    updateRails(rails, cc.rails, step, rnd)

    // Las mitocondrias sueltan ATP; el destello del swarm marca el pulso.
    if (swarm) {
      for (let i = 0; i < n; i++) {
        if (swarm.flash[i] > 0.85 && agents[i].kind === 'mitochondrion') {
          const t = rnd() * Math.PI * 2, tr = rnd() * 0.5
          spawnQuantum(atp, roamers[i].x, roamers[i].z, Math.cos(t) * tr, Math.sin(t) * tr)
        }
      }
    }
    updateAtp(atp, cc.atp, step, demand)

    // Invasores: llegan cada tanto y buscan la membrana.
    invaderClock -= step
    if (invaderClock <= 0) {
      invaderClock = cc.invaders.spawnEvery
      spawnInvader(invaders, cc.invaders, rnd() < 0.5 ? 'bacterium' : 'virion', rnd)
    }
    updateInvaders(invaders, cc.invaders, step, rnd, (x, z) => containsPoint(membrane, x, z))
    // Un virión que entró deja de ser un invasor DEL SUSTRATO: se lo saca para
    // que su slot vuelva a circular. Qué le pasa adentro (replicar o acabar en
    // un lisosoma) es materia de F5; sin esto, a las pocas infecciones el pool
    // queda lleno de pegados y no llega nadie más.
    for (const inv of invaders) if (inv.bound) inv.alive = false

    // Al alcanzar la fuente, aparece otra en otro punto: la célula sigue migrando.
    if (Math.hypot(source.x, source.z) < 0.9) {
      const a = rnd() * Math.PI * 2
      source = { x: Math.cos(a) * 1.3, z: Math.sin(a) * 1.3 }
    }

    // ── El sustrato corre bajo una célula centrada ──────────────────────────
    substrate.position.set(motility.subX * R, 0, motility.subZ * R)
    // La fuente está clavada al sustrato: se acerca sola a medida que avanzamos.
    source = { x: source.x + motility.subX * 0 - Math.cos(motility.frontAngle) * motility.speed * step,
      z: source.z - Math.sin(motility.frontAngle) * motility.speed * step }

    // Adhesiones: nacen bajo el lamelipodio, envejecen y se sueltan en la cola.
    for (const ad of adhesions) ad.age += step
    for (let i = adhesions.length - 1; i >= 0; i--) {
      if (adhesions[i].age > adhesions[i].ttl) adhesions.splice(i, 1)
    }
    if (adhesions.length < cc.adhesions && rnd() < motility.protrusion * 3 * step) {
      const a = motility.frontAngle + (rnd() - 0.5) * 1.2
      const r = radiusAt(membrane, a) * R * (0.75 + rnd() * 0.2)
      adhesions.push({
        x: Math.cos(a) * r - motility.subX * R,
        z: Math.sin(a) * r - motility.subZ * R,
        ang: a, age: 0, ttl: 4 + rnd() * 4,
      })
    }

    // ── Organelos: deambulan SOBRE los rieles, contenidos por la membrana ───
    updateRoamers(roamers, cc.wander, step, rnd, clock, rails, nearestOnRails)
    for (let i = 0; i < n; i++) {
      const r = roamers[i]
      // La contención no es un círculo: es el contorno vivo de la membrana.
      if (!containsPoint(membrane, r.x, r.z, 0.06)) {
        const m = Math.hypot(r.x, r.z) || 1e-3
        const lim = Math.max(0.05, radiusAt(membrane, Math.atan2(r.z, r.x)) - 0.06)
        r.x = (r.x / m) * lim
        r.z = (r.z / m) * lim
        r.vx *= 0.3; r.vz *= 0.3
      }
      const x = r.x * R, z = r.z * R
      worldPos[i * 3] = x
      worldPos[i * 3 + 1] = H * 0.35
      worldPos[i * 3 + 2] = z
      const a = agents[i]
      a.group.position.set(x, H * 0.35, z)
      const sp = Math.hypot(r.vx, r.vz)
      if (sp > 1e-4) a.group.rotation.y = Math.atan2(r.vx * R, r.vz * R)
      if (a.spinY) a.group.rotation.y += a.spinY * step
      const pulse = 1 + (swarm ? swarm.flash[i] : 0) * 0.3
      a.group.scale.setScalar(a.baseScale * pulse)
    }

    // ── Dibujo ──────────────────────────────────────────────────────────────
    drawMembrane(motility.frontAngle)
    drawCortex()
    drawRails()
    drawInvaders()
    drawAdhesions()
    for (let i = 0; i < cc.atp.capacity; i++) {
      const q = atp.quanta[i]
      atpCloud.pos[i * 3] = q.alive ? q.x * R : 0
      atpCloud.pos[i * 3 + 1] = q.alive ? H * 0.45 : -9999
      atpCloud.pos[i * 3 + 2] = q.alive ? q.z * R : 0
    }
    atpCloud.commit()
    trails.update(worldPos)

    // Etiqueta sobre el organelo más cercano al centro de pantalla.
    let bestI = -1, bestD = 0.16
    for (let i = 0; i < n; i++) {
      _proj.set(worldPos[i * 3], worldPos[i * 3 + 1] + 4, worldPos[i * 3 + 2]).project(camera)
      if (_proj.z > 1) continue
      const d = Math.hypot(_proj.x, _proj.y)
      if (d < bestD) { bestD = d; bestI = i; _lx = _proj.x; _ly = _proj.y }
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

    // La niebla se espesa con el medio.
    if (eco) scene.fog.density = 0.0009 + eco.fog * 0.0022

    // ── ONDA DE Ca²⁺: el "relámpago" de este mundo ─────────────────────────
    // Barre la célula en 1–3 s. Se dispara con inflamación y con la tensión de
    // la mitosis, no con la lluvia — por eso vive acá y no en el host.
    if (eco) {
      calciumCooldown -= step
      const chance = (eco.weather === 'inflamed' ? 0.5 : 0.08) + eco.tension * 0.5
      if (calciumCooldown <= 0 && rnd() < chance * step) {
        calciumCooldown = 6 + rnd() * 10
        stage.flash(0.32 + eco.tension * 0.3)
      }
    }

    stage.render(step)
    return []
  }

  /** Shake: sacude el citoesqueleto y dispersa a los organelos. */
  function scare(strength = 1) {
    for (const r of roamers) {
      const m = Math.hypot(r.x, r.z) || 1e-3
      const k = (0.5 + Math.random() * 0.8) * strength
      r.vx += (r.x / m) * k + (Math.random() - 0.5) * k
      r.vz += (r.z / m) * k + (Math.random() - 0.5) * k
    }
    // Las adhesiones se sueltan de golpe: es un choque mecánico.
    adhesions.length = 0
  }

  return {
    update, scare,
    resize: stage.resize, flash: stage.flash, dispose: stage.dispose,
  }
}
