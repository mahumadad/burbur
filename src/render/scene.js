import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { PALETTE } from '../config.js'
import { noise2, fbm } from './noise.js'
import { createPaths, createWalkers, updateWalkers } from '../sim/paths.js'

// El mundo se construye SOLO con LineSegments (color por vértice) y Points (shader propio).
// Sin mallas de vegetación, sin texturas, sin bloom: el brillo sale del blending aditivo.

const rnd = Math.random

// ─── Campos del terreno ──────────────────────────────────────────────────────
function terrainHeight(x, z) {
  return (fbm(x * 0.012 + 7, z * 0.012 + 3, 3) - 0.5) * 9
}
function fertility(x, z) {
  return fbm(x * 0.02 + 19, z * 0.02 + 41, 2)
}
/** 1 en el centro, 0 fuera de la isla; borde irregular y con caída larga a negro. */
function islandMask(x, z, R) {
  const r = Math.hypot(x, z)
  const wobble = (noise2(x * 0.03, z * 0.03) - 0.5) * 0.22
  const t = 1 - r / (R * (1 + wobble))
  // Caída suave (no lineal) → el horizonte se disuelve en el negro.
  const m = Math.max(0, Math.min(1, t * 1.5))
  return m * m * (3 - 2 * m)
}

/**
 * Pozos de luz: manchas iluminadas y zonas en sombra, como si un foco irregular
 * cayera sobre el claro. Se hornea en el color: persiste incluso de noche.
 */
function lightPool(x, z) {
  const a = fbm(x * 0.026 + 11, z * 0.026 + 29, 2)
  const b = noise2(x * 0.011 + 61, z * 0.011 + 7)
  const v = a * 0.62 + b * 0.38
  // Rango amplio: zonas casi en sombra y pozos claramente iluminados.
  return 0.34 + 1.75 * Math.pow(Math.max(0, v), 2.0)
}

// Gradiente del pasto por fertilidad: verde oliva → verde brillante.
function grassColor(f, out) {
  const t = Math.max(0, Math.min(1, f))
  out[0] = 0.24 + 0.38 * t
  out[1] = 0.58 + 0.62 * t
  out[2] = 0.13 + 0.27 * t
}

