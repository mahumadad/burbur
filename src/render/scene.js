import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { PALETTE } from '../config.js'
import { noise2, fbm } from './noise.js'
import { createPaths, nearestOnPaths } from '../sim/paths.js'
import { createRoamers, updateRoamers } from '../sim/wander.js'
import { createBugs, updateBugs, nearestBug } from '../sim/behaviors.js'
import { createPerchers, updatePerchers } from '../sim/perch.js'

// El mundo se construye SOLO con LineSegments (color por vértice) y Points (shader propio).
// Sin mallas de vegetación, sin texturas, sin bloom: el brillo sale del blending aditivo.

const rnd = Math.random

// ─── Campos del terreno (fórmulas y frecuencias del original) ────────────────
const TERRAIN_AMP = 1.7   // relieve muy suave: ±1.7

function terrainHeight(x, z) {
  return (fbm(x * 0.03 + 7.7, z * 0.03 - 3.1, 3) - 0.5) * 2 * TERRAIN_AMP
}

/**
 * Fertilidad: fbm remapeado con recorte duro. Al saturar en 0 y en 1 crea
 * ZONAS — parches pelados y parches frondosos — en vez de variación uniforme.
 * Es lo que hace que el pasto no se vea regular.
 */
function fertility(x, z) {
  const v = (fbm(x * 0.045 + 21, z * 0.045 + 9, 3) - 0.34) / 0.36
  return Math.max(0, Math.min(1, v))
}
/**
 * Máscara de isla: la caída arranca al 60% del radio y termina al 98%.
 * Ese tramo largo (no un borde corto) es lo que disuelve el horizonte en negro.
 */
function islandMask(x, z, R) {
  const r = Math.hypot(x, z)
  const wob = (noise2(x * 0.05 + 3.3, z * 0.05 + 8.8) - 0.5) * 16
  const inner = R * 0.6 + wob
  let t = (r - inner) / (R * 0.98 - inner)
  t = Math.max(0, Math.min(1, t))
  return 1 - t * t * (3 - 2 * t)
}

/**
 * Pozos de luz: manchas iluminadas y zonas en sombra, como si un foco irregular
 * cayera sobre el claro. Se hornea en el color: persiste incluso de noche.
 */
function lightPool(x, z) {
  const a = fbm(x * 0.026 + 11, z * 0.026 + 29, 2)
  const b = noise2(x * 0.011 + 61, z * 0.011 + 7)
  // `a` viene del fbm sin normalizar (media ≈ 0.44), por eso los coeficientes.
  const v = a * 0.62 + b * 0.38
  // Rango amplio: zonas casi en sombra y pozos claramente iluminados.
  return 0.38 + 2.05 * Math.pow(Math.max(0, v), 1.85)
}

// Gradiente del pasto: de verde casi negro (zona pelada) a verde-amarillo (zona
// frondosa). Indexado por la fertilidad → las zonas se leen como manchas.
const GRASS_RAMP = [
  [0.030, 0.062, 0.016],
  [0.085, 0.190, 0.045],
  [0.235, 0.430, 0.095],
  [0.545, 0.720, 0.160],
  [0.760, 0.870, 0.310],
]
function grassColor(f, out) {
  const t = Math.max(0, Math.min(0.999, f)) * (GRASS_RAMP.length - 1)
  const i = t | 0
  const k = t - i
  const a = GRASS_RAMP[i], b = GRASS_RAMP[i + 1]
  out[0] = a[0] + (b[0] - a[0]) * k
  out[1] = a[1] + (b[1] - a[1]) * k
  out[2] = a[2] + (b[2] - a[2]) * k
}

