import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { PALETTE } from '../config.js'
import { noise2, fbm } from './noise.js'

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
/** 1 en el centro, 0 fuera de la isla; borde irregular. */
function islandMask(x, z, R) {
  const r = Math.hypot(x, z)
  const wobble = (noise2(x * 0.03, z * 0.03) - 0.5) * 0.22
  const t = 1 - r / (R * (1 + wobble))
  return Math.max(0, Math.min(1, t * 2.4))
}

// Gradiente del pasto por fertilidad: verde oliva → verde brillante.
function grassColor(f, out) {
  const t = Math.max(0, Math.min(1, f))
  out[0] = 0.18 + 0.30 * t
  out[1] = 0.42 + 0.48 * t
  out[2] = 0.10 + 0.22 * t
}

export function createScene(container, cfg) {
  const R = cfg.world.radius
  const G = cfg.world.groundY
  const rc = cfg.render

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)

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
      const k = mask
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
    scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true })))
  }

  // ─── FLORES: tallo curvo de 2 segmentos + 1 cabeza o racimo de 2–4 ────────
  const STEM_LO = [0.16, 0.22, 0.10]
  const STEM_MID = [0.26, 0.34, 0.16]
  const STEM_HI = [0.38, 0.46, 0.24]
  const FLOWER_COLS = [
    [1.0, 0.48, 0.09], [1.0, 0.37, 0.69], [0.93, 0.95, 1.0],
    [1.0, 0.88, 0.10], [0.95, 0.30, 0.30], [1.0, 0.69, 0.35],
  ]

  function flower(x, y, z, scale) {
    const h = (3 + rnd() * 3.6) * scale
    const a = rnd() * 6.2832
    const c = (0.5 + rnd() * 1.3) * scale
    const lx = Math.cos(a) * c, lz = Math.sin(a) * c
    const mx = x + lx * 0.32, my = y + h * 0.55, mz = z + lz * 0.32
    const tx = x + lx, ty = y + h, tz = z + lz
    pushLine(x, y, z, mx, my, mz, STEM_LO, STEM_MID)
    pushLine(mx, my, mz, tx, ty, tz, STEM_MID, STEM_HI)
    const col = FLOWER_COLS[(rnd() * FLOWER_COLS.length) | 0]
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
      flower(fx, G + terrainHeight(fx, fz), fz, 0.6 + rnd() * 0.75)
    }
  }

  // ─── ÁRBOLES SECOS: ramas curvas recursivas (líneas) ──────────────────────
  const BARK_LO = [0.30, 0.29, 0.27]
  const BARK_HI = [0.72, 0.71, 0.66]
  function branch(x, y, z, dx, dy, dz, len, depth) {
    const ex = x + dx * len, ey = y + dy * len, ez = z + dz * len
    const t = depth / 5
    const c1 = [BARK_LO[0] + t * 0.3, BARK_LO[1] + t * 0.3, BARK_LO[2] + t * 0.3]
    pushLine(x, y, z, ex, ey, ez, c1, BARK_HI)
    if (depth <= 0) return
    const k = rnd() < 0.65 ? 2 : 3
    for (let i = 0; i < k; i++) {
      const nx = dx + (rnd() - 0.5) * 0.9
      const ny = dy + (rnd() - 0.2) * 0.35
      const nz = dz + (rnd() - 0.5) * 0.9
      const m = Math.hypot(nx, ny, nz) || 1
      branch(ex, ey, ez, nx / m, ny / m, nz / m, len * (0.62 + rnd() * 0.18), depth - 1)
    }
  }
  for (let t = 0; t < 7; t++) {
    const tr = R * (0.15 + 0.7 * rnd())
    const ta = rnd() * 6.2832
    const tx = Math.cos(ta) * tr, tz = Math.sin(ta) * tr
    if (islandMask(tx, tz, R) < 0.35) continue
    branch(tx, G + terrainHeight(tx, tz), tz, 0, 1, 0, 3.4 + rnd() * 1.8, 4)
  }

  // ─── ROCAS: nubes de puntos reales (no dither) ────────────────────────────
  const ROCK = [0.30, 0.19, 0.16]
  for (let i = 0; i < 4; i++) {
    const rr = R * (0.15 + 0.6 * rnd())
    const ra = rnd() * 6.2832
    const cx = Math.cos(ra) * rr, cz = Math.sin(ra) * rr
    if (islandMask(cx, cz, R) < 0.4) continue
    const cy = G + terrainHeight(cx, cz)
    const size = 2.4 + rnd() * 3
    for (let k = 0; k < 600; k++) {
      const u = rnd() * 6.2832, v = Math.acos(2 * rnd() - 1)
      const rr2 = size * Math.cbrt(rnd())
      const sx = cx + Math.sin(v) * Math.cos(u) * rr2
      const sy = cy + Math.abs(Math.cos(v)) * rr2 * 0.6
      const sz = cz + Math.sin(v) * Math.sin(u) * rr2
      const sh = 0.75 + 0.45 * rnd()
      pushPoint(sx, sy, sz, [ROCK[0] * sh, ROCK[1] * sh, ROCK[2] * sh], 0.28 + rnd() * 0.28, 0)
    }
  }

  // ─── Polvo del borde de la isla ───────────────────────────────────────────
  for (let i = 0; i < cfg.world.dustCount; i++) {
    const a = rnd() * 6.2832
    const rr = R * (0.95 + Math.pow(rnd(), 0.85) * 0.32)
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr
    const fade = Math.max(0.08, 1 - (rr - R) / (R * 0.3))
    const s = (0.25 + rnd() * 0.75) * fade
    pushPoint(x, G + terrainHeight(x, z) + rnd() * 0.8, z,
      [0.03 * s + 0.015, 0.15 * s + 0.025, 0.17 * s + 0.035], 0.15 + rnd() * 0.3, 0)
  }

  // ─── Subir buffers ────────────────────────────────────────────────────────
  {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePos), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(lineCol), 3))
    scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true })))
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
  const hazeUniforms = { uProj: { value: 1000 } }
  {
    const pos = [], siz = []
    for (let i = 0; i < rc.hazeCount; i++) {
      const a = rnd() * 6.2832
      const rr = Math.sqrt(rnd()) * R * 1.28
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr
      pos.push(x, G + 0.3 + rnd() * 12, z)
      siz.push(3 + rnd() * 6.2)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('hsize', new THREE.BufferAttribute(new Float32Array(siz), 1))
    const c = rc.hazeColor
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
        void main() {
          vec2 uv = gl_PointCoord - 0.5; float d2 = dot(uv, uv);
          if (d2 > 0.25) discard;
          float a = 1.0 - sqrt(d2) * 2.0; a = a * a * ${rc.hazeAlpha.toFixed(3)};
          gl_FragColor = vec4(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)}, 1.0) * a;
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
  const B = cfg.fireflies.bounds
  const worldPos = new Float32Array(n * 3)
  function mapPositions(swarm) {
    const p = swarm.pos
    const sx = (R * 0.72) / B.x
    const sz = (R * 0.72) / B.z
    for (let i = 0; i < n; i++) {
      const x = p[i * 3] * sx
      const z = p[i * 3 + 2] * sz
      worldPos[i * 3] = x
      worldPos[i * 3 + 1] = G + terrainHeight(x, z) + 3 + (p[i * 3 + 1] + B.y) * 0.42
      worldPos[i * 3 + 2] = z
    }
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

  let clock = 0
  function update(swarm, dt) {
    clock += dt || 0.016
    pointUniforms.uT.value = clock
    mapPositions(swarm)

    for (let i = 0; i < n; i++) {
      const a = agents[i]
      a.group.position.set(worldPos[i * 3], worldPos[i * 3 + 1], worldPos[i * 3 + 2])
      a.cage.rotation.y += dt * 0.5
      a.cage.rotation.x += dt * 0.18
      const pulse = 1 + swarm.flash[i] * 0.5
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
