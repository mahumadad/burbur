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
import { roleFor, applyRoleBias } from '../sim/traffic.js'
import { createMotors, updateMotors, motorPosition } from '../sim/motors.js'
import { mitosisState } from '../sim/mitosis.js'
import { createMitosisDraw } from './cell/mitosis.js'

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
const C_ATP_POP = rgb(PALETTE.yellow)
const C_SUBSTRATE = [0.30, 0.34, 0.52]

// Distancia angular mínima (0..π) entre dos ángulos, dando la vuelta corta.
function angDist(a, b) {
  const d = Math.abs(a - b) % (Math.PI * 2)
  return d > Math.PI ? Math.PI * 2 - d : d
}
// Surco de citocinesis (M4): gaussiana centrada en los dos ángulos
// perpendiculares al eje del huso (que es el eje x local, ver cell/mitosis.js).
const FURROW_SIGMA = 0.55
function furrowGauss(a) {
  const d = Math.min(angDist(a, Math.PI / 2), angDist(a, -Math.PI / 2))
  return Math.exp(-(d * d) / (2 * FURROW_SIGMA * FURROW_SIGMA))
}

// Pool FIJO de "pops" de consumo de ATP (M2): un punto que crece y se apaga
// en ~0.25s en cada entrega. Fijo a propósito, como el resto de los pools del
// mundo — con más entregas que slots libres, algunas simplemente no destellan.
const ATP_POP_CAP = 16
const ATP_POP_TTL = 0.25