export function createScene(container, cfg, agentNames = []) {
  const R = cfg.world.radius
  const G = cfg.world.groundY
  const rc = cfg.render

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)
  // Niebla negra: la distancia se funde en la oscuridad. La densidad la fija el clima.
  scene.fog = new THREE.FogExp2(0x000000, 0.004)
  let grassMat, floraMat, groundMat
  // Puntos de interés (coordenadas normalizadas): destinos de los agentes.
  const poiFlowers = []
  const poiPerch = []      // copas de árbol y cimas de roca {x, z, h}
  const treeObstacles = [] // troncos a bordear (normalizado {x, z, r})
  const rockDomes = []     // rocas por encima (mundo {x, z, r, h})

  // Clima que pinta el suelo: sombras de nubes móviles + nieve + humedad.
  const shadowUniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(0.025, 0.01) },
    uCloud: { value: 0.5 },  // 0 despejado, 1 nublado (sombras marcadas)
    uSun: { value: 1.0 },    // >1 día soleado
    uSnow: { value: 0.0 },   // acumulación de nieve
    uWet: { value: 0.0 },    // agua del deshielo
  }
  function applyCloudShadow(material) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shadowUniforms)
      shader.vertexShader = 'uniform float uTime; uniform vec2 uWind; uniform float uCloud, uSun; varying float vShadow;\n'
        + shader.vertexShader.replace('void main() {', `void main() {
          {
            vec2 q = position.xz * 0.02 + uWind * uTime;
            float a = sin(q.x) + cos(q.y * 1.13);
            float b = sin(q.x * 0.5 + q.y * 0.7 + 1.3);
            float n = (a * 0.5 + b) * 0.5;
            float lit = smoothstep(-0.2, 0.9, n);
            vShadow = mix(1.0 - uCloud * 0.5, 1.0, lit) * uSun;
          }`)
      shader.fragmentShader = 'uniform float uSnow, uWet; varying float vShadow;\n'
        + shader.fragmentShader.replace('#include <fog_fragment>', `
          gl_FragColor.rgb *= vShadow;
          gl_FragColor.rgb *= (1.0 - uWet * 0.28);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.90, 0.93, 1.0), uSnow);
          #include <fog_fragment>`)
    }
    material.needsUpdate = true
  }

  const fov = 50 + rc.fisheye * 72 // 93°
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.5, 900)
  // Órbita esférica inicial (r=118, theta=0.62, phi=0.92) — vista aérea 3/4.
  const orbR = 118, th = 0.62, ph = 0.92
  camera.position.set(
    orbR * Math.sin(ph) * Math.cos(th),
    orbR * Math.cos(ph),
    orbR * Math.sin(ph) * Math.sin(th),
  )
  camera.lookAt(0, 0, 0)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setClearColor(0x000000, 1)
  container.appendChild(renderer.domElement)

  // Etiqueta flotante que sigue al agente más cercano al centro (estilo murmur).
  const label = document.createElement('div')
  label.style.cssText = `position:absolute; left:0; top:0; z-index:6; pointer-events:none;
    transform:translate(-50%,-100%); background:#000; color:#e2ddd1;
    font:600 12px/1 ui-monospace,'DM Mono',monospace; letter-spacing:0.05em;
    text-transform:uppercase; padding:5px 8px; border-radius:4px; white-space:nowrap;
    opacity:0; transition:opacity 0.15s ease;`
  container.appendChild(label)
  const _proj = new THREE.Vector3()

  // Destello de relámpago: overlay blanco que se apaga rápido.
  const flashEl = document.createElement('div')
  flashEl.style.cssText = `position:absolute; inset:0; z-index:7; pointer-events:none;
    background:#e6f0ff; opacity:0; mix-blend-mode:screen;`
  container.appendChild(flashEl)
  let flashV = 0

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 0, 0)
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.minDistance = 40
  controls.maxDistance = 260
  controls.maxPolarAngle = Math.PI * 0.49 // no bajar del horizonte
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.3
  // La vista nunca queda estática: la auto-rotación se reanuda tras inactividad.
  let idleTimer = null
  controls.addEventListener('start', () => {
    controls.autoRotate = false
    if (idleTimer) clearTimeout(idleTimer)
  })
  controls.addEventListener('end', () => {
    idleTimer = setTimeout(() => { controls.autoRotate = true }, 3500)
  })

  // ─── Acumuladores: un solo buffer de líneas y uno de puntos ────────────────
  const linePos = []
  const lineCol = []
  const ptPos = []
  const ptCol = []
  const ptSize = []
  const ptPhase = []

  function pushLine(x1, y1, z1, x2, y2, z2, c1, c2) {
    linePos.push(x1, y1, z1, x2, y2, z2)
    lineCol.push(c1[0], c1[1], c1[2], c2[0], c2[1], c2[2])
  }
  function pushPoint(x, y, z, col, size, phase) {
    ptPos.push(x, y, z)
    ptCol.push(col[0], col[1], col[2])
    ptSize.push(size)
    ptPhase.push(phase || 0)
  }

  // ─── SUELO: malla que rellena los huecos entre hojas ──────────────────────
  // Sin ella se ve el negro a través del pasto y el claro pierde luminosidad.
  {
    const SEGS = 88
    const size = R * 2.4
    const geo = new THREE.PlaneGeometry(size, size, SEGS, SEGS)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    const cols = new Float32Array(pos.count * 3)
    const c = [0, 0, 0]
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      pos.setY(i, G + terrainHeight(x, z) - 0.22)
      // Tono del pasto pero en la zona oscura de la rampa, y atenuado.
      grassColor(fertility(x, z) * 0.42, c)
      const f = islandMask(x, z, R) * 0.42
      cols[i * 3] = c[0] * f
      cols[i * 3 + 1] = c[1] * f
      cols[i * 3 + 2] = c[2] * f
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    groundMat = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: true,
    })
    applyCloudShadow(groundMat)
    scene.add(new THREE.Mesh(geo, groundMat))
  }

  // ─── PASTO: cada hoja = 4 vértices = 2 segmentos, gradiente por vértice ────
  {
    const target = rc.grassBlades
    const gp = new Float32Array(target * 12)
    const gc = new Float32Array(target * 12)
    const base = [0, 0, 0]
    let n = 0
    for (let i = 0; i < target * 1.35 && n < target; i++) {
      const rad = R * Math.sqrt(rnd())
      const ang = rnd() * 6.2832
      const x = Math.cos(ang) * rad
      const z = Math.sin(ang) * rad
      const mask = islandMask(x, z, R)
      if (mask < 0.02) continue
      const y = G + terrainHeight(x, z)
      const fert = fertility(x, z)
      const h = (2.3 + rnd() * 2.1) * (0.75 + 0.55 * fert)
      // Inclinación por ruido COHERENTE → el pasto se peina en corrientes.
      const a = noise2(x * 0.02 + 51, z * 0.02 + 13) * 12.566 + (rnd() - 0.5) * 1.3
      const lean = (0.3 + rnd() * 0.85) * (0.55 + 0.9 * noise2(x * 0.035 + 4, z * 0.035))
      const vx = Math.cos(a) * lean
      const vz = Math.sin(a) * lean
      grassColor(fert + (rnd() - 0.5) * 0.2, base)
      // Brillo: máscara de isla × elevación normalizada (lo alto recibe más luz).
      const elev = Math.max(0, Math.min(1, (y + TERRAIN_AMP) / (2 * TERRAIN_AMP)))
      const k = mask * (0.55 + 0.45 * elev)
      const cr = base[0] * k, cg = base[1] * k, cb = base[2] * k
      const T = n * 12
      // base → medio
      gp[T] = x;               gp[T + 1] = y;            gp[T + 2] = z
      gp[T + 3] = x + vx * .35; gp[T + 4] = y + h * .62;  gp[T + 5] = z + vz * .35
      // medio → punta (LineSegments empareja 0-1 y 2-3)
      gp[T + 6] = gp[T + 3];    gp[T + 7] = gp[T + 4];    gp[T + 8] = gp[T + 5]
      gp[T + 9] = x + vx;       gp[T + 10] = y + h;       gp[T + 11] = z + vz
      // Gradiente vertical: oscuro abajo, brillante en la punta.
      gc[T] = cr * .40;      gc[T + 1] = cg * .40;  gc[T + 2] = cb * .40
      gc[T + 3] = cr * .85;  gc[T + 4] = cg * .85;  gc[T + 5] = cb * .85
      gc[T + 6] = gc[T + 3]; gc[T + 7] = gc[T + 4]; gc[T + 8] = gc[T + 5]
      gc[T + 9] = Math.min(1, cr * 1.15)
      gc[T + 10] = Math.min(1, cg * 1.15)
      gc[T + 11] = Math.min(1, cb * 1.15)
      n++
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(gp.slice(0, n * 12), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(gc.slice(0, n * 12), 3))
    grassMat = new THREE.LineBasicMaterial({ vertexColors: true, fog: true })
    applyCloudShadow(grassMat)
    scene.add(new THREE.LineSegments(geo, grassMat))
  }

  // ─── FLORES: tallo curvo de 2 segmentos + 1 cabeza o racimo de 2–4 ────────
  const STEM_LO = [0.16, 0.22, 0.10]
  const STEM_MID = [0.26, 0.34, 0.16]
  const STEM_HI = [0.38, 0.46, 0.24]
  const FLOWER_COLS = [
    [1.0, 0.48, 0.09], [1.0, 0.37, 0.69], [0.93, 0.95, 1.0],
    [1.0, 0.88, 0.10], [0.95, 0.30, 0.30], [1.0, 0.69, 0.35],
  ]

  /** Paleta de parche: un color domina (aparece 2 de 3) y otro hace de acento. */
  function patchPalette() {
    const a = FLOWER_COLS[(rnd() * FLOWER_COLS.length) | 0]
    return [a, a, FLOWER_COLS[(rnd() * FLOWER_COLS.length) | 0]]
  }

  function flower(x, y, z, scale, lit = 1, palette = FLOWER_COLS) {
    const h = (3 + rnd() * 3.6) * scale
    const a = rnd() * 6.2832
    const c = (0.5 + rnd() * 1.3) * scale
    const lx = Math.cos(a) * c, lz = Math.sin(a) * c
    const mx = x + lx * 0.32, my = y + h * 0.55, mz = z + lz * 0.32
    const tx = x + lx, ty = y + h, tz = z + lz
    pushLine(x, y, z, mx, my, mz, STEM_LO, STEM_MID)
    pushLine(mx, my, mz, tx, ty, tz, STEM_MID, STEM_HI)
    const src = palette[(rnd() * palette.length) | 0]
    const col = [src[0] * lit, src[1] * lit, src[2] * lit]
    if (rnd() < 0.42) {
      const k = 2 + ((rnd() * 3) | 0)
      for (let i = 0; i < k; i++) {
        const b = rnd() * 6.2832
        const xr = (0.5 + rnd() * 1.2) * scale
        const yr = (0.3 + rnd() * 1.0) * scale
        const cx = tx + Math.cos(b) * xr, cy = ty + yr, cz = tz + Math.sin(b) * xr
        pushLine(tx, ty, tz, cx, cy, cz, STEM_MID, STEM_HI)
        pushPoint(cx, cy, cz, col, (0.34 + rnd() * 0.34) * scale, rnd())
      }
    } else {
      pushPoint(tx, ty + 0.1 * scale, tz, col, (0.44 + rnd() * 0.42) * scale, rnd())
    }
  }

  // Sembrado en parches (no uniforme).
  for (let p = 0; p < rc.flowerPatches; p++) {
    const pr = R * (0.12 + 0.82 * rnd())
    const pa = rnd() * 6.2832
    const px = Math.cos(pa) * pr, pz = Math.sin(pa) * pr
    if (islandMask(px, pz, R) < 0.25) continue
    poiFlowers.push({ x: px / R, z: pz / R })
    const k = 10 + ((rnd() * 14) | 0)
    const spread = 2.5 + rnd() * 3.5
    const palette = patchPalette()
    for (let i = 0; i < k; i++) {
      const b = rnd() * 6.2832
      const d = spread * Math.sqrt(rnd()) * (1 + rnd() * 0.6)
      const fx = px + Math.cos(b) * d, fz = pz + Math.sin(b) * d
      if (islandMask(fx, fz, R) < 0.1) continue
      flower(fx, G + terrainHeight(fx, fz), fz, 0.6 + rnd() * 0.75,
        Math.min(1.3, lightPool(fx, fz)), palette)
    }
  }

  // ─── BAYAS: tallos blancos que se bifurcan con racimos de puntos ──────────
  const STEM_W = [1, 1, 1]
  function berry(x, y, z) {
    const r = rnd()
    const col = r < 0.72 ? [1, 0.13 + rnd() * 0.06, 0.08]
      : r < 0.9 ? [1, 0.45, 0.1] : [0.97, 0.97, 1]
    pushPoint(x, y, z, col, 0.24 + rnd() * 0.24, 0)
  }
  function berryBush(x, gy, z, scale) {
    const o = 0.1 + rnd() * 0.4
    const a = rnd() * 6.2832
    const s = Math.sin(o) * Math.cos(a), c = Math.cos(o), l = Math.sin(o) * Math.sin(a)
    const u = (2 + rnd() * 2.8) * scale
    const px = x + s * u * 0.55 + (rnd() - 0.5) * 0.5
    const py = gy + c * u * 0.55
    const pz = z + l * u * 0.55 + (rnd() - 0.5) * 0.5
    pushLine(x, gy, z, px, py, pz, STEM_W, STEM_W)
    const tx = x + s * u + (rnd() - 0.5) * 0.9
    const ty = gy + c * u
    const tz = z + l * u + (rnd() - 0.5) * 0.9
    pushLine(px, py, pz, tx, ty, tz, STEM_W, STEM_W)
    berry(tx, ty, tz)
    const branches = 1 + ((rnd() * 3) | 0)
    for (let b = 0; b < branches; b++) {
      const S = 0.45 + rnd() * 0.5
      const cx = x + (px - x) * S + (tx - px) * Math.max(0, S - 0.5)
      const cy = gy + (py - gy) * S + (ty - py) * Math.max(0, S - 0.5)
      const cz = z + (pz - z) * S + (tz - pz) * Math.max(0, S - 0.5)
      const E = u * (0.22 + rnd() * 0.26)
      const D = rnd() * 6.2832, O = 0.5 + rnd() * 0.7
      const kx = cx + Math.sin(O) * Math.cos(D) * E
      const ky = cy + Math.cos(O) * E
      const kz = cz + Math.sin(O) * Math.sin(D) * E
      pushLine(cx, cy, cz, kx, ky, kz, STEM_W, STEM_W)
      berry(kx, ky, kz)
      if (rnd() < 0.35) berry(cx, cy, cz)
    }
  }
  // Esparcidas en el sotobosque, en pequeños grupos.
  for (let p = 0; p < rc.berryClusters; p++) {
    const br = R * (0.12 + 0.76 * rnd())
    const ba = rnd() * 6.2832
    const bx = Math.cos(ba) * br, bz = Math.sin(ba) * br
    if (islandMask(bx, bz, R) < 0.25) continue
    const g2 = 3 + ((rnd() * 6) | 0)
    for (let i = 0; i < g2; i++) {
      const d = 1.5 + rnd() * 3
      const aa = rnd() * 6.2832
      const wx = bx + Math.cos(aa) * d, wz = bz + Math.sin(aa) * d
      if (islandMask(wx, wz, R) < 0.15) continue
      berryBush(wx, G + terrainHeight(wx, wz), wz, 0.7 + rnd() * 0.6)
    }
  }

  // ─── ÁRBOLES SECOS: ramas curvas recursivas (líneas) ──────────────────────
  // Los árboles son TUBOS ahusados (malla), no líneas: por eso en el original
  // tienen silueta sólida y facetas visibles.
  const TREE_FILL = 0x130d09   // relleno casi negro
  const TREE_EDGE = 0xd9d9ba   // aristas color hueso
  const treePos = [], treeIdx = []

  /** Tubo alrededor de una espina, con ahusado y radio perturbado por ruido. */
  function tube(spine, r0, r1, segs, seed) {
    const base = treePos.length / 3
    const n = spine.length
    const tan = new THREE.Vector3(), up = new THREE.Vector3()
    const bx = new THREE.Vector3(), by = new THREE.Vector3()
    for (let c = 0; c < n; c++) {
      tan.subVectors(spine[Math.min(n - 1, c + 1)], spine[Math.max(0, c - 1)]).normalize()
      up.set(0, 1, 0)
      if (Math.abs(tan.y) > 0.9) up.set(1, 0, 0)
      bx.crossVectors(tan, up).normalize()
      by.crossVectors(tan, bx)
      const h = c / (n - 1)
      const g = r0 + (r1 - r0) * Math.pow(h, 0.85)
      const p = spine[c]
      for (let l = 0; l < segs; l++) {
        const a = (l / segs) * 6.2832
        const cv = Math.cos(a), sv = Math.sin(a)
        // Radio irregular → corteza con relieve, no un cilindro liso.
        const rad = g * (1 + (noise2(p.x * 1.4 + seed + l * 3.7, p.z * 1.4 + p.y * 0.9) - 0.5) * 0.34)
        treePos.push(
          p.x + (bx.x * cv + by.x * sv) * rad,
          p.y + (bx.y * cv + by.y * sv) * rad,
          p.z + (bx.z * cv + by.z * sv) * rad,
        )
      }
    }
    for (let c = 0; c < n - 1; c++) {
      for (let l = 0; l < segs; l++) {
        const x = base + c * segs + l
        const s2 = base + c * segs + ((l + 1) % segs)
        const C = x + segs, w = s2 + segs
        treeIdx.push(x, C, s2, s2, C, w)
      }
    }
  }

  /**
   * Rama recursiva: espina de 4 tramos que se desvía al azar (con sesgo hacia
   * arriba), envuelta en un tubo que se adelgaza. Los hijos salen del extremo
   * o de un punto intermedio, abiertos en un cono.
   */
  function branch(start, dir, len, radius, depth, maxDepth, seed, fallen) {
    const SEG = 4
    const spine = [start.clone()]
    const cur = start.clone()
    const d = dir.clone()
    for (let p = 0; p < SEG; p++) {
      d.x += (rnd() - 0.5) * 0.55
      // Los troncos caídos casi no suben; los erguidos tienen sesgo hacia arriba.
      d.y += (rnd() - 0.5) * 0.38 + (fallen ? 0.02 : 0.16)
      d.z += (rnd() - 0.5) * 0.55
      d.normalize()
      cur.addScaledVector(d, len / SEG)
      spine.push(cur.clone())
    }
    const tip = depth >= maxDepth
    const rEnd = tip ? 0.03 : radius * (0.52 + rnd() * 0.16)
    tube(spine, radius, rEnd, radius > 0.8 ? 9 : radius > 0.35 ? 7 : 5, seed)
    if (tip) return
    const kids = depth === 0 ? 2 + ((rnd() * 2) | 0)
      : (rnd() < 0.7 ? 1 : 2) + (rnd() < 0.25 ? 1 : 0)
    const up = new THREE.Vector3()
    for (let i = 0; i < kids; i++) {
      const v = d.clone()
      up.set(0, 1, 0)
      if (Math.abs(v.y) > 0.9) up.set(1, 0, 0)
      const bx = new THREE.Vector3().crossVectors(v, up).normalize()
      const by = new THREE.Vector3().crossVectors(v, bx)
      const az = rnd() * 6.2832
      const spread = 0.35 + rnd() * 0.65
      const w = bx.multiplyScalar(Math.cos(az)).addScaledVector(by, Math.sin(az))
      v.multiplyScalar(Math.cos(spread)).addScaledVector(w, Math.sin(spread)).normalize()
      const from = i === 0 ? spine[spine.length - 1]
        : spine[1 + ((rnd() * (spine.length - 1)) | 0)]
      branch(from.clone(), v, len * (0.6 + rnd() * 0.22),
        rEnd * (0.85 + rnd() * 0.2), depth + 1, maxDepth, seed, fallen)
    }
  }

  // Pocos árboles y bien separados: 3–5 en pie, 1–2 troncos caídos.
  const standing = 3 + ((rnd() * 3) | 0)
  for (let t = 0, guard = 0; t < standing && guard++ < 80; ) {
    const ta = rnd() * 6.2832
    const tr = R * (0.19 + rnd() * 0.54)
    const tx = Math.cos(ta) * tr, tz = Math.sin(ta) * tr
    if (islandMask(tx, tz, R) < 0.3) continue
    const treeLen = 8 + rnd() * 7
    branch(new THREE.Vector3(tx, G + terrainHeight(tx, tz) - 0.8, tz),
      new THREE.Vector3((rnd() - 0.5) * 0.5, 1, (rnd() - 0.5) * 0.5).normalize(),
      treeLen, 0.95 + rnd() * 0.65, 0, 3, rnd() * 97, false)
    // Punto de posado en la copa + obstáculo del tronco (se bordea).
    poiPerch.push({ x: tx / R, z: tz / R, h: treeLen * 0.55 })
    treeObstacles.push({ x: tx / R, z: tz / R, r: 2.6 / R })
    t++
  }
  const logs = 1 + (rnd() < 0.5 ? 1 : 0)
  for (let t = 0, guard = 0; t < logs && guard++ < 60; ) {
    const ta = rnd() * 6.2832
    const tr = R * (0.12 + rnd() * 0.40)
    const tx = Math.cos(ta) * tr, tz = Math.sin(ta) * tr
    if (islandMask(tx, tz, R) < 0.3) continue
    branch(new THREE.Vector3(tx, G + terrainHeight(tx, tz) + 0.35, tz),
      new THREE.Vector3(rnd() - 0.5, 0.06, rnd() - 0.5).normalize(),
      9 + rnd() * 8, 0.55 + rnd() * 0.4, 2, 3, rnd() * 97, true)
    t++
  }

  if (treeIdx.length) {
    const tg = new THREE.BufferGeometry()
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(treePos), 3))
    tg.setIndex(treeIdx)
    // Relleno oscuro plano...
    scene.add(new THREE.Mesh(tg, new THREE.MeshBasicMaterial({
      color: TREE_FILL, side: THREE.DoubleSide, fog: true,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    })))
    // ...y las ARISTAS encima: es lo que deja ver la geometría del tubo.
    scene.add(new THREE.LineSegments(
      new THREE.WireframeGeometry(tg),
      new THREE.LineBasicMaterial({
        color: TREE_EDGE, transparent: true, opacity: 0.55, fog: true,
      }),
    ))
  }

  // ─── ROCAS: nubes de puntos reales (no dither) ────────────────────────────
  // Rocas: MALLA (esfera deformada por ruido, base aplanada) → silueta dura.
  // Encima, puntos de musgo solo en las caras que miran hacia arriba.
  const ROCK_LO = [0.30, 0.185, 0.15]
  const ROCK_HI = [0.64, 0.47, 0.40]
  const rockSpots = []
  // Formación agrupada: un monolito alto rodeado de bloques medianos y chicos.
  const hubX = (rnd() * 2 - 1) * 11, hubZ = (rnd() * 2 - 1) * 11
  const rockPlan = [{ x: hubX, z: hubZ, rx: 7.5 + rnd() * 3, h: 19 + rnd() * 10, mono: true }]
  for (let i = 0, k = 3 + ((rnd() * 3) | 0); i < k; i++) {
    const a = rnd() * 6.2832, d = 9 + rnd() * 13
    rockPlan.push({
      x: hubX + Math.cos(a) * d, z: hubZ + Math.sin(a) * d,
      rx: 3.4 + rnd() * 3.4, h: 4.5 + rnd() * 6, mono: false,
    })
  }
  for (let i = 0, k = 4 + ((rnd() * 4) | 0); i < k; i++) {
    const a = rnd() * 6.2832, d = 14 + rnd() * 22
    rockPlan.push({
      x: hubX + Math.cos(a) * d, z: hubZ + Math.sin(a) * d,
      rx: 1.6 + rnd() * 2, h: 1.8 + rnd() * 2.6, mono: false,
    })
  }

  for (const spec of rockPlan) {
    const cx = spec.x, cz = spec.z
    if (islandMask(cx, cz, R) < 0.25) continue
    const cy = G + terrainHeight(cx, cz)
    const radX = spec.rx
    const hh = spec.h * 0.6
    const radZ = radX * (0.68 + rnd() * 0.62)
    const seed = rnd() * 97
    const rot = rnd() * 6.2832
    const cr = Math.cos(rot), sr = Math.sin(rot)

    // Icosaedro: triángulos parejos, mejor que una esfera UV para deformar.
    const geo = new THREE.IcosahedronGeometry(1, spec.mono ? 4 : 3)
    const pos = geo.attributes.position
    const cols = new Float32Array(pos.count * 3)
    for (let d = 0; d < pos.count; d++) {
      const fx = pos.getX(d), fy = pos.getY(d), fz = pos.getZ(d)
      const lump = 1
        + (fbm(fx * 2.1 + fy * 1.6 + seed, fz * 2.1 - fy * 1.3 + seed * 0.6, 3) - 0.5) * 0.62
        + (noise2(fx * 0.8 + seed, fz * 0.8 + fy * 0.7) - 0.5) * 0.46
      let gx = fx * lump * radX
      let gy = fy * lump * hh
      const gz = fz * lump * radZ
      // Aplanar la base para que se asiente en el suelo.
      if (gy < -hh * 0.14) gy = -hh * 0.14 + (gy + hh * 0.14) * 0.22
      pos.setXYZ(d, gx * cr - gz * sr, gy, gx * sr + gz * cr)
    }
    geo.computeVertexNormals()
    const nrm = geo.attributes.normal
    for (let d = 0; d < pos.count; d++) {
      const py = pos.getY(d)
      const up = nrm.getY(d) * 0.5 + 0.5
      const t = Math.max(0, Math.min(1,
        0.2 + ((py / hh + 1) / 2) * 0.52 + up * 0.22
        + (fbm(pos.getX(d) * 0.33 + seed, pos.getZ(d) * 0.33, 3) - 0.5) * 0.55))
      cols[d * 3] = ROCK_LO[0] + (ROCK_HI[0] - ROCK_LO[0]) * t
      cols[d * 3 + 1] = ROCK_LO[1] + (ROCK_HI[1] - ROCK_LO[1]) * t
      cols[d * 3 + 2] = ROCK_LO[2] + (ROCK_HI[2] - ROCK_LO[2]) * t
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: true,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }))
    const baseY = cy + hh * 0.05
    mesh.position.set(cx, baseY, cz)
    scene.add(mesh)
    rockSpots.push({ x: cx, z: cz, r: Math.max(radX, radZ) * 0.95 })
    // Cima como posado + cúpula para caminar por encima (coords de mundo).
    poiPerch.push({ x: cx / R, z: cz / R, h: hh })
    rockDomes.push({ x: cx, z: cz, r: Math.max(radX, radZ), h: hh })

    // Liquen anaranjado: lo que cubre la roca. Solo en caras que miran arriba.
    const lichenN = spec.mono ? 1100 : 420
    for (let k = 0, guard = 0; k < lichenN && guard++ < lichenN * 9; ) {
      const d = (rnd() * pos.count) | 0
      const ny = nrm.getY(d)
      if (ny < 0.12) continue
      const fx = pos.getX(d), fy = pos.getY(d), fz = pos.getZ(d)
      if (fbm(fx * 0.5 + seed * 1.7, fz * 0.5 + fy * 0.4, 2) < 0.5) continue
      if (rnd() > 0.42 + ny * 0.4) continue
      const A = 0.96 + rnd() * 0.09
      pushPoint(cx + fx, baseY + fy + 0.1, cz + fz,
        [1, 0.827 * A, 0.071], 0.12 + rnd() * 0.17, 0)
      k++
    }

    // Musgo verde: apenas unas manchas, no una capa.
    const mossMax = spec.mono ? 60 : 24
    for (let d = 0, k = 0; d < pos.count && k < mossMax; d += 3) {
      if (nrm.getY(d) <= 0.15) continue
      const fx = pos.getX(d), fy = pos.getY(d), fz = pos.getZ(d)
      if (fbm(fx * 0.4 + seed * 2.3 + 9, fz * 0.4 + fy * 0.5, 2) <= 0.66) continue
      if (rnd() >= 0.5) continue
      pushPoint(cx + fx, baseY + fy + 0.08, cz + fz,
        [0.3, 0.46, 0.3], 0.2 + rnd() * 0.22, 0)
      k++
    }

    // Flores creciendo en las partes planas de arriba.
    let want = spec.mono ? 5 + ((rnd() * 5) | 0) : (rnd() < 0.6 ? 2 + ((rnd() * 3) | 0) : 0)
    const rockPal = patchPalette()
    for (let guard = 0; want > 0 && guard < 400; guard++) {
      const d = ((rnd() * (pos.count / 3)) | 0) * 3
      if (nrm.getY(d) < 0.55) continue
      flower(cx + pos.getX(d), baseY + pos.getY(d), cz + pos.getZ(d),
        0.45 + rnd() * 0.45, 1, rockPal)
      want--
    }
  }

  // ─── HONGOS: tallo corto y grueso + sombrero de puntos ────────────────────
  const CAP_COLS = [
    [0.92, 0.86, 0.74], [0.86, 0.42, 0.30], [0.78, 0.70, 0.86],
    [0.95, 0.72, 0.32], [0.72, 0.74, 0.70],
  ]
  function mushroom(x, y, z, scale, lit) {
    const h = (0.9 + rnd() * 1.1) * scale
    const stem = [0.62 * lit, 0.58 * lit, 0.50 * lit]
    const stemHi = [0.86 * lit, 0.82 * lit, 0.72 * lit]
    // Tallo: 2–3 líneas juntas → se lee grueso.
    for (let s = 0; s < 3; s++) {
      const ox = (rnd() - 0.5) * 0.10 * scale
      const oz = (rnd() - 0.5) * 0.10 * scale
      pushLine(x + ox, y, z + oz, x + ox * 0.5, y + h, z + oz * 0.5, stem, stemHi)
    }
    const base = CAP_COLS[(rnd() * CAP_COLS.length) | 0]
    const col = [base[0] * lit, base[1] * lit, base[2] * lit]
    // Sombrero: anillo de puntos + centro.
    const capR = (0.34 + rnd() * 0.30) * scale
    const ring = 7 + ((rnd() * 6) | 0)
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * 6.2832
      pushPoint(x + Math.cos(a) * capR, y + h - 0.05 * scale, z + Math.sin(a) * capR,
        col, (0.15 + rnd() * 0.12) * scale, 0)
    }
    pushPoint(x, y + h + 0.06 * scale, z, col, (0.24 + rnd() * 0.16) * scale, 0)
  }

  // Agrupados junto a rocas y árboles, como en la naturaleza.
  for (const spot of rockSpots) {
    if (rnd() < 0.35) continue
    const k = 3 + ((rnd() * 7) | 0)
    for (let i = 0; i < k; i++) {
      const a = rnd() * 6.2832
      const d = spot.r * (1.05 + rnd() * 0.9)
      const mx = spot.x + Math.cos(a) * d, mz = spot.z + Math.sin(a) * d
      if (islandMask(mx, mz, R) < 0.2) continue
      mushroom(mx, G + terrainHeight(mx, mz), mz,
        0.7 + rnd() * 0.8, Math.min(1.3, lightPool(mx, mz)))
    }
  }

  // ─── SENDEROS: bucles punteados sobre el terreno ──────────────────────────
  const paths = createPaths(cfg.paths, rnd)
  const PATH_COL = [0.42, 0.05, 0.05]
  for (const loop of paths.loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length]
      const ax = a.x * R, az = a.z * R
      const bx = b.x * R, bz = b.z * R
      const segLen = Math.hypot(bx - ax, bz - az)
      const dots = Math.max(1, Math.round(segLen / 1.15))
      for (let d = 0; d < dots; d++) {
        const f = d / dots
        const px = ax + (bx - ax) * f
        const pz = az + (bz - az) * f
        const lit = Math.min(1.35, lightPool(px, pz))
        pushPoint(px, G + terrainHeight(px, pz) + 0.28, pz,
          [PATH_COL[0] * lit, PATH_COL[1] * lit, PATH_COL[2] * lit],
          0.32 + rnd() * 0.16, 0)
      }
    }
  }

  // ─── Polvo del borde de la isla ───────────────────────────────────────────
  for (let i = 0; i < cfg.world.dustCount; i++) {
    const a = rnd() * 6.2832
    // Ceñido al borde y con caída cuadrática → se disuelve en negro, sin banda.
    const rr = R * (0.90 + Math.pow(rnd(), 1.6) * 0.16)
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr
    const edge = Math.max(0, 1 - (rr - R * 0.90) / (R * 0.16))
    const s = (0.10 + rnd() * 0.30) * edge * edge
    pushPoint(x, G + terrainHeight(x, z) + rnd() * 0.5, z,
      [0.030 * s, 0.055 * s, 0.052 * s], 0.10 + rnd() * 0.16, 0)
  }

  // ─── Subir buffers ────────────────────────────────────────────────────────
  {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePos), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(lineCol), 3))
    floraMat = new THREE.LineBasicMaterial({ vertexColors: true, fog: true })
    applyCloudShadow(floraMat)
    scene.add(new THREE.LineSegments(geo, floraMat))
  }

  // Shader de puntos: tamaño en unidades de MUNDO + balanceo + DOF falso.
  const pointUniforms = {
    uProj: { value: 1000 },
    uT: { value: 0 },
    uFocus: { value: rc.dofFocus },
    uAperture: { value: rc.dofAperture },
  }
  const pointMat = new THREE.ShaderMaterial({
    uniforms: pointUniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute vec3 hcol; attribute float hsize; attribute float hphs;
      uniform float uProj, uT, uFocus, uAperture;
      varying vec3 vC; varying float vSoft;
      void main() {
        vC = hcol;
        vec3 p = position;
        if (hphs > 0.0) {                       // balanceo de vegetación
          float ph = hphs * 6.2831;
          p.x += sin(uT * 0.7 + ph) * 0.42;
          p.z += cos(uT * 0.6 + ph * 1.7) * 0.42;
          p.y += sin(uT * 1.1 + ph * 2.3) * 0.16;
          vC *= 0.92 + 0.12 * sin(uT * 2.0 + ph * 5.0);
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float vd = max(-mv.z, 0.001);
        float coc = abs(vd - uFocus);           // DOF falso: crece al desenfocar
        float worldR = hsize + uAperture * coc * 0.02;
        gl_PointSize = clamp(worldR * uProj / vd, 1.0, 64.0);
        // Difuminado contenido: las flores deben leerse como discos nítidos.
        vSoft = clamp(coc / (uFocus * 1.6), 0.0, 0.45);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision mediump float;
      varying vec3 vC; varying float vSoft;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv) * 2.0;
        if (d > 1.0) discard;
        float edge = mix(0.06, 0.40, vSoft);    // borde casi duro; se ablanda poco
        float a = 1.0 - smoothstep(1.0 - edge, 1.0, d);
        gl_FragColor = vec4(vC, a);
      }`,
  })
  {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ptPos), 3))
    geo.setAttribute('hcol', new THREE.BufferAttribute(new Float32Array(ptCol), 3))
    geo.setAttribute('hsize', new THREE.BufferAttribute(new Float32Array(ptSize), 1))
    geo.setAttribute('hphs', new THREE.BufferAttribute(new Float32Array(ptPhase), 1))
    const pts = new THREE.Points(geo, pointMat)
    pts.frustumCulled = false
    scene.add(pts)
  }

  // ─── NEBLINA aditiva (el halo de color del mundo) ─────────────────────────
  const hazeUniforms = {
    uProj: { value: 1000 },
    uColor: { value: new THREE.Vector3(...rc.hazeColor) },
    uAlpha: { value: rc.hazeAlpha },
  }
  {
    const pos = [], siz = []
    for (let i = 0; i < rc.hazeCount; i++) {
      const a = rnd() * 6.2832
      // Contenida dentro de la isla: fuera de ella el fondo queda negro puro.
      const rr = Math.sqrt(rnd()) * R * 0.92
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr
      pos.push(x, G + terrainHeight(x, z) + 0.3 + rnd() * 9, z)
      siz.push(2.4 + rnd() * 5.2)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('hsize', new THREE.BufferAttribute(new Float32Array(siz), 1))
    const mat = new THREE.ShaderMaterial({
      uniforms: hazeUniforms,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float hsize; uniform float uProj;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(hsize * uProj / max(-mv.z, 0.001), 1.0, 96.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        precision mediump float;
        uniform vec3 uColor; uniform float uAlpha;
        void main() {
          vec2 uv = gl_PointCoord - 0.5; float d2 = dot(uv, uv);
          if (d2 > 0.25) discard;
          float a = 1.0 - sqrt(d2) * 2.0; a = a * a * uAlpha;
          gl_FragColor = vec4(uColor, 1.0) * a;
        }`,
    })
    const h = new THREE.Points(geo, mat)
    h.frustumCulled = false
    scene.add(h)
  }

  // ─── AGENTES: jaula de aristas + criatura molecular + tallo ───────────────
  // Un color por especie: la estela hereda el color de su individuo.
  const AGENT_COLORS = [PALETTE.cyan, PALETTE.magenta, PALETTE.white, PALETTE.yellow]
  // Líneas gruesas de verdad: LineBasicMaterial ignora linewidth en casi todas
  // las plataformas, así que las jaulas usan LineMaterial (grosor en píxeles).
  const fatMaterials = []
  function fatLine(positions, color) {
    const mat = new LineMaterial({ color, linewidth: rc.agentLineWidth })
    mat.resolution.set(1, 1)
    fatMaterials.push(mat)
    const geo = new LineSegmentsGeometry()
    geo.setPositions(positions)
    const seg = new LineSegments2(geo, mat)
    seg.computeLineDistances()
    return seg
  }
  function edgesOf(geometry, color) {
    const e = new THREE.EdgesGeometry(geometry)
    const arr = Array.from(e.attributes.position.array)
    e.dispose()
    geometry.dispose()
    return fatLine(arr, color)
  }
  function ringLoop(radius, segments, color) {
    const pos = []
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2
      const b = ((i + 1) / segments) * Math.PI * 2
      pos.push(Math.cos(a) * radius, 0, Math.sin(a) * radius,
        Math.cos(b) * radius, 0, Math.sin(b) * radius)
    }
    return fatLine(pos, color)
  }
  const pick = (arr) => arr[(rnd() * arr.length) | 0]

  /**
   * Criatura interna: núcleo naranja + 3–4 satélites en direcciones FIJAS
   * (por eso se lee igual desde cualquier ángulo), unidos por enlaces.
   */
  function creature(t) {
    const g = new THREE.Group()
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.6 * t, 16, 12),
      new THREE.MeshBasicMaterial({ color: PALETTE.orange })))
    const dirs = [
      new THREE.Vector3(1, 0.5, 0.3), new THREE.Vector3(-0.8, -0.4, 0.6),
      new THREE.Vector3(0.25, -0.95, -0.55), new THREE.Vector3(0.7, 0.6, -0.7),
    ]
    const cols = [PALETTE.orange, PALETTE.magenta, PALETTE.white, PALETTE.cyanSat]
    const k = 3 + (rnd() < 0.5 ? 1 : 0)
    const seg = []
    for (let i = 0; i < k; i++) {
      const p = dirs[i].clone().normalize().multiplyScalar((1.5 + rnd() * 0.45) * t)
      const s = new THREE.Mesh(
        new THREE.SphereGeometry((0.3 + rnd() * 0.12) * t, 12, 10),
        new THREE.MeshBasicMaterial({ color: cols[(i + ((rnd() * 4) | 0)) % 4] }))
      s.position.copy(p)
      g.add(s)
      seg.push(0, 0, 0, p.x, p.y, p.z)
    }
    g.add(fatLine(seg, PALETTE.bond))
    return g
  }

  /** Cuña/planeador: prisma triangular de 9 aristas. */
  function wedge(e) {
    const t = 5.2, n = 2.2, r = 1.6, lo = -0.7, hi = 0.8
    const P = (x, y, z) => [x * e, y * e, z * e]
    const s = P(0, lo, t), c = P(-n, lo, -r), l = P(n, lo, -r)
    const u = P(0, hi, t * 0.45), d = P(-n * 0.5, hi, -r), f = P(n * 0.5, hi, -r)
    const seg = (a, b) => [...a, ...b]
    return [
      ...seg(s, c), ...seg(c, l), ...seg(l, s),
      ...seg(u, d), ...seg(d, f), ...seg(f, u),
      ...seg(s, u), ...seg(c, d), ...seg(l, f),
    ]
  }

  // Las 4 especies del bosque, tal como las arma el original.
  const SPECIES = ['cyan', 'flag', 'eye', 'dbl']
  const n = cfg.fireflies.count
  const agents = []
  for (let i = 0; i < n; i++) {
    const kind = SPECIES[i % SPECIES.length]
    const group = new THREE.Group()
    let cage = null

    if (kind === 'cyan') {
      // Jaula cúbica de lado 6 + criatura dentro.
      cage = new THREE.Group()
      cage.add(edgesOf(new THREE.BoxGeometry(6, 6, 6), PALETTE.cyan))
      cage.add(creature(1.15))
      group.add(cage)
    } else if (kind === 'eye') {
      // Cuña planeadora (o octaedro) blanca + anillo, mástil y bolita.
      cage = new THREE.Group()
      cage.add(rnd() < 0.55
        ? fatLine(wedge(1.15), PALETTE.white)
        : edgesOf(new THREE.OctahedronGeometry(3.6), PALETTE.white))
      group.add(cage)
      const deco = new THREE.Group()
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 28),
        new THREE.MeshBasicMaterial({ color: PALETTE.magenta, side: THREE.DoubleSide }))
      disc.rotation.x = -Math.PI / 2
      deco.add(disc)
      deco.add(ringLoop(1.55, 40, PALETTE.cyanEye))
      deco.add(fatLine([0, 1, 0, 0, 4, 0], PALETTE.magenta))
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10),
        new THREE.MeshBasicMaterial({ color: PALETTE.white }))
      ball.position.set(0, 4, 0)
      deco.add(ball)
      group.add(deco)
    } else if (kind === 'flag') {
      // Trípode: triángulo abajo, mástil y anillo arriba.
      const lo = -2.6, hi = 5, r = 2.8
      const tri = [
        0, lo, r, -r * 0.86, lo, -r * 0.5,
        -r * 0.86, lo, -r * 0.5, r * 0.86, lo, -r * 0.5,
        r * 0.86, lo, -r * 0.5, 0, lo, r,
      ]
      group.add(fatLine(tri, pick([PALETTE.blue, PALETTE.magenta, PALETTE.cyanSat])))
      group.add(fatLine([0, lo, 0, 0, hi, 0],
        pick([PALETTE.yellow, PALETTE.magenta, PALETTE.orange])))
      const ring = ringLoop(0.85, 30, pick([PALETTE.pink, PALETTE.cyanEye, PALETTE.yellow]))
      ring.position.y = hi
      group.add(ring)
    } else {
      // 'dbl': dos anillos amarillos y un núcleo naranja.
      const a = ringLoop(1.15, 34, PALETTE.yellow); a.position.y = 0.5
      const b = ringLoop(0.75, 30, PALETTE.yellow); b.position.y = -0.5
      group.add(a); group.add(b)
      group.add(new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10),
        new THREE.MeshBasicMaterial({ color: PALETTE.orange })))
    }

    // Parámetros de movimiento (del bundle): los cubos ruedan como esfera, los
    // planeadores se orientan al rumbo, los anillos giran en Y.
    let effR = 3.3, rollMul = 0, glide = false, spinY = 0
    if (kind === 'cyan') { rollMul = 1; effR = 3.3 }
    else if (kind === 'eye') { glide = rnd() < 0.55; rollMul = glide ? 0 : 0.3; effR = 6 }
    else if (kind === 'flag') { spinY = 0.5 }
    else { spinY = 0.7 } // dbl

    // Cada individuo tiene su propia escala.
    const baseScale = 0.9 + rnd() * 0.55
    group.scale.setScalar(baseScale)
    scene.add(group)
    agents.push({ group, cage, kind, baseScale, effR, rollMul, glide, spinY })
  }

  // ─── ESTELAS: puntos de tamaño-mundo que persisten ────────────────────────
  const TRAIL = rc.trailLen
  const tPos = new Float32Array(n * TRAIL * 3)
  const tCol = new Float32Array(n * TRAIL * 3)
  const tSize = new Float32Array(n * TRAIL)
  const tmpC = new THREE.Color()
  for (let i = 0; i < n; i++) {
    tmpC.set(AGENT_COLORS[i % AGENT_COLORS.length])
    for (let s = 0; s < TRAIL; s++) {
      const k = (i * TRAIL + s) * 3
      tCol[k] = tmpC.r; tCol[k + 1] = tmpC.g; tCol[k + 2] = tmpC.b
    }
  }
  const trailGeom = new THREE.BufferGeometry()
  trailGeom.setAttribute('position', new THREE.BufferAttribute(tPos, 3))
  trailGeom.setAttribute('hcol', new THREE.BufferAttribute(tCol, 3))
  trailGeom.setAttribute('hsize', new THREE.BufferAttribute(tSize, 1))
  trailGeom.setAttribute('hphs', new THREE.BufferAttribute(new Float32Array(n * TRAIL), 1))
  const trail = new THREE.Points(trailGeom, pointMat)
  trail.frustumCulled = false
  scene.add(trail)
  let tHead = 0, tFrame = 0

  // ─── BICHITOS: van de flor en flor, huyen de los cazadores ────────────────
  const bugCfg = cfg.bugs
  const bugCount = poiFlowers.length ? bugCfg.count : 0
  const bugs = createBugs(bugCfg, poiFlowers, rnd)
  // Colores FRÍOS (cyan/blanco) para que contrasten con las flores cálidas.
  const BUG_COLS = [[0.55, 1, 1], [0.8, 1, 0.95], [1, 1, 1], [0.5, 0.85, 1]]
  const bugPos = new Float32Array(bugCount * 3)
  const bugColArr = new Float32Array(bugCount * 3)
  const bugSize = new Float32Array(bugCount)
  for (let i = 0; i < bugCount; i++) {
    const c = BUG_COLS[bugs[i].colorIdx % BUG_COLS.length]
    bugColArr[i * 3] = c[0]; bugColArr[i * 3 + 1] = c[1]; bugColArr[i * 3 + 2] = c[2]
    bugSize[i] = 0.42 + rnd() * 0.22
  }
  const bugGeom = new THREE.BufferGeometry()
  bugGeom.setAttribute('position', new THREE.BufferAttribute(bugPos, 3))
  bugGeom.setAttribute('hcol', new THREE.BufferAttribute(bugColArr, 3))
  bugGeom.setAttribute('hsize', new THREE.BufferAttribute(bugSize, 1))
  const bugMat = new THREE.ShaderMaterial({
    uniforms: { uProj: pointUniforms.uProj },
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    vertexShader: `
      attribute vec3 hcol; attribute float hsize; uniform float uProj;
      varying vec3 vC;
      void main(){ vC = hcol;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(hsize * uProj / max(-mv.z, 0.001), 1.0, 40.0);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      precision mediump float; varying vec3 vC;
      void main(){ vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.05, d);
        gl_FragColor = vec4(vC, a); }`,
  })
  const bugMesh = new THREE.Points(bugGeom, bugMat)
  bugMesh.frustumCulled = false
  scene.add(bugMesh)

  // ─── Mapeo simulación → mundo ─────────────────────────────────────────────
  // TODOS deambulan libremente. Los caminos existen y los atraen, pero no los
  // encadenan: subiendo `pathPull` el mismo core sirve para calles de ciudad.
  const roamers = createRoamers(cfg.wander, n, rnd)
  // Unos pocos son cazadores: persiguen al bicho más cercano.
  const hunters = []
  for (let i = 0; i < Math.min(bugCfg.hunters, n); i++) {
    roamers[i].role = 'hunter'; roamers[i].aidx = i; hunters.push(roamers[i])
  }
  // Pájaros: unos se posan en árboles/rocas, otros cruzan el cielo.
  const perchAgents = createPerchers(n, {
    startIndex: hunters.length, perchers: cfg.behaviors.perchers, sky: cfg.behaviors.sky,
  }, rnd)
  const worldPos = new Float32Array(n * 3)
  const heads = new Float32Array(n * 2)
  let simTime = 0

  function mapPositions(dt) {
    const md = dt * moveScale
    simTime += md
    updateRoamers(roamers, cfg.wander, md, rnd, simTime, paths, nearestOnPaths, treeObstacles)
    updatePerchers(perchAgents, roamers, poiPerch, cfg.behaviors, md, rnd)
    for (let i = 0; i < n; i++) {
      const src = roamers[i]
      const x = src.x * R, z = src.z * R
      // Sobre una roca: se sube por su cúpula en vez de atravesarla.
      let lift = 0
      for (const d of rockDomes) {
        const ox = x - d.x, oz = z - d.z
        const dd = Math.hypot(ox, oz)
        if (dd < d.r) {
          const up = d.h * Math.sqrt(Math.max(0, 1 - (dd / d.r) ** 2))
          if (up > lift) lift = up
        }
      }
      worldPos[i * 3] = x
      worldPos[i * 3 + 1] = G + terrainHeight(x, z) + 3.1 + perchAgents[i].yOff + lift
      worldPos[i * 3 + 2] = z
      heads[i * 2] = src.hx
      heads[i * 2 + 1] = src.hz
    }
  }

  // ─── LLUVIA: líneas que caen, recicladas al llegar al suelo ───────────────
  const RAIN_N = 1400
  const rainPos = new Float32Array(RAIN_N * 6)
  const rainTop = new Float32Array(RAIN_N * 3)
  const RAIN_H = 46
  for (let i = 0; i < RAIN_N; i++) {
    const a = rnd() * 6.2832
    const rr = Math.sqrt(rnd()) * R * 1.1
    rainTop[i * 3] = Math.cos(a) * rr
    rainTop[i * 3 + 1] = G + rnd() * RAIN_H
    rainTop[i * 3 + 2] = Math.sin(a) * rr
  }
  const rainGeom = new THREE.BufferGeometry()
  rainGeom.setAttribute('position', new THREE.BufferAttribute(rainPos, 3))
  const rainMat = new THREE.LineBasicMaterial({
    color: 0xbcd6e8, transparent: true, opacity: 0, depthWrite: false,
  })
  const rainMesh = new THREE.LineSegments(rainGeom, rainMat)
  rainMesh.frustumCulled = false
  rainMesh.visible = false
  scene.add(rainMesh)

  function updateRain(dt, intensity) {
    rainMesh.visible = intensity > 0.01
    if (!rainMesh.visible) return
    rainMat.opacity = 0.16 + 0.34 * intensity
    const fall = (26 + 42 * intensity) * dt
    const streak = 1.6 + 3.4 * intensity
    for (let i = 0; i < RAIN_N; i++) {
      let y = rainTop[i * 3 + 1] - fall
      if (y < G - 4) y = G + RAIN_H
      rainTop[i * 3 + 1] = y
      const x = rainTop[i * 3], z = rainTop[i * 3 + 2]
      const k = i * 6
      rainPos[k] = x;             rainPos[k + 1] = y;           rainPos[k + 2] = z
      rainPos[k + 3] = x + 0.5;   rainPos[k + 4] = y - streak;  rainPos[k + 5] = z
    }
    rainGeom.getAttribute('position').needsUpdate = true
  }

  // ─── NIEVE: copos que caen lento y derivan; densidad por intensidad ───────
  const SNOW_N = 1300
  const SNOW_H = 44
  const snowPos = new Float32Array(SNOW_N * 3)
  const snowPhase = new Float32Array(SNOW_N)
  for (let i = 0; i < SNOW_N; i++) {
    const a = rnd() * 6.2832, rr = Math.sqrt(rnd()) * R * 1.05
    snowPos[i * 3] = Math.cos(a) * rr
    snowPos[i * 3 + 1] = G + rnd() * SNOW_H
    snowPos[i * 3 + 2] = Math.sin(a) * rr
    snowPhase[i] = rnd() * 6.2832
  }
  const snowGeom = new THREE.BufferGeometry()
  snowGeom.setAttribute('position', new THREE.BufferAttribute(snowPos, 3))
  const snowMat = new THREE.ShaderMaterial({
    uniforms: { uProj: pointUniforms.uProj },
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    vertexShader: `uniform float uProj; void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = clamp(0.28 * uProj / max(-mv.z, 0.001), 1.0, 20.0);
      gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `void main(){ vec2 uv = gl_PointCoord - 0.5; if(length(uv) > 0.5) discard;
      gl_FragColor = vec4(0.95, 0.97, 1.0, 0.9); }`,
  })
  const snowMesh = new THREE.Points(snowGeom, snowMat)
  snowMesh.frustumCulled = false
  snowMesh.visible = false
  scene.add(snowMesh)

  function updateSnow(dt, clockT, intensity) {
    snowMesh.visible = intensity > 0.01
    if (!snowMesh.visible) return
    const active = Math.floor(intensity * SNOW_N)
    const fall = (5 + 4 * intensity) * dt
    for (let i = 0; i < SNOW_N; i++) {
      if (i >= active) { snowPos[i * 3 + 1] = -9999; continue }
      let y = snowPos[i * 3 + 1] - fall
      if (y < G - 2) { y = G + SNOW_H; }
      snowPos[i * 3 + 1] = y
      // Deriva lateral suave (revoloteo).
      snowPos[i * 3] += Math.sin(clockT * 0.8 + snowPhase[i]) * 6 * dt
      snowPos[i * 3 + 2] += Math.cos(clockT * 0.6 + snowPhase[i] * 1.3) * 6 * dt
    }
    snowGeom.getAttribute('position').needsUpdate = true
  }

  // ─── Post-proceso: el "lente" (fisheye + cromática + viñeta) ──────────────
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const lensPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uStrength: { value: rc.fisheye },
      uChroma: { value: rc.chroma },
      uVigSize: { value: rc.vigSize },
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform float uStrength, uChroma, uVigSize;
      void main(){
        vec2 cc = vUv - 0.5;
        float rn = length(cc) / 0.7071;
        float k = min(uStrength, 0.62);
        float f = mix(1.0 - k, 1.0, rn * rn);            // fisheye (barril)
        float ca = pow(rn, 2.5) * uChroma * 0.07;        // aberración cromática
        float r = texture2D(tDiffuse, clamp(0.5 + cc * (f - ca), 0.0, 1.0)).r;
        float g = texture2D(tDiffuse, clamp(0.5 + cc * f,        0.0, 1.0)).g;
        float b = texture2D(tDiffuse, clamp(0.5 + cc * (f + ca), 0.0, 1.0)).b;
        vec3 col = vec3(r, g, b);
        col *= 1.0 - rn * rn * k * 0.3;                  // caída de brillo
        col *= smoothstep(uVigSize, uVigSize - 0.4, rn); // viñeta
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
  composer.addPass(lensPass)

  function resize() {
    const cw = container.clientWidth, ch = container.clientHeight
    // Por defecto llena la pantalla. El recuadro cuadrado se reserva para el
    // modo device (display redondo de 466×466).
    const side = Math.min(cw, ch)
    const w = rc.squareFrame ? side : cw
    const h = rc.squareFrame ? side : ch
    const dpr = Math.min(2, window.devicePixelRatio)
    renderer.setPixelRatio(dpr)
    renderer.setSize(w, h, false)
    composer.setPixelRatio(dpr)
    composer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    // uProj: convierte tamaño-mundo a píxeles con perspectiva correcta.
    const proj = (h * dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360))
    pointUniforms.uProj.value = proj
    hazeUniforms.uProj.value = proj
    // Las líneas gruesas necesitan la resolución para calcular su ancho.
    for (const m of fatMaterials) m.resolution.set(w * dpr, h * dpr)
    const el = renderer.domElement
    el.style.position = 'absolute'
    el.style.width = w + 'px'
    el.style.height = h + 'px'
    el.style.left = (cw - w) / 2 + 'px'
    el.style.top = (ch - h) / 2 + 'px'
  }
  resize()
  window.addEventListener('resize', resize)

  const tintC = new THREE.Color()
  const _up = new THREE.Vector3(0, 1, 0)
  const _dir = new THREE.Vector3()
  const _axis = new THREE.Vector3()
  const _q = new THREE.Quaternion()
  let _lx = 0, _ly = 0
  let clock = 0
  let snowCover = 0, wet = 0, moveScale = 1
  function update(swarm, dt, eco) {
    const step = dt || 0.016
    clock += step
    pointUniforms.uT.value = clock

    // El ecosistema pinta el mundo: luz de la hora, niebla y neblina del clima.
    if (eco) {
      const L = eco.light, g = eco.gain
      // El tinte de la hora se aplica SUAVE: a plena fuerza el verde del pasto
      // se apaga a oliva. Mantenemos el brillo, atenuamos el viraje de color.
      const k = rc.tintStrength
      tintC.setRGB(
        (1 - k + k * L[0]) * g,
        (1 - k + k * L[1]) * g,
        (1 - k + k * L[2]) * g,
      )
      if (grassMat) grassMat.color.copy(tintC)
      if (floraMat) floraMat.color.copy(tintC)
      if (groundMat) groundMat.color.copy(tintC)
      // Niebla muy leve: la isla debe leerse entera, no perderse en negro.
      scene.fog.density = 0.0009 + eco.fog * 0.0028
      // La neblina toma el color de la luz y se espesa con la niebla.
      hazeUniforms.uColor.value.set(
        rc.hazeColor[0] * 0.4 + L[0] * 0.6,
        rc.hazeColor[1] * 0.4 + L[1] * 0.6,
        rc.hazeColor[2] * 0.6 + L[2] * 0.4,
      )
      hazeUniforms.uAlpha.value = rc.hazeAlpha * (0.5 + eco.fog * 1.3) * (0.45 + g * 0.75)

      // Sombras de nubes móviles + sol.
      shadowUniforms.uTime.value = clock
      const wa = clock * 0.03
      shadowUniforms.uWind.value.set(Math.cos(wa) * 0.025, Math.sin(wa) * 0.025)
      const cloud = Math.min(1, 0.25 + eco.fog * 1.1)
      shadowUniforms.uCloud.value += (cloud - shadowUniforms.uCloud.value) * Math.min(1, step * 0.5)
      shadowUniforms.uSun.value = 0.92 + (1 - cloud) * 0.32

      // Nieve: si llueve y hace frío. Se acumula; con calor se derrite → agua.
      const cold = eco.temperature <= 1
      const snowing = cold && eco.rain > 0.2
      const snowfall = snowing ? eco.rain : 0
      snowCover += snowfall * 0.05 * step
      if (eco.temperature > 1 && snowCover > 0) {
        const melt = (eco.temperature - 1) * 0.02 * step
        snowCover -= melt
        wet = Math.min(1, wet + melt * 3.5)
      }
      snowCover = Math.max(0, Math.min(1, snowCover))
      wet = Math.max(0, wet - 0.02 * step) // evaporación lenta
      shadowUniforms.uSnow.value = snowCover
      shadowUniforms.uWet.value = wet

      updateRain(step, snowing ? 0 : eco.rain)
      updateSnow(step, clock, snowfall)

      // Los agentes se frenan con nieve/frío.
      moveScale = snowing ? 0.42 : (cold ? 0.72 : 1)
    }

    mapPositions(step)

    // Bichitos hacia las flores; cazadores hacia los bichitos.
    const predations = []
    if (bugCount) {
      updateBugs(bugs, poiFlowers, bugCfg, step * moveScale, rnd, hunters)
      for (const h of hunters) {
        const idx = nearestBug(bugs, h.x, h.z, bugCfg.huntRadius)
        if (idx < 0) continue
        const b = bugs[idx]
        const dx = b.x - h.x, dz = b.z - h.z
        const d = Math.hypot(dx, dz) || 1
        h.vx += (dx / d) * bugCfg.huntPull * step
        h.vz += (dz / d) * bugCfg.huntPull * step
        if (d < bugCfg.catchRadius) {
          b.alive = false; b.respawn = bugCfg.respawn
          const dir = Math.abs(h.hx) > Math.abs(h.hz)
            ? (h.hx > 0 ? 'right' : 'left') : (h.hz > 0 ? 'ahead' : 'behind')
          predations.push({ hunterIdx: h.aidx, dir })
        }
      }
      for (let i = 0; i < bugCount; i++) {
        const b = bugs[i]
        const wx = b.x * R, wz = b.z * R
        bugPos[i * 3] = wx
        bugPos[i * 3 + 1] = b.alive
          ? G + terrainHeight(wx, wz) + bugCfg.height + Math.sin(b.phase) * bugCfg.bob
          : -9999
        bugPos[i * 3 + 2] = wz
      }
      bugGeom.getAttribute('position').needsUpdate = true
    }

    for (let i = 0; i < n; i++) {
      const a = agents[i]
      const r = roamers[i]
      a.group.position.set(worldPos[i * 3], worldPos[i * 3 + 1], worldPos[i * 3 + 2])

      // Velocidad en unidades de mundo (los roamers están normalizados).
      const wvx = r.vx * R, wvz = r.vz * R
      const wspeed = Math.hypot(wvx, wvz)
      if (a.glide) {
        // Planeador: se orienta hacia donde va.
        if (wspeed > 0.05) a.group.rotation.y = Math.atan2(wvx, wvz)
      } else if (a.rollMul > 0 && a.cage && wspeed > 1e-4) {
        // Rueda como una esfera: eje = arriba × dirección, ángulo = dist/effR.
        _dir.set(wvx, 0, wvz).normalize()
        _axis.crossVectors(_up, _dir)
        if (_axis.lengthSq() < 1e-5) _axis.set(1, 0, 0)
        _axis.normalize()
        _q.setFromAxisAngle(_axis, (wspeed * step) / a.effR * a.rollMul)
        a.cage.quaternion.premultiply(_q)
      } else if (a.spinY) {
        a.group.rotation.y += a.spinY * step
      }

      const pulse = 1 + swarm.flash[i] * 0.35
      if (a.cage) a.cage.scale.setScalar(pulse)
      else a.group.scale.setScalar(a.baseScale * pulse)
    }

    // Etiqueta: el agente visible más cercano al centro de pantalla.
    let bestI = -1, bestD = 0.16
    for (let i = 0; i < n; i++) {
      _proj.set(worldPos[i * 3], worldPos[i * 3 + 1] + 4, worldPos[i * 3 + 2]).project(camera)
      if (_proj.z > 1) continue // detrás de la cámara
      const d = Math.hypot(_proj.x, _proj.y)
      if (d < bestD) { bestD = d; bestI = i; _lx = _proj.x; _ly = _proj.y }
    }
    if (bestI >= 0 && agentNames[bestI]) {
      const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight
      const ox = parseFloat(renderer.domElement.style.left) || 0
      const oy = parseFloat(renderer.domElement.style.top) || 0
      label.style.left = ox + (_lx * 0.5 + 0.5) * w + 'px'
      label.style.top = oy + (-_ly * 0.5 + 0.5) * h + 'px'
      label.textContent = agentNames[bestI]
      label.style.opacity = '1'
    } else {
      label.style.opacity = '0'
    }

    // Estelas: siembra espaciada y desvanecido lento → puntos separados, no manchones.
    for (let k = 0; k < n * TRAIL; k++) tSize[k] *= 0.997
    if (tFrame % 7 === 0) {
      for (let i = 0; i < n; i++) {
        const slot = (i * TRAIL + tHead) * 3
        tPos[slot] = worldPos[i * 3]
        tPos[slot + 1] = worldPos[i * 3 + 1] - 1.2
        tPos[slot + 2] = worldPos[i * 3 + 2]
        tSize[i * TRAIL + tHead] = rc.trailSize * 0.13
      }
      tHead = (tHead + 1) % TRAIL
    }
    tFrame++
    trailGeom.getAttribute('position').needsUpdate = true
    trailGeom.getAttribute('hsize').needsUpdate = true

    // Relámpago: el overlay se apaga rápido tras el destello.
    if (flashV > 0.001) { flashV = Math.max(0, flashV - step * 4.5); flashEl.style.opacity = flashV }

    // Respiración: velocidad de giro que pulsa + leve vaivén del mundo.
    controls.autoRotateSpeed = 0.3 + Math.sin(clock * 0.18) * 0.16
    controls.target.y = Math.sin(clock * 0.13) * 1.7
    controls.update()
    composer.render()
    return predations
  }

  function flash(v) { flashV = Math.min(1, v) }
  return { update, resize, renderer, camera, controls, flash }
}