export function createScene(container, cfg) {
  const R = cfg.world.radius
  const G = cfg.world.groundY
  const rc = cfg.render

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)
  // Niebla negra: la distancia se funde en la oscuridad. La densidad la fija el clima.
  scene.fog = new THREE.FogExp2(0x000000, 0.004)
  let grassMat, floraMat

  const fov = 50 + rc.fisheye * 72 // 93°
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.5, 900)
  // Órbita esférica inicial (r=118, theta=0.62, phi=0.92) — vista aérea 3/4.
  const orbR = 96, th = 0.62, ph = 0.86
  camera.position.set(
    orbR * Math.sin(ph) * Math.cos(th),
    orbR * Math.cos(ph),
    orbR * Math.sin(ph) * Math.sin(th),
  )
  camera.lookAt(0, 0, 0)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setClearColor(0x000000, 1)
  container.appendChild(renderer.domElement)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 0, 0)
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.minDistance = 40
  controls.maxDistance = 260
  controls.maxPolarAngle = Math.PI * 0.49 // no bajar del horizonte
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.25
  controls.addEventListener('start', () => { controls.autoRotate = false })

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
      const k = mask * lightPool(x, z)
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

  function flower(x, y, z, scale, lit = 1) {
    const h = (3 + rnd() * 3.6) * scale
    const a = rnd() * 6.2832
    const c = (0.5 + rnd() * 1.3) * scale
    const lx = Math.cos(a) * c, lz = Math.sin(a) * c
    const mx = x + lx * 0.32, my = y + h * 0.55, mz = z + lz * 0.32
    const tx = x + lx, ty = y + h, tz = z + lz
    pushLine(x, y, z, mx, my, mz, STEM_LO, STEM_MID)
    pushLine(mx, my, mz, tx, ty, tz, STEM_MID, STEM_HI)
    const src = FLOWER_COLS[(rnd() * FLOWER_COLS.length) | 0]
    const col = [src[0] * lit, src[1] * lit, src[2] * lit]
    if (rnd() < 0.42) {
      const k = 2 + ((rnd() * 3) | 0)
      for (let i = 0; i < k; i++) {
        const b = rnd() * 6.2832
        const xr = (0.5 + rnd() * 1.2) * scale
        const yr = (0.3 + rnd() * 1.0) * scale
        const cx = tx + Math.cos(b) * xr, cy = ty + yr, cz = tz + Math.sin(b) * xr
        pushLine(tx, ty, tz, cx, cy, cz, STEM_MID, STEM_HI)
        pushPoint(cx, cy, cz, col, (0.20 + rnd() * 0.22) * scale, rnd())
      }
    } else {
      pushPoint(tx, ty + 0.1 * scale, tz, col, (0.26 + rnd() * 0.28) * scale, rnd())
    }
  }

  // Sembrado en parches (no uniforme).
  for (let p = 0; p < rc.flowerPatches; p++) {
    const pr = R * (0.12 + 0.82 * rnd())
    const pa = rnd() * 6.2832
    const px = Math.cos(pa) * pr, pz = Math.sin(pa) * pr
    if (islandMask(px, pz, R) < 0.25) continue
    const k = 6 + ((rnd() * 11) | 0)
    const spread = 2.5 + rnd() * 3.5
    for (let i = 0; i < k; i++) {
      const b = rnd() * 6.2832
      const d = spread * Math.sqrt(rnd()) * (1 + rnd() * 0.6)
      const fx = px + Math.cos(b) * d, fz = pz + Math.sin(b) * d
      if (islandMask(fx, fz, R) < 0.1) continue
      flower(fx, G + terrainHeight(fx, fz), fz, 0.6 + rnd() * 0.75,
        Math.min(1.3, lightPool(fx, fz)))
    }
  }

  // ─── ÁRBOLES SECOS: ramas curvas recursivas (líneas) ──────────────────────
  const BARK_LO = [0.26, 0.25, 0.23]
  const BARK_HI = [0.86, 0.85, 0.80]

  /**
   * Rama con grosor: en vez de una línea, un haz de N líneas paralelas que se
   * estrecha con la profundidad. Además curva (varios tramos) y siembra puntos
   * de corteza. Eso le da estructura de árbol y no de brizna.
   */
  function branch(x, y, z, dx, dy, dz, len, depth, thick, lit) {
    const SEGS = 4
    let cx = x, cy = y, cz = z
    let vx = dx, vy = dy, vz = dz
    const t0 = depth / 5
    const c1 = [
      BARK_LO[0] + t0 * 0.34, BARK_LO[1] + t0 * 0.34, BARK_LO[2] + t0 * 0.32,
    ]
    for (let s = 0; s < SEGS; s++) {
      // Curvar poco a poco (gravedad + deriva) → ramas orgánicas, no rectas.
      vx += (rnd() - 0.5) * 0.16
      vy -= 0.05 * (1 - depth / 5)
      vz += (rnd() - 0.5) * 0.16
      const m = Math.hypot(vx, vy, vz) || 1
      vx /= m; vy /= m; vz /= m
      const sl = len / SEGS
      const ex = cx + vx * sl, ey = cy + vy * sl, ez = cz + vz * sl
      // Haz de líneas → grosor visible.
      const strands = Math.max(1, Math.round(thick))
      for (let k = 0; k < strands; k++) {
        const ox = strands === 1 ? 0 : (rnd() - 0.5) * thick * 0.075
        const oz = strands === 1 ? 0 : (rnd() - 0.5) * thick * 0.075
        pushLine(cx + ox, cy, cz + oz, ex + ox, ey, ez + oz, c1, BARK_HI)
      }
      // Puntos de corteza: pocos y apagados, solo para dar textura.
      const dots = Math.round(thick * 0.5)
      for (let k = 0; k < dots; k++) {
        const f = rnd()
        const sh = (0.30 + 0.28 * rnd()) * lit
        pushPoint(
          cx + (ex - cx) * f + (rnd() - 0.5) * thick * 0.07,
          cy + (ey - cy) * f,
          cz + (ez - cz) * f + (rnd() - 0.5) * thick * 0.07,
          [BARK_HI[0] * sh, BARK_HI[1] * sh, BARK_HI[2] * sh],
          0.07 + rnd() * 0.06, 0,
        )
      }
      cx = ex; cy = ey; cz = ez
    }
    if (depth <= 0) return
    const k = depth > 3 ? 2 : (rnd() < 0.6 ? 2 : 3)
    for (let i = 0; i < k; i++) {
      const nx = vx + (rnd() - 0.5) * 1.15
      const ny = vy + (rnd() - 0.25) * 0.5
      const nz = vz + (rnd() - 0.5) * 1.15
      const m = Math.hypot(nx, ny, nz) || 1
      branch(cx, cy, cz, nx / m, ny / m, nz / m,
        len * (0.66 + rnd() * 0.16), depth - 1, thick * 0.56, lit)
    }
  }

  for (let t = 0; t < 9; t++) {
    const tr = R * (0.12 + 0.72 * rnd())
    const ta = rnd() * 6.2832
    const tx = Math.cos(ta) * tr, tz = Math.sin(ta) * tr
    if (islandMask(tx, tz, R) < 0.35) continue
    const lit = Math.min(1.25, lightPool(tx, tz))
    branch(tx, G + terrainHeight(tx, tz) - 0.4, tz, 0, 1, 0,
      3.2 + rnd() * 1.8, 5, 4 + rnd() * 2, lit)
  }

  // ─── ROCAS: nubes de puntos reales (no dither) ────────────────────────────
  const ROCK = [0.44, 0.31, 0.27]
  const rockSpots = []
  for (let i = 0; i < 14; i++) {
    const rr = R * (0.10 + 0.72 * rnd())
    const ra = rnd() * 6.2832
    const cx = Math.cos(ra) * rr, cz = Math.sin(ra) * rr
    if (islandMask(cx, cz, R) < 0.4) continue
    const cy = G + terrainHeight(cx, cz)
    const size = 1.8 + rnd() * 4.2
    const lit = Math.min(1.3, lightPool(cx, cz))
    rockSpots.push({ x: cx, z: cz, r: size })
    const dens = Math.round(340 + size * 160)
    for (let k = 0; k < dens; k++) {
      const u = rnd() * 6.2832, v = Math.acos(2 * rnd() - 1)
      const rr2 = size * Math.cbrt(rnd())
      const sx = cx + Math.sin(v) * Math.cos(u) * rr2
      const sy = cy + Math.abs(Math.cos(v)) * rr2 * 0.55
      const sz = cz + Math.sin(v) * Math.sin(u) * rr2
      const sh = (0.68 + 0.5 * rnd()) * lit
      pushPoint(sx, sy, sz, [ROCK[0] * sh, ROCK[1] * sh, ROCK[2] * sh], 0.26 + rnd() * 0.26, 0)
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
        float worldR = hsize + uAperture * coc * 0.06;
        gl_PointSize = clamp(worldR * uProj / vd, 1.0, 64.0);
        vSoft = clamp(coc / (uFocus * 0.7), 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision mediump float;
      varying vec3 vC; varying float vSoft;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv) * 2.0;
        if (d > 1.0) discard;
        float edge = mix(0.10, 0.85, vSoft);    // borde blando si está fuera de foco
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
  const AGENT_COLORS = [
    PALETTE.cyan, PALETTE.magenta, PALETTE.yellow,
    PALETTE.white, PALETTE.blue, PALETTE.pink,
  ]
  function edgesOf(geometry, color) {
    const e = new THREE.EdgesGeometry(geometry)
    geometry.dispose()
    return new THREE.LineSegments(e, new THREE.LineBasicMaterial({ color }))
  }
  function ringLoop(radius, segments, color) {
    const pts = []
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius))
    }
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color }))
  }
  /** Criatura interna: esferitas unidas por enlaces al centro. */
  function molecule(scale, color) {
    const g = new THREE.Group()
    const seg = []
    const k = 3 + ((rnd() * 3) | 0)
    for (let i = 0; i < k; i++) {
      const p = new THREE.Vector3(
        (rnd() - 0.5) * 2.2 * scale,
        (rnd() - 0.5) * 1.6 * scale,
        (rnd() - 0.5) * 2.2 * scale,
      )
      const s = new THREE.Mesh(
        new THREE.SphereGeometry((0.3 + rnd() * 0.12) * scale, 8, 6),
        new THREE.MeshBasicMaterial({ color }),
      )
      s.position.copy(p)
      g.add(s)
      seg.push(0, 0, 0, p.x, p.y, p.z)
    }
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(seg), 3))
    g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: PALETTE.bond })))
    return g
  }

  const n = cfg.fireflies.count
  const agents = []
  for (let i = 0; i < n; i++) {
    const color = AGENT_COLORS[i % AGENT_COLORS.length]
    const group = new THREE.Group()
    const cage = new THREE.Group()
    const kind = i % 4
    if (kind === 0) cage.add(edgesOf(new THREE.BoxGeometry(4.6, 4.6, 4.6), color))
    else if (kind === 1) cage.add(edgesOf(new THREE.OctahedronGeometry(3.1), color))
    else if (kind === 2) cage.add(edgesOf(new THREE.TetrahedronGeometry(3.4), color))
    else cage.add(ringLoop(2.7, 34, color))
    group.add(cage)
    group.add(molecule(0.8, PALETTE.orange))
    // Tallo al suelo + bolita superior (la firma visual de murmur)
    if (kind === 3 || kind === 1) {
      const sg = new THREE.BufferGeometry()
      sg.setAttribute('position', new THREE.BufferAttribute(
        new Float32Array([0, 0, 0, 0, 2.6, 0]), 3))
      group.add(new THREE.LineSegments(sg,
        new THREE.LineBasicMaterial({ color: PALETTE.magenta })))
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8),
        new THREE.MeshBasicMaterial({ color: PALETTE.white }))
      ball.position.set(0, 2.6, 0)
      group.add(ball)
    }
    scene.add(group)
    agents.push({ group, cage, kind })
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

  // ─── Mapeo simulación → mundo ─────────────────────────────────────────────
  // Los agentes recorren los senderos; la altura la da el terreno.
  const walkers = createWalkers(paths, n, rnd)
  const worldPos = new Float32Array(n * 3)
  function mapPositions(dt) {
    updateWalkers(walkers, paths, dt)
    for (let i = 0; i < n; i++) {
      const w = walkers[i]
      const x = w.x * R, z = w.z * R
      worldPos[i * 3] = x
      worldPos[i * 3 + 1] = G + terrainHeight(x, z) + 3.1
      worldPos[i * 3 + 2] = z
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
    const side = Math.min(container.clientWidth, container.clientHeight)
    const dpr = Math.min(2, window.devicePixelRatio)
    renderer.setPixelRatio(dpr)
    renderer.setSize(side, side, false)
    composer.setPixelRatio(dpr)
    composer.setSize(side, side)
    camera.aspect = 1
    camera.updateProjectionMatrix()
    // uProj: convierte tamaño-mundo a píxeles con perspectiva correcta.
    const proj = (side * dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360))
    pointUniforms.uProj.value = proj
    hazeUniforms.uProj.value = proj
    const el = renderer.domElement
    el.style.position = 'absolute'
    el.style.width = side + 'px'
    el.style.height = side + 'px'
    el.style.left = (container.clientWidth - side) / 2 + 'px'
    el.style.top = (container.clientHeight - side) / 2 + 'px'
  }
  resize()
  window.addEventListener('resize', resize)

  const tintC = new THREE.Color()
  let clock = 0
  function update(swarm, dt, eco) {
    clock += dt || 0.016
    pointUniforms.uT.value = clock

    // El ecosistema pinta el mundo: luz de la hora, niebla y neblina del clima.
    if (eco) {
      const L = eco.light, g = eco.gain
      tintC.setRGB(L[0] * g, L[1] * g, L[2] * g)
      if (grassMat) grassMat.color.copy(tintC)
      if (floraMat) floraMat.color.copy(tintC)
      scene.fog.density = 0.003 + eco.fog * 0.012
      // La neblina toma el color de la luz y se espesa con la niebla.
      hazeUniforms.uColor.value.set(
        rc.hazeColor[0] * 0.4 + L[0] * 0.6,
        rc.hazeColor[1] * 0.4 + L[1] * 0.6,
        rc.hazeColor[2] * 0.6 + L[2] * 0.4,
      )
      hazeUniforms.uAlpha.value = rc.hazeAlpha * (0.5 + eco.fog * 1.3) * (0.45 + g * 0.75)
      updateRain(dt || 0.016, eco.rain)
    }

    mapPositions(dt || 0.016)

    for (let i = 0; i < n; i++) {
      const a = agents[i]
      const w = walkers[i]
      a.group.position.set(worldPos[i * 3], worldPos[i * 3 + 1], worldPos[i * 3 + 2])
      // Erguido y orientado al rumbo: nada de tumbos que deformen la silueta.
      a.group.rotation.y = Math.atan2(w.hx, w.hz)
      a.cage.rotation.y += dt * 0.22
      const pulse = 1 + swarm.flash[i] * 0.35
      a.cage.scale.setScalar(pulse)
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

    controls.update()
    composer.render()
  }

  return { update, resize, renderer, camera, controls }
}