export function createCellScene(container, cfg, agentNames = []) {
  const R = cfg.world.radius
  const cc = cfg.cell
  const rc = cfg.render
  const H = cc.height
  // Radio y altura del núcleo: se usan acá y en el dibujo de la mitosis (M4).
  const NR = cc.nucleusR * R
  const NY = H * 0.25

  const stage = createStage(container, cfg)
  const { scene, camera, controls } = stage
  // Un microscopio no orbita la muestra: sin auto-rotación, el deslizamiento del
  // sustrato SE VE (con la órbita encima, el avance lateral quedaba tapado). El
  // usuario igual puede arrastrar para mirar en 3/4.
  controls.autoRotate = false
  const draw = createDraw(rc)
  const kit = createAgentKit(rc)

  // ─── Simulación (todo puro, de src/sim) ───────────────────────────────────
  const membrane = createMembrane(cc.membrane, rnd)
  const motility = createMotility(cc.motility, rnd)
  const rails = createRails(cc.rails, rnd)
  const motors = createMotors(cc.motors, rails.rails.length, rnd)
  const atp = createAtpPool(cc.atp)
  const invaders = createInvaders(cc.invaders)
  const n = cfg.fireflies.count
  const roamers = createRoamers(cc.wander, n, rnd)
  // Fuente de quimioatrayente (coords normalizadas, fijas al sustrato): la
  // célula la persigue. Al alcanzarla, aparece otra lejos. `prevSub` sirve para
  // arrastrar la fuente con el sustrato cada frame.
  let source = { x: Math.cos(1.1) * 1.2, z: Math.sin(1.1) * 1.2 }
  let prevSubX = 0, prevSubZ = 0
  let invaderClock = 0

  // ─── SUSTRATO: lo único que se mueve bajo la célula ───────────────────────
  // El sustrato es un TILE periódico repetido en una grilla 5×5. Como el patrón
  // se repite cada `P`, basta con mover el grupo módulo `P` para que el suelo
  // parezca infinito: nunca se acaba por más que la célula avance. (Antes era un
  // disco finito que se deslizaba fuera de cuadro → parecía estático.)
  const sub = cc.substrate
  const P = sub.tile
  const substrate = new THREE.Group()
  scene.add(substrate)
  {
    // Patrón de UN tile en [-P/2, P/2]²: puntos de matriz + fibras direccionales.
    const tileDots = []
    for (let i = 0; i < sub.dotsPerTile; i++) {
      tileDots.push((rnd() - 0.5) * P, (rnd() - 0.5) * P, 0.5 + rnd() * 0.5, 0.22 + rnd() * 0.35)
    }
    const tileFibers = [] // [x0,z0, x1,z1, ...] polilíneas de 3 puntos
    for (let i = 0; i < sub.fibersPerTile; i++) {
      const cx = (rnd() - 0.5) * P, cz = (rnd() - 0.5) * P
      const ang = sub.fiberDir + (rnd() - 0.5) * 2 * sub.fiberSpread
      const len = P * (0.25 + rnd() * 0.4)
      const wob = (rnd() - 0.5) * 0.5
      const seg = []
      for (let s = 0; s <= 2; s++) {
        const t = (s / 2 - 0.5) * len
        const px = cx + Math.cos(ang) * t - Math.sin(ang) * Math.sin(s * 3) * wob
        const pz = cz + Math.sin(ang) * t + Math.cos(ang) * Math.sin(s * 3) * wob
        seg.push(px, pz)
      }
      tileFibers.push(seg)
    }
    // Replicar el tile en 5×5 (cubre ±2.5P, más que el radio visible).
    const pos = [], col = [], size = []
    const fpos = [], fcol = []
    const dim = (k) => [C_SUBSTRATE[0] * k, C_SUBSTRATE[1] * k, C_SUBSTRATE[2] * k]
    for (let gx = -2; gx <= 2; gx++) {
      for (let gz = -2; gz <= 2; gz++) {
        const ox = gx * P, oz = gz * P
        for (let d = 0; d < tileDots.length; d += 4) {
          pos.push(tileDots[d] + ox, -H, tileDots[d + 1] + oz)
          const c = dim(tileDots[d + 2]); col.push(c[0], c[1], c[2])
          size.push(tileDots[d + 3])
        }
        for (const seg of tileFibers) {
          // Fibras un poco más brillantes que los puntos: son las que marcan el avance.
          const c = dim(0.9)
          for (let s = 0; s < 2; s++) {
            fpos.push(seg[s * 2] + ox, -H + 0.2, seg[s * 2 + 1] + oz,
              seg[s * 2 + 2] + ox, -H + 0.2, seg[s * 2 + 3] + oz)
            fcol.push(c[0], c[1], c[2], c[0], c[1], c[2])
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('hcol', new THREE.BufferAttribute(new Float32Array(col), 3))
    geo.setAttribute('hsize', new THREE.BufferAttribute(new Float32Array(size), 1))
    geo.setAttribute('hphs', new THREE.BufferAttribute(new Float32Array(pos.length / 3), 1))
    const pts = new THREE.Points(geo, draw.pointMaterial)
    pts.frustumCulled = false
    substrate.add(pts)
    const fgeo = new THREE.BufferGeometry()
    fgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fpos), 3))
    fgeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(fcol), 3))
    const fmesh = new THREE.LineSegments(fgeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7 }))
    fmesh.frustumCulled = false
    substrate.add(fmesh)
  }

  // ─── ADHESIONES FOCALES: nacen bajo el frente, quedan CLAVADAS al sustrato ─
  // y desfilan hacia atrás relativas a la célula — el indicador de velocidad más
  // honesto. Se guardan en coords de nacimiento + el offset del sustrato de ese
  // momento; su vida corta (ttl) las mantiene cerca, no se van de cuadro.
  const adhesionMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true })
  const adhesionBuf = createLineBuffer(cc.adhesions * 2, adhesionMat)
  scene.add(adhesionBuf.mesh)
  const adhesions = []

  // ─── NÚCLEO, NUCLEOLO, ER Y GOLGI: el paisaje interior, estático ──────────
  // Recetas de spec §4.2bis, extraídas de los modelos 3D de referencia.
  {
    // Domo SÓLIDO translúcido: le da cuerpo al núcleo bajo el wireframe (el
    // usuario pidió elementos más sólidos, no solo líneas). Blend normal, muy
    // tenue, para que se lea como un volumen vidrioso sin tapar lo de dentro.
    {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(NR * 0.98, 24, 16),
        new THREE.MeshBasicMaterial({
          color: PALETTE.bond, transparent: true, opacity: 0.14,
          depthWrite: false, side: THREE.BackSide,
        }))
      dome.position.y = NY
      scene.add(dome)
    }
    // Núcleo: DOBLE envoltura (la membrana nuclear real es una bicapa doble
    // continua con el ER). Dos esferas wireframe casi pegadas.
    for (const [rr, op] of [[NR, 0.22], [NR * 1.045, 0.12]]) {
      const sphere = new THREE.SphereGeometry(rr, 18, 12)
      const wire = new THREE.WireframeGeometry(sphere)
      const nucLines = new THREE.LineSegments(wire,
        new THREE.LineBasicMaterial({ color: PALETTE.white, transparent: true, opacity: op }))
      nucLines.position.y = NY
      scene.add(nucLines)
      sphere.dispose()
    }

    // Poros nucleares: anillos ESTÁTICOS sobre la envoltura (una célula real
    // tiene miles; mostramos decenas). Círculos tangentes a la esfera, en el
    // acumulador — no un mesh por poro.
    const PORE_COL = rgb(PALETTE.cyanEye)
    for (let i = 0; i < cc.pores; i++) {
      const a = rnd() * Math.PI * 2, b = Math.acos(rnd() * 2 - 1)
      const nx = Math.sin(b) * Math.cos(a), ny = Math.cos(b), nz = Math.sin(b) * Math.sin(a)
      // Base tangente al punto (nx,ny,nz) de la esfera.
      const ux = -nz, uy = 0, uz = nx
      const um = Math.hypot(ux, uz) || 1
      const t1 = [ux / um, uy, uz / um]
      const t2 = [ny * t1[2] - nz * t1[1], nz * t1[0] - nx * t1[2], nx * t1[1] - ny * t1[0]]
      const pr = NR * 0.07
      const cx = nx * NR * 1.02, cy = NY + ny * NR * 1.02, cz = nz * NR * 1.02
      for (let s = 0; s < 8; s++) {
        const q0 = (s / 8) * Math.PI * 2, q1 = ((s + 1) / 8) * Math.PI * 2
        draw.pushLine(
          cx + (Math.cos(q0) * t1[0] + Math.sin(q0) * t2[0]) * pr,
          cy + (Math.cos(q0) * t1[1] + Math.sin(q0) * t2[1]) * pr,
          cz + (Math.cos(q0) * t1[2] + Math.sin(q0) * t2[2]) * pr,
          cx + (Math.cos(q1) * t1[0] + Math.sin(q1) * t2[0]) * pr,
          cy + (Math.cos(q1) * t1[1] + Math.sin(q1) * t2[1]) * pr,
          cz + (Math.cos(q1) * t1[2] + Math.sin(q1) * t2[2]) * pr,
          PORE_COL, PORE_COL,
        )
      }
    }
    // Cromatina: ver cell/mitosis.js (M4) — pasó a un buffer DINÁMICO propio
    // (chromatinBuf) porque se condensa y se separa durante la mitosis; una
    // geometría estática subida una sola vez no puede animarse.

    // Filamentos intermedios: jaula de lazos ondulados alrededor del núcleo
    // (el "muelle" del modelo de citoesqueleto). Sostienen el núcleo.
    const IF_COL = [0.72, 0.70, 0.82]
    for (let i = 0; i < cc.ifLoops; i++) {
      const lr = NR * (1.12 + rnd() * 0.35)
      const ly = NY + (rnd() - 0.5) * NR * 0.9
      const phase = rnd() * Math.PI * 2
      const segs = 26
      let px = null, py = null, pz = null
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2
        const wob = 1 + Math.sin(a * 7 + phase) * 0.06
        const x = Math.cos(a) * lr * wob
        const z = Math.sin(a) * lr * wob
        const y = ly + Math.sin(a * 5 + phase * 1.7) * NR * 0.08
        if (px !== null) draw.pushLine(px, py, pz, x, y, z, IF_COL, IF_COL)
        px = x; py = y; pz = z
      }
    }

    // Centrosoma: DOS centriolos ortogonales, cada uno un barril de 9 líneas,
    // en el origen de los rieles + material pericentriolar (puntos).
    {
      const ox = cc.rails.originX * R, oz = cc.rails.originZ * R
      const cy = H * 0.15
      const br = R * 0.018, bl = R * 0.045
      const CEN_COL = rgb(PALETTE.cyanEye)
      for (let s = 0; s < 9; s++) {
        const a = (s / 9) * Math.PI * 2
        // Barril 1: eje vertical. Barril 2: eje horizontal, desplazado.
        draw.pushLine(
          ox + Math.cos(a) * br, cy, oz + Math.sin(a) * br,
          ox + Math.cos(a) * br, cy + bl, oz + Math.sin(a) * br,
          CEN_COL, CEN_COL,
        )
        draw.pushLine(
          ox + bl * 0.8, cy + bl * 0.5 + Math.cos(a) * br, oz + Math.sin(a) * br,
          ox + bl * 1.8, cy + bl * 0.5 + Math.cos(a) * br, oz + Math.sin(a) * br,
          CEN_COL, CEN_COL,
        )
      }
      for (let i = 0; i < 40; i++) {
        const a = rnd() * Math.PI * 2
        const r = Math.pow(rnd(), 0.5) * R * 0.05
        draw.pushPoint(ox + Math.cos(a) * r, cy + (rnd() - 0.2) * bl, oz + Math.sin(a) * r,
          [0.5, 0.9, 0.85], 0.2, 0)
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

    // ER: continuo con la envoltura nuclear. Dos regímenes reales:
    //  (a) LÁMINAS rugosas cerca del núcleo — pares de arcos concéntricos
    //      ("pliegues"), cargadas de ribosomas;
    //  (b) RED TUBULAR hacia la periferia — nodos unidos de a 3 (las uniones
    //      de 3 vías del ER liso), un retículo poligonal, no un garabato.
    const erPts = []
    // (a) Láminas: 9 sectores de arcos apilados saliendo de la envoltura.
    for (let i = 0; i < 9; i++) {
      const a0 = rnd() * Math.PI * 2
      const span = 0.5 + rnd() * 0.7
      const y = H * 0.12 + rnd() * H * 0.22
      for (let sheet = 0; sheet < 3; sheet++) {
        const rr = NR * (1.06 + sheet * 0.11 + rnd() * 0.04)
        let px = null, pz = null
        for (let s = 0; s <= 10; s++) {
          const a = a0 + (s / 10) * span
          const x = Math.cos(a) * rr, z = Math.sin(a) * rr
          if (px !== null) {
            draw.pushLine(px, y + sheet * H * 0.03, pz, x, y + sheet * H * 0.03, z, C_ER, C_ER)
            erPts.push([x, y, z, 1]) // 1 = lámina rugosa: aquí van los ribosomas
          }
          px = x; pz = z
        }
      }
    }
    // (b) Red tubular: nodos en dos coronas + conexión a los 3 más cercanos.
    {
      const nodes = []
      for (let i = 0; i < 46; i++) {
        const a = rnd() * Math.PI * 2
        const r = NR * 1.55 + rnd() * (R * 0.62 - NR * 1.55)
        nodes.push([Math.cos(a) * r, H * 0.1 + rnd() * H * 0.24, Math.sin(a) * r])
      }
      for (const p of nodes) {
        const near = nodes
          .filter((q) => q !== p)
          .map((q) => [q, (q[0] - p[0]) ** 2 + (q[2] - p[2]) ** 2])
          .sort((u, v) => u[1] - v[1])
          .slice(0, 3)
        for (const [q, d2] of near) {
          if (d2 > (R * 0.3) ** 2) continue
          draw.pushLine(p[0], p[1], p[2], q[0], q[1], q[2], C_ER, C_ER)
          erPts.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2, 0])
        }
      }
    }
    // Ribosomas: la densidad del estilo Goodsell. El .blend de referencia
    // instancia ~2000 esferas; acá son puntos. 70% sobre el ER rugoso
    // (láminas), 30% libres en el citosol.
    const sheets = erPts.filter((p) => p[3] === 1)
    for (let i = 0; i < cc.ribosomes; i++) {
      const onSheet = rnd() < 0.7 && sheets.length
      if (onSheet) {
        const p = sheets[(rnd() * sheets.length) | 0]
        draw.pushPoint(
          p[0] + (rnd() - 0.5) * R * 0.05,
          p[1] + (rnd() - 0.5) * H * 0.12,
          p[2] + (rnd() - 0.5) * R * 0.05,
          [0.55, 0.95, 0.9], 0.16, 0,
        )
      } else {
        const a = rnd() * Math.PI * 2
        const r = NR * 1.1 + Math.sqrt(rnd()) * (R * 0.62 - NR * 1.1)
        draw.pushPoint(Math.cos(a) * r, H * 0.08 + rnd() * H * 0.3, Math.sin(a) * r,
          [0.45, 0.8, 0.78], 0.13, 0)
      }
    }

    // Golgi: cinta de 6 cisternas apiladas con jitter + VESÍCULAS brotando de
    // los bordes (así funciona de verdad: el borde de la cisterna gemela).
    const gx = NR * 1.5, gz = -NR * 0.7
    for (let c = 0; c < 6; c++) {
      const rr = NR * (0.48 + c * 0.075)
      const jit = (rnd() - 0.5) * NR * 0.03
      const y = H * 0.18 + c * H * 0.07
      let px = null, pz = null
      for (let s = 0; s <= 16; s++) {
        const a = -0.95 + (s / 16) * 1.9
        const x = gx + Math.cos(a) * (rr + jit), z = gz + Math.sin(a) * (rr + jit)
        if (px !== null) draw.pushLine(px, y, pz, x, y, z, C_GOLGI, C_GOLGI)
        px = x; pz = z
      }
      // Vesículas en los dos extremos del arco.
      for (const aEnd of [-0.95, 0.95]) {
        for (let v = 0; v < 2; v++) {
          draw.pushPoint(
            gx + Math.cos(aEnd) * (rr + jit) + (rnd() - 0.5) * NR * 0.12,
            y + (rnd() - 0.5) * H * 0.05,
            gz + Math.sin(aEnd) * (rr + jit) + (rnd() - 0.5) * NR * 0.12,
            rgb(PALETTE.pink), 0.3, 0,
          )
        }
      }
    }
  }
  draw.finalizeLines(scene, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 }))
  draw.finalizePoints(scene)

  // ─── MITOSIS (M4): cromatina/cromosomas/huso, redibujados cada frame ──────
  const mitosisDraw = createMitosisDraw({
    scene, NR, NY, rnd, chromatinColor: C_CHROMATIN, spindleColor: C_CORTEX,
  })

  // ─── MEMBRANA: dos contornos (la bicapa) + un punto por vértice ───────────
  const MV = cc.membrane.verts
  const memMat = new THREE.LineBasicMaterial({ vertexColors: true })
  // Bicapa + canales (4 seg c/u) + glicoproteínas (6 seg c/u), por frame.
  const memBuf = createLineBuffer(MV * 2 + cc.channels * 4 + cc.glycans * 6 + 8, memMat)
  // Ángulos FIJOS de las proteínas de membrana: viajan con el contorno, no
  // reaparecen en otro lado cada frame.
  const channelAngs = Array.from({ length: cc.channels }, () => rnd() * Math.PI * 2)
  const glycanAngs = Array.from({ length: cc.glycans }, () => rnd() * Math.PI * 2)
  scene.add(memBuf.mesh)
  const memDots = createPointCloud(MV, draw.pointMaterial)
  scene.add(memDots.mesh)

  // RELLENO SÓLIDO de la célula: un abanico (fan) translúcido que se deforma con
  // el contorno cada frame. Le da CUERPO — sin él la célula era solo un borde y
  // no se leía como un blob que repta. Centro + MV vértices de borde.
  const fillPos = new Float32Array((MV + 1) * 3)
  const fillGeo = new THREE.BufferGeometry()
  fillGeo.setAttribute('position', new THREE.BufferAttribute(fillPos, 3))
  {
    const idx = []
    for (let i = 0; i < MV; i++) idx.push(0, i + 1, ((i + 1) % MV) + 1)
    fillGeo.setIndex(idx)
  }
  const fillMesh = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({
    color: PALETTE.cyan, transparent: true, opacity: 0.09,
    depthWrite: false, side: THREE.DoubleSide,
  }))
  fillMesh.frustumCulled = false
  fillMesh.position.y = -0.4
  scene.add(fillMesh)

  // ─── CORTEZA DE ACTINA: hebras cortas tangenciales al borde interno ───────
  const cortexMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5 })
  // Trenza (2 seg por hebra) + malla dendrítica del lamelipodio.
  const cortexBuf = createLineBuffer(cc.cortexStrands * 2 + cc.lamelliMesh, cortexMat)
  scene.add(cortexBuf.mesh)

  // ─── MICROTÚBULOS: crecen y se derrumban, así que se redibujan cada frame ─
  const railMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 })
  // Cada microtúbulo = 2 líneas casi paralelas (se lee cilindro hueco).
  const railBuf = createLineBuffer(cc.rails.count * 2, railMat)
  scene.add(railBuf.mesh)
  // Cuentas de tubulina: dímeros α/β alternados sobre cada riel (colores en
  // 2 tonos, receta del modelo de citoesqueleto). Siguen al riel al crecer.
  const mtBeads = createPointCloud(cc.rails.count * cc.mtBeads, draw.pointMaterial)
  {
    const A = rgb(PALETTE.cyanSat), B = rgb(PALETTE.blue)
    for (let i = 0; i < cc.rails.count * cc.mtBeads; i++) {
      const c = i % 2 === 0 ? A : B
      mtBeads.col[i * 3] = c[0]; mtBeads.col[i * 3 + 1] = c[1]; mtBeads.col[i * 3 + 2] = c[2]
      mtBeads.size[i] = 0.32
    }
  }
  scene.add(mtBeads.mesh)

  // ─── MOTORES (M5): kinesina/dineína caminando sobre los rieles ───────────
  // El color se recalcula cada frame porque al reengancharse cambian de rumbo.
  const motorCloud = createPointCloud(cc.motors.count, draw.pointMaterial)
  const C_KINESIN = rgb(PALETTE.cyanEye), C_DYNEIN = rgb(PALETTE.bond)
  scene.add(motorCloud.mesh)

  // ─── ATP: los cuantos, que son también el latido sonoro del mundo ─────────
  const atpCloud = createPointCloud(cc.atp.capacity, draw.pointMaterial)
  for (let i = 0; i < cc.atp.capacity; i++) {
    atpCloud.col[i * 3] = 1; atpCloud.col[i * 3 + 1] = 0.89; atpCloud.col[i * 3 + 2] = 0.10
    atpCloud.size[i] = 0.8
  }
  scene.add(atpCloud.mesh)

  // ─── POPS de entrega de ATP (M2): el consumo, antes silencioso, ahora se ve.
  const atpPops = createPointCloud(ATP_POP_CAP, draw.pointMaterial)
  // Estado propio del pool: cada slot lleva su edad; `age >= ATP_POP_TTL` = libre.
  const atpPopState = Array.from({ length: ATP_POP_CAP }, () => ({ age: ATP_POP_TTL, x: 0, z: 0 }))
  for (let i = 0; i < ATP_POP_CAP; i++) {
    atpPops.col[i * 3] = C_ATP_POP[0]; atpPops.col[i * 3 + 1] = C_ATP_POP[1]; atpPops.col[i * 3 + 2] = C_ATP_POP[2]
  }
  scene.add(atpPops.mesh)

  // ─── INVASORES ────────────────────────────────────────────────────────────
  const invMat = new THREE.LineBasicMaterial({ vertexColors: true })
  const invBuf = createLineBuffer(cc.invaders.capacity * 7, invMat)
  scene.add(invBuf.mesh)

  // Marcador tenue del quimioatrayente: un anillo que late sobre el sustrato.
  // Da a la migración un objetivo visible (si no, la célula "va" sin motivo).
  const sourceMark = new THREE.Mesh(
    new THREE.TorusGeometry(4, 0.5, 8, 24),
    new THREE.MeshBasicMaterial({ color: PALETTE.cyanEye, transparent: true, opacity: 0.4, depthWrite: false }))
  sourceMark.rotation.x = Math.PI / 2
  scene.add(sourceMark)

  // ─── ORGANELOS: los individuos con jaula, nombre y estela ─────────────────
  // Cada uno lleva CARGA MOLECULAR adentro: racimos de esferas sólidas, la
  // densidad "espacio-lleno" del estilo Goodsell/Digizyme que el usuario pidió.
  // Sin esto eran jaulas wireframe vacías; ahora se leen como cuerpos llenos.
  function molecularFill(group, count, radius, spread, colors) {
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2, b = Math.acos(rnd() * 2 - 1)
      const rr = Math.pow(rnd(), 0.5) * spread
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(radius * (0.6 + rnd() * 0.8), 8, 6),
        new THREE.MeshBasicMaterial({ color: colors[(rnd() * colors.length) | 0] }))
      s.position.set(
        Math.sin(b) * Math.cos(a) * rr,
        Math.cos(b) * rr,
        Math.sin(b) * Math.sin(a) * rr)
      group.add(s)
    }
  }
  const KINDS = ['mitochondrion', 'vesicle', 'lysosome', 'endosome']
  // Rol de tráfico por organelo (M3): qué motor lo lleva y hacia dónde.
  const roles = []
  const agents = []
  for (let i = 0; i < n; i++) {
    const kind = KINDS[i % KINDS.length]
    roles.push(roleFor(kind))
    const group = new THREE.Group()
    if (kind === 'mitochondrion') {
      // Cápsula con CRESTAS transversales onduladas (receta del modelo usdz,
      // spec §4.2bis): anillos en los extremos + largueros curvos + crestas
      // en zigzag dentro. Nada de caja con barras.
      const L = 5.4, W = 2.2
      const body = []
      // Anillos de los extremos (planos YZ, en x=±L*0.36).
      for (const ex of [-L * 0.36, L * 0.36]) {
        for (let s = 0; s < 10; s++) {
          const a0 = (s / 10) * Math.PI * 2, a1 = ((s + 1) / 10) * Math.PI * 2
          body.push(ex, Math.cos(a0) * W * 0.5, Math.sin(a0) * W * 0.5,
            ex, Math.cos(a1) * W * 0.5, Math.sin(a1) * W * 0.5)
        }
      }
      // Largueros: 4 líneas longitudinales que se abomban al centro y se
      // cierran en los polos de la cápsula.
      for (let l = 0; l < 4; l++) {
        const a = (l / 4) * Math.PI * 2
        const cy0 = Math.cos(a), cz0 = Math.sin(a)
        let px = -L * 0.5, py = 0, pz = 0
        for (let s = 1; s <= 6; s++) {
          const t = s / 6
          const x = -L * 0.5 + t * L
          const bulge = Math.sin(t * Math.PI) * W * 0.5
          const y = cy0 * bulge, z = cz0 * bulge
          body.push(px, py, pz, x, y, z)
          px = x; py = y; pz = z
        }
      }
      group.add(kit.fatLine(body, PALETTE.orange))
      // Crestas: 6 tabiques transversales en zigzag (lamelares, onduladas).
      const cristae = []
      for (let c = 0; c < 6; c++) {
        const x = -L * 0.3 + (c / 5) * L * 0.6
        const amp = Math.sin(((c + 0.5) / 6) * Math.PI) * W * 0.42
        let py2 = -amp, pz2 = -W * 0.18
        for (let s = 1; s <= 4; s++) {
          const y = -amp + (s / 4) * amp * 2
          const z = (s % 2 === 0 ? -1 : 1) * W * 0.18
          cristae.push(x, py2, pz2, x, y, z)
          py2 = y; pz2 = z
        }
      }
      group.add(kit.fatLine(cristae, PALETTE.yellow))
      // Gránulos de la matriz: proteínas del ciclo de Krebs apretadas dentro.
      molecularFill(group, 10, 0.34, W * 0.42, [PALETTE.orange, PALETTE.yellow, PALETTE.bond])
    } else if (kind === 'vesicle') {
      // Jaula icosaédrica de clatrina (así se llama "cage" en la literatura) +
      // una carga sólida translúcida adentro: la vesícula lleva algo.
      group.add(kit.edgesOf(new THREE.IcosahedronGeometry(2.2, 0), PALETTE.pink))
      const cargo = new THREE.Mesh(new THREE.SphereGeometry(1.2, 14, 10),
        new THREE.MeshBasicMaterial({ color: PALETTE.magenta, transparent: true, opacity: 0.5 }))
      group.add(cargo)
      molecularFill(group, 5, 0.28, 1.3, [PALETTE.white, PALETTE.pink])
    } else if (kind === 'lysosome') {
      // Esfera ácida rellena de enzimas hidrolíticas (racimo denso).
      group.add(kit.edgesOf(new THREE.DodecahedronGeometry(2.4, 0), PALETTE.magenta))
      group.add(new THREE.Mesh(new THREE.SphereGeometry(1.4, 14, 10),
        new THREE.MeshBasicMaterial({ color: PALETTE.pink, transparent: true, opacity: 0.35, depthWrite: false })))
      molecularFill(group, 14, 0.32, 1.9, [PALETTE.pink, PALETTE.magenta, PALETTE.white])
    } else {
      // Endosoma: cuerpo multivesicular — vesículas internas de verdad.
      group.add(kit.edgesOf(new THREE.OctahedronGeometry(2.6), PALETTE.cyanSat))
      group.add(kit.ringLoop(1.4, 22, PALETTE.cyanEye))
      molecularFill(group, 7, 0.4, 1.7, [PALETTE.cyanSat, PALETTE.white, PALETTE.cyan])
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

  // ─── Etiqueta flotante: SOLO al pasar el mouse por encima de un organelo ───
  const _proj = new THREE.Vector3()
  let _lx = 0, _ly = 0
  let ptrX = null, ptrY = null // posición del mouse en NDC (null = fuera del canvas)
  function setPointer(x, y) { ptrX = x; ptrY = y }
  // El lente fisheye desplaza la posición VISUAL del organelo respecto a su NDC
  // lógico; deshago esa distorsión para que el hover matchee lo que se ve (si no,
  // hacia el borde el nombre "se pierde" y solo aparece al centro).
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
  let rounding = 0, roundTarget = 0
  let calciumCooldown = 5
  // Flag del evento de división (M4): se emite una sola vez por ciclo, al
  // cruzar furrow >= 0.95, y se rearma cuando furrow vuelve a 0.
  let divisionFired = false

  function drawMembrane(front, furrow = 0) {
    memBuf.begin()
    const step = (Math.PI * 2) / MV
    for (let i = 0; i < MV; i++) {
      const a = i * step, b = ((i + 1) % MV) * step
      let r1 = radiusAt(membrane, a) * R, r2 = radiusAt(membrane, b) * R
      // Surco de citocinesis: se estrangula en la banda perpendicular al eje
      // del huso, hasta ~55% del radio con furrow=1.
      if (furrow > 0) {
        r1 *= 1 - furrow * 0.55 * furrowGauss(a)
        r2 *= 1 - furrow * 0.55 * furrowGauss(b)
      }
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
      // Borde del relleno sólido: el vértice i+1 del abanico (el 0 es el centro).
      fillPos[(i + 1) * 3] = x1
      fillPos[(i + 1) * 3 + 1] = 0
      fillPos[(i + 1) * 3 + 2] = z1
    }
    fillGeo.getAttribute('position').needsUpdate = true
    fillGeo.computeBoundingSphere()
    // Proteínas transmembrana (receta del FBX de membrana, spec §4.2bis):
    // canales = rombo montado a caballo del contorno; glicoproteínas =
    // espiral corta hacia afuera (el glicocálix). Ángulos fijos: viajan con
    // la membrana al deformarse.
    const CHAN = rgb(PALETTE.yellow)
    for (const ca of channelAngs) {
      const r = radiusAt(membrane, ca) * R
      const cx = Math.cos(ca) * r, cz = Math.sin(ca) * r
      const nx = Math.cos(ca), nz = Math.sin(ca)      // normal (radial)
      const tx = -nz, tz = nx                          // tangente
      const s = 1.1
      memBuf.push(cx + nx * s, 0, cz + nz * s, cx + tx * s, 0, cz + tz * s, CHAN, CHAN)
      memBuf.push(cx + tx * s, 0, cz + tz * s, cx - nx * s, 0, cz - nz * s, CHAN, CHAN)
      memBuf.push(cx - nx * s, 0, cz - nz * s, cx - tx * s, 0, cz - tz * s, CHAN, CHAN)
      memBuf.push(cx - tx * s, 0, cz - tz * s, cx + nx * s, 0, cz + nz * s, CHAN, CHAN)
    }
    const GLY = rgb(PALETTE.pink)
    for (let g = 0; g < glycanAngs.length; g++) {
      const ga = glycanAngs[g]
      const r = radiusAt(membrane, ga) * R
      const nx = Math.cos(ga), nz = Math.sin(ga)
      const tx = -nz, tz = nx
      let px = nx * r, pz = nz * r
      for (let s = 1; s <= 6; s++) {
        // Zigzag que se abre hacia afuera: la espiral vista desde arriba.
        const out = r + s * 0.85
        const side = (s % 2 === 0 ? 1 : -1) * 0.8 * (1 - s / 8)
        const x = nx * out + tx * side, z = nz * out + tz * side
        memBuf.push(px, 0.4, pz, x, 0.4, z, GLY, GLY)
        px = x; pz = z
      }
    }
    memBuf.commit()
    memDots.commit()
  }

  function drawCortex(front, protrusion) {
    cortexBuf.begin()
    // Actina cortical: cada hebra es una TRENZA de dos sub-hebras que se
    // cruzan (la "trenza" del modelo de citoesqueleto), no una raya.
    for (let i = 0; i < cc.cortexStrands; i++) {
      const a = (i / cc.cortexStrands) * Math.PI * 2
      const r = radiusAt(membrane, a) * R
      const da = 0.045
      const r0 = r * 0.965, r1 = r * 0.90
      cortexBuf.push(
        Math.cos(a - da) * r0, 0, Math.sin(a - da) * r0,
        Math.cos(a + da) * r1, 0, Math.sin(a + da) * r1,
        C_CORTEX, C_MEMBRANE,
      )
      cortexBuf.push(
        Math.cos(a + da) * r0, 0, Math.sin(a + da) * r0,
        Math.cos(a - da) * r1, 0, Math.sin(a - da) * r1,
        C_CORTEX, C_MEMBRANE,
      )
    }
    // Lamelipodio: malla dendrítica ramificada (~±35° del radio, Arp2/3) bajo
    // el frente. Su densidad ES la protrusión: sin ATP no hay malla.
    const half = 0.9
    const count = Math.floor(cc.lamelliMesh * protrusion)
    for (let k = 0; k < count; k++) {
      const a = front + (rnd() * 2 - 1) * half
      const r = radiusAt(membrane, a) * R
      const depth = 0.90 - rnd() * 0.10
      const sign = k % 2 === 0 ? 1 : -1
      const branch = a + sign * 0.61 // ±35°
      cortexBuf.push(
        Math.cos(a) * r * depth, 0, Math.sin(a) * r * depth,
        Math.cos(branch) * r * (depth - 0.07), 0, Math.sin(branch) * r * (depth - 0.07),
        C_FRONT, C_CORTEX,
      )
    }
    cortexBuf.commit()
  }

  function drawRails() {
    railBuf.begin()
    const ox = rails.origin.x * R, oz = rails.origin.z * R
    const off = 0.38 // separación del par de líneas: se lee cilindro hueco
    for (let ri = 0; ri < rails.rails.length; ri++) {
      const r = rails.rails[ri]
      const dx = Math.cos(r.ang), dz = Math.sin(r.ang)
      const px = -dz * off, pz = dx * off
      const ex = ox + dx * r.len * R, ez = oz + dz * r.len * R
      railBuf.push(ox + px, H * 0.15, oz + pz, ex + px, H * 0.15, ez + pz, C_RAIL, C_CORTEX)
      railBuf.push(ox - px, H * 0.15, oz - pz, ex - px, H * 0.15, ez - pz, C_RAIL, C_CORTEX)
      // Cuentas de tubulina: siguen el largo VIVO del riel; las que caen más
      // allá de la punta se esconden (el riel se derrumba y se lo ve vaciarse).
      for (let b = 0; b < cc.mtBeads; b++) {
        const idx = ri * cc.mtBeads + b
        const t = (b + 0.5) / cc.mtBeads
        const bx = ox + dx * r.len * R * t, bz = oz + dz * r.len * R * t
        const visible = r.len * t > cc.rails.minLen * 0.3
        mtBeads.pos[idx * 3] = bx
        mtBeads.pos[idx * 3 + 1] = visible ? H * 0.15 : -9999
        mtBeads.pos[idx * 3 + 2] = bz
      }
    }
    railBuf.commit()
    mtBeads.commit()
  }

  /** Motores (M5): un punto por motor sobre su riel, coloreado según sentido. */
  function drawMotors() {
    for (let i = 0; i < motors.length; i++) {
      const m = motors[i]
      const p = motorPosition(m, rails) // ya incluye el origen, en coords normalizadas
      motorCloud.pos[i * 3] = p.x * R
      motorCloud.pos[i * 3 + 1] = H * 0.15
      motorCloud.pos[i * 3 + 2] = p.z * R
      // Dos tonos según sentido: kinesina (+1, hacia afuera) vs dineína (-1,
      // hacia adentro). Se recalcula cada frame porque al reengancharse cambian.
      const c = m.dir === 1 ? C_KINESIN : C_DYNEIN
      motorCloud.col[i * 3] = c[0]; motorCloud.col[i * 3 + 1] = c[1]; motorCloud.col[i * 3 + 2] = c[2]
      motorCloud.size[i] = m.cargo ? 0.5 : 0.35
    }
    motorCloud.commit()
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

  /** Deja un pop de consumo de ATP en (x,z) normalizados: ocupa el slot más libre. */
  function spawnAtpPop(x, z) {
    for (let i = 0; i < ATP_POP_CAP; i++) {
      if (atpPopState[i].age >= ATP_POP_TTL) {
        atpPopState[i].age = 0; atpPopState[i].x = x; atpPopState[i].z = z
        return
      }
    }
    // Pool lleno: esta entrega, en particular, no destella — no pasa nada.
  }

  /** Anima el pool de pops: crecen y se apagan en ATP_POP_TTL; libres se aparcan. */
  function drawAtpPops(step) {
    for (let i = 0; i < ATP_POP_CAP; i++) {
      const p = atpPopState[i]
      if (p.age < ATP_POP_TTL) {
        p.age += step
        const u = Math.min(1, p.age / ATP_POP_TTL)
        atpPops.pos[i * 3] = p.x * R
        atpPops.pos[i * 3 + 1] = H * 0.45
        atpPops.pos[i * 3 + 2] = p.z * R
        atpPops.size[i] = Math.sin(Math.PI * u) * 1.6 // crece y se apaga
      } else {
        atpPops.pos[i * 3 + 1] = -9999 // aparcado: convención del repo para "muerto"
        atpPops.size[i] = 0
      }
    }
    atpPops.commit()
  }

  function drawAdhesions(subX, subZ) {
    adhesionBuf.begin()
    for (const ad of adhesions) {
      // Fija al sustrato: desde que nació, el sustrato corrió (subX - sbx), así
      // que respecto de la célula la adhesión se fue hacia atrás esa cantidad.
      const x = ad.bx + (subX - ad.sbx) * R
      const z = ad.bz + (subZ - ad.sbz) * R
      const f = Math.min(1, ad.age * 1.6) * Math.max(0, 1 - ad.age / ad.ttl)
      const c = [C_ADHESION[0] * f, C_ADHESION[1] * f, C_ADHESION[2] * f]
      // Streak alargado en el eje de tracción (radial) + una barra corta cruzada:
      // se lee como un punto focal maduro, no como una rayita.
      const dx = Math.cos(ad.ang) * 3.0, dz = Math.sin(ad.ang) * 3.0
      const px = -Math.sin(ad.ang) * 1.1, pz = Math.cos(ad.ang) * 1.1
      adhesionBuf.push(x - dx, -H + 0.25, z - dz, x + dx, -H + 0.25, z + dz, c, c)
      adhesionBuf.push(x - px, -H + 0.25, z - pz, x + px, -H + 0.25, z + pz, c, c)
    }
    adhesionBuf.commit()
  }

  function update(swarm, dt, eco) {
    const step = dt || 0.016
    clock += step
    draw.uniforms.uT.value = clock
    // Eventos grandes del mundo (M1): se acumulan durante el frame y se
    // devuelven al host al final, para el log y/o el sonido.
    const events = []

    // El medio pinta la célula: el "clima" modula energía y tensión.
    const demand = 0.25 + (eco ? eco.tension : 0) * 0.8
    // En mitosis la célula suelta las adherencias, se redondea y deja de reptar.
    // Entra y sale con rampa: el redondeo real tarda, no es un interruptor.
    const inMitosis = eco ? MITOTIC_PHASES.has(eco.phase) : false
    roundTarget = inMitosis ? 1 : 0
    rounding += (roundTarget - rounding) * (1 - Math.exp(-step / 2.5))

    // Mitosis (M4): condensación de cromatina, alineación, separación y
    // surco del ciclo actual, traducidos por el módulo puro sim/mitosis.js.
    const mit = mitosisState(eco ? eco.phase : undefined, eco ? eco.phaseT : 0)
    if (mit.furrow >= 0.95 && !divisionFired) {
      divisionFired = true
      events.push({ type: 'moment', agent: 'el núcleo', agentType: 'structure', kind: 'division' })
    }
    if (mit.furrow < 0.02) divisionFired = false

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
    updateMotors(motors, rails, cc.motors, step, rnd)

    // Las mitocondrias sueltan ATP; el destello del swarm marca el pulso.
    if (swarm) {
      for (let i = 0; i < n; i++) {
        if (swarm.flash[i] > 0.85 && agents[i].kind === 'mitochondrion') {
          const t = rnd() * Math.PI * 2, tr = rnd() * 0.5
          spawnQuantum(atp, roamers[i].x, roamers[i].z, Math.cos(t) * tr, Math.sin(t) * tr)
        }
      }
    }
    // Cada entrega deja un pop visual (siempre) y una ráfaga sonora (M2, vía M1).
    // El host limita cuántos pulsos SUENAN por segundo; acá se emiten todos.
    const delivered = updateAtp(atp, cc.atp, step, demand)
    for (const d of delivered) {
      spawnAtpPop(d.x, d.z)
      events.push({ type: 'pulse', y: H * 0.45 })
    }

    // Invasores: llegan cada tanto y buscan la membrana.
    invaderClock -= step
    if (invaderClock <= 0) {
      invaderClock = cc.invaders.spawnEvery
      spawnInvader(invaders, cc.invaders, rnd() < 0.5 ? 'bacterium' : 'virion', rnd)
    }
    const invEvents = updateInvaders(invaders, cc.invaders, step, rnd, (x, z) => containsPoint(membrane, x, z))
    // La infección ya la detecta invaders.js; acá se traduce al contrato de M1
    // (con `dir` según la posición del virión, misma convención que scene.js).
    for (const ev of invEvents) {
      if (ev.type !== 'infection') continue
      const dir = Math.abs(ev.x) > Math.abs(ev.z)
        ? (ev.x > 0 ? 'right' : 'left') : (ev.z > 0 ? 'ahead' : 'behind')
      events.push({ type: 'conflict', agent: 'virión', agentType: 'invader', kind: 'infection', dir })
    }
    // Un virión que entró deja de ser un invasor DEL SUSTRATO: se lo saca para
    // que su slot vuelva a circular. Qué le pasa adentro (replicar o acabar en
    // un lisosoma) es materia de F5; sin esto, a las pocas infecciones el pool
    // queda lleno de pegados y no llega nadie más.
    for (const inv of invaders) if (inv.bound) inv.alive = false

    // ── El sustrato corre bajo una célula centrada ──────────────────────────
    // El grupo se posiciona con wrap módulo P: como el patrón es periódico, el
    // suelo parece infinito y nunca se agota.
    const wrap = (v) => { const m = ((v % P) + P) % P; return m - P / 2 }
    substrate.position.set(wrap(motility.subX * R), 0, wrap(motility.subZ * R))

    // La fuente está clavada al sustrato: se arrastra con él (delta del offset).
    source.x += motility.subX - prevSubX
    source.z += motility.subZ - prevSubZ
    prevSubX = motility.subX; prevSubZ = motility.subZ
    // Al alcanzarla, aparece otra lejos: la célula reorienta y sigue migrando.
    if (Math.hypot(source.x, source.z) < 0.5) {
      const a = rnd() * Math.PI * 2
      source = { x: Math.cos(a) * 1.3, z: Math.sin(a) * 1.3 }
    }
    // El marcador del quimioatrayente late sobre el sustrato en la posición fuente.
    sourceMark.position.set(source.x * R, -H + 0.6, source.z * R)
    const pulse = 1 + Math.sin(clock * 3) * 0.25
    sourceMark.scale.setScalar(pulse)

    // Adhesiones: nacen bajo el lamelipodio, guardan el offset del sustrato de
    // ese instante, y al dibujarse desfilan hacia atrás relativas a la célula.
    for (const ad of adhesions) ad.age += step
    for (let i = adhesions.length - 1; i >= 0; i--) {
      if (adhesions[i].age > adhesions[i].ttl) adhesions.splice(i, 1)
    }
    if (adhesions.length < cc.adhesions && rnd() < motility.protrusion * 4 * step) {
      const a = motility.frontAngle + (rnd() - 0.5) * 1.2
      const r = radiusAt(membrane, a) * R * (0.72 + rnd() * 0.2)
      adhesions.push({
        bx: Math.cos(a) * r, bz: Math.sin(a) * r,   // posición de nacimiento (mundo)
        sbx: motility.subX, sbz: motility.subZ,      // offset del sustrato entonces
        ang: a, age: 0, ttl: 4 + rnd() * 4,
      })
    }

    // ── Organelos: deambulan SOBRE los rieles, contenidos por la membrana ───
    updateRoamers(roamers, cc.wander, step, rnd, clock, rails, nearestOnRails)
    // Sesgo direccional (M3): lo secretor deriva hacia la membrana, lo
    // digestivo hacia el centro — el tráfico se lee sin etiquetas.
    applyRoleBias(roamers, roles, cc.traffic, step)
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
    drawMembrane(motility.frontAngle, mit.furrow)
    drawCortex(motility.frontAngle, motility.protrusion * (1 - rounding))
    drawRails()
    drawMotors()
    mitosisDraw.update(mit)
    drawInvaders()
    drawAdhesions(motility.subX, motility.subZ)
    for (let i = 0; i < cc.atp.capacity; i++) {
      const q = atp.quanta[i]
      atpCloud.pos[i * 3] = q.alive ? q.x * R : 0
      atpCloud.pos[i * 3 + 1] = q.alive ? H * 0.45 : -9999
      atpCloud.pos[i * 3 + 2] = q.alive ? q.z * R : 0
    }
    atpCloud.commit()
    drawAtpPops(step)
    trails.update(worldPos)

    // Etiqueta: SOLO al pasar el mouse por encima de un organelo (no en el centro).
    let bestI = -1
    if (ptrX !== null) {
      let bestD = 0.14 // umbral de "encima" en NDC (organelos chicos y en movimiento)
      for (let i = 0; i < n; i++) {
        _proj.set(worldPos[i * 3], worldPos[i * 3 + 1] + 4, worldPos[i * 3 + 2]).project(camera)
        if (_proj.z > 1) continue
        const [vx, vy] = lensNDC(_proj.x, _proj.y) // NDC VISUAL (con el lente)
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

    // El timer de inactividad del stage re-activa la órbita tras arrastrar; en
    // este mundo la queremos siempre apagada.
    controls.autoRotate = false
    stage.render(step)
    return events
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
    update, scare, setPointer,
    resize: stage.resize, flash: stage.flash, dispose: stage.dispose,
  }
}
