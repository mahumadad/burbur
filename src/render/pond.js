import * as THREE from 'three'
import { createStage } from './stage.js'
import { createDraw } from './engine/points.js'
import { createHaze } from './engine/haze.js'
import { noise2, fbm } from './noise.js'

// Mundo AGUA (pond). Calca el mundo de agua de murmur.living: ISLAS de arena
// (elipsoides que suben del lecho) flotando en un campo de AGUA azul brillante
// sobre fondo negro, con juncos dispersos en la línea de agua, niebla azul y
// polvo de borde. Mapeo exacto del bundle en
// `docs/superpowers/specs/2026-08-11-pond-visual-map.md`.
//
// Paridad (spec §4): mt=64, ht=-3.4, gt=11, G=85. Valores en `cfg.pond`.
export function createPond(container, cfg, _agentNames = []) {
  const rc = cfg.render
  const P = cfg.pond
  const R = cfg.world.radius            // 85 (G)
  const G = cfg.world.groundY           // 0
  const mt = P.lagoonRadius             // 64
  const ht = G + P.waterLevel           // -3.4
  const gt = P.lobeDepth                // 11
  const bedY = ht - gt                  // -14.4

  const stage = createStage(container, cfg)
  const { scene } = stage
  const draw = createDraw(rc)
  const { pushPoint, pushLine, uniforms: pointUniforms } = draw
  const q = Math.random

  // Paletas EXACTAS del bundle.
  const Y = [0.004, 0.01, 0.028]        // agua base (casi negro)
  const Mt = [0.02, 0.07, 0.23]         // azul profundo
  const Nt = [0.115, 0.38, 1.0]         // azul eléctrico (glow)
  const SAND_LO = [0.66, 0.43, 0.415]   // arcilla (jt)
  const SAND_HI = [0.935, 0.72, 0.635]  // arena clara (J)
  const RIM = [0.07, 0.68, 0.62]        // brillo cian de borde (Et)
  const clamp01 = (v) => Math.max(0, Math.min(1, v))
  const smooth = (t) => { const c = clamp01(t); return c * c * (3 - 2 * c) }

  // ─── LÓBULOS (islas): 2–5 elipsoides clusterizados + 1–3 exteriores ───────
  const lobes = []
  {
    const N = 2 + (q() * 3.5 | 0)
    const main = []
    for (let n = 0; n < N; n++) {
      const r = n === 0 ? 18 + q() * 4 : 10 + q() * 7
      const L = {
        rx: r, rz: r * (0.68 + q() * 0.42),
        ry: r * ((n === 0 ? 1.12 : 1.18) + q() * (n === 0 ? 0.22 : 0.26)),
        yaw: q() * 6.2832, cy: bedY,
      }
      let placed = false
      for (let o = 0; !placed && o < 10; o++) {
        if (n === 0) { const s = q() * 6.2832, c = 6 + q() * 8; L.x = Math.cos(s) * c; L.z = Math.sin(s) * c; placed = true }
        else {
          const l = main[q() * main.length | 0], u = q() * 6.2832
          const d = (Math.max(l.rx, l.rz) + Math.max(L.rx, L.rz)) * (0.55 + Math.pow(q(), 1.4) * 0.8)
          L.x = l.x + Math.cos(u) * d; L.z = l.z + Math.sin(u) * d
          placed = Math.hypot(L.x, L.z) < mt * 0.62
        }
      }
      if (placed) { L.c = Math.cos(L.yaw); L.s = Math.sin(L.yaw); lobes.push(L); main.push(L) }
    }
    const F = +(q() < 0.8) + (q() * 2.6 | 0)
    for (let m = 0; m < F; m++) {
      const h = q() * 6.2832, g = 4 + q() * 5
      const L = {
        x: Math.cos(h) * (25 + q() * 13), z: Math.sin(h) * (25 + q() * 13),
        rx: g, rz: g * (0.72 + q() * 0.38), ry: g * (1 + q() * 0.6), yaw: q() * 6.2832, cy: bedY,
      }
      let ok = true
      for (const b of lobes) { if (Math.hypot(L.x - b.x, L.z - b.z) < (Math.max(b.rx, b.rz) + g) * 0.9) { ok = false; break } }
      if (ok) { L.c = Math.cos(L.yaw); L.s = Math.sin(L.yaw); lobes.push(L) }
    }
  }

  // ─── Campos escalares derivados de los lóbulos ────────────────────────────
  function lobeQ(L, x, z) {
    const dx = x - L.x, dz = z - L.z
    const lx = dx * L.c + dz * L.s, lz = -dx * L.s + dz * L.c
    return Math.hypot(lx / L.rx, lz / L.rz) // <1 dentro de la huella
  }
  function kt(x, z) { let m = 0; for (const L of lobes) m = Math.max(m, 1 - Math.min(1, lobeQ(L, x, z))); return m }
  function wt(x, z) { let m = 0; for (const L of lobes) m = Math.max(m, smooth((1.5 - lobeQ(L, x, z)) / 1.2)); return m }
  function edgeMask(x, z) { // rim en la línea de agua (q≈1)
    let m = 0; for (const L of lobes) m = Math.max(m, clamp01(1 - Math.abs(lobeQ(L, x, z) - 0.96) / 0.28)); return m
  }
  function lobeTop(x, z) { // altura de la superficie de isla (max lóbulos)
    let top = -Infinity
    for (const L of lobes) { const t = lobeQ(L, x, z); if (t < 1) { const h = L.cy + L.ry * Math.sqrt(1 - t * t); if (h > top) top = h } }
    return top
  }
  const xtField = (x, z) => mt * (0.86 + (fbm(x * 0.02 + 7, z * 0.02 + 3, 3) - 0.5) * 0.6)

  // Color del agua/lecho por vértice (fórmula del bundle).
  function fieldColor(x, z, out, half, rim) {
    const l = Math.hypot(x, z), u = xtField(x, z)
    const f = 1 - smooth(clamp01((l - u * 0.3) / (u * 0.95)))
    const p = wt(x, z) * 2.2 * (0.5 + 0.85 * fbm(x * 0.035 + 31, z * 0.035 - 12, 3))
    const m = (1 - 0.62 * kt(x, z)) * (half ? 0.5 : 1)
    const eb = rim ? edgeMask(x, z) * edgeMask(x, z) : 0
    for (let i = 0; i < 3; i++) {
      out[i] = Math.min((Y[i] + (Mt[i] * 1.5 - Y[i]) * f + Nt[i] * p * f) * m + RIM[i] * eb, 1)
    }
  }

  const snowMats = []

  // Rama seca: tronco corto + ramitas que se abren, color hueso.
  const BONE = [0.85, 0.85, 0.76]
  function driftwood(x, y, z) {
    const th = 2.5 + q() * 3
    const tilt = 0.15 + q() * 0.35, az = q() * 6.2832
    const tx = x + Math.sin(tilt) * Math.cos(az) * th * 0.5
    const ty = y + Math.cos(tilt) * th
    const tz = z + Math.sin(tilt) * Math.sin(az) * th * 0.5
    pushLine(x, y, z, tx, ty, tz, BONE, BONE)
    const k = 2 + (q() * 3 | 0)
    for (let i = 0; i < k; i++) {
      const f = 0.4 + q() * 0.5
      const bx = x + (tx - x) * f, by = y + (ty - y) * f, bz = z + (tz - z) * f
      const e = th * (0.3 + q() * 0.4), a2 = q() * 6.2832, o2 = 0.5 + q() * 0.7
      pushLine(bx, by, bz, bx + Math.sin(o2) * Math.cos(a2) * e, by + Math.cos(o2) * e, bz + Math.sin(o2) * Math.sin(a2) * e, BONE, BONE)
    }
  }

  // ─── LECHO (Rt): malla honda con rim cian ─────────────────────────────────
  {
    const geo = new THREE.PlaneGeometry(R * 2.4, R * 2.4, 110, 110)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    const cols = new Float32Array(pos.count * 3)
    const c = [0, 0, 0]
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      pos.setY(i, bedY + (fbm(x * 0.06 + 3, z * 0.06 - 8, 2) - 0.5) * 1.3)
      fieldColor(x, z, c, true, true)
      cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2]
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    const bedMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true })
    snowMats.push(bedMat)
    scene.add(new THREE.Mesh(geo, bedMat))
  }

  // Piedras del lecho: 26–42, tres tonos.
  {
    const STONE = [[0.55, 0.45, 0.12], [0.55, 0.58, 0.62], [0.06, 0.12, 0.45]]
    const k = 26 + (q() * 16 | 0)
    for (let v = 0, guard = 0; v < k && guard++ < k * 5; ) {
      const b = q() * 6.2832, rr = Math.sqrt(q()) * mt
      const x = Math.cos(b) * rr, z = Math.sin(b) * rr
      if (wt(x, z) < 0.12 || lobeTop(x, z) > ht - gt + 1.2) continue
      const col = STONE[q() * 3 | 0]
      pushPoint(x, bedY + (fbm(x * 0.06 + 3, z * 0.06 - 8, 2) - 0.5) * 1.3 + 0.2, z, col, 0.3 + q() * 0.5, 0)
      v++
    }
  }

  // ─── AGUA (zt): plano semitransparente con glow azul ──────────────────────
  {
    const geo = new THREE.PlaneGeometry(R * 2.4, R * 2.4, 150, 150)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    const cols = new Float32Array(pos.count * 3)
    const c = [0, 0, 0]
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      pos.setY(i, ht - 0.12)
      fieldColor(x, z, c, false, false)
      cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2]
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    const waterMat = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.58, depthWrite: false, fog: false,
    })
    const water = new THREE.Mesh(geo, waterMat)
    water.renderOrder = 0
    scene.add(water)
  }

  // ─── ISLAS (It): elipsoide de icosfera deformada + arena + espuma + ramas ──
  for (const L of lobes) {
    const geo = new THREE.IcosahedronGeometry(1, 3)
    const pos = geo.attributes.position
    const seed = q() * 100
    for (let i = 0; i < pos.count; i++) {
      const a = pos.getX(i), o = pos.getY(i), s = pos.getZ(i)
      const d = 1 + (fbm(a * 1.5 + o * 1.1 + seed, s * 1.5 - o * 0.9 + seed * 0.6, 3) - 0.5) * 0.55
        + (noise2(a * 0.7 + seed, s * 0.7 + o * 0.6) - 0.5) * 0.2
      let px = a * d * L.rx, py = o * d * L.ry, pz = s * d * L.rz
      py += (fbm(a * 1.1 + seed, s * 1.1 - seed, 2) - 0.5) * L.ry * 0.38 * Math.max(0, o)
      pos.setXYZ(i, px * L.c - pz * L.s, py, px * L.s + pz * L.c)
    }
    geo.computeVertexNormals()
    const nrm = geo.attributes.normal
    const cols = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const wy = pos.getY(i) + L.cy
      const S = smooth((wy - (ht - 1.2)) / 1.6) // 0 bajo agua → 1 arena
      const b = clamp01(0.24 + clamp01((wy - bedY) / (gt - 0.5)) * 0.5 + (nrm.getY(i) * 0.5 + 0.5) * 0.2
        + (fbm(pos.getX(i) * 0.22 + seed, pos.getZ(i) * 0.22, 3) - 0.5) * 0.3)
      const C = clamp01((wy - bedY) / (gt - 0.5)), w2 = (1 - C) * (1 - C)
      const under = [0.018 + 0.037 * w2, 0.032 + 0.098 * w2, 0.2 + 0.22 * w2]
      for (let k = 0; k < 3; k++) {
        const sand = SAND_LO[k] + (SAND_HI[k] - SAND_LO[k]) * b
        cols[i * 3 + k] = under[k] + (sand - under[k]) * S
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: true,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }))
    mesh.position.set(L.x, L.cy, L.z)
    scene.add(mesh)

    // Puntos de la línea de agua (para espuma y ramas). Las islas quedan como
    // mallas de arena LIMPIAS (sin punteado ni liquen — preferencia del usuario).
    const shore = []
    for (let i = 0; i < pos.count; i++) {
      const wy = pos.getY(i) + L.cy
      if (wy > ht - 0.5 && wy < ht + 0.9) shore.push([L.x + pos.getX(i), L.z + pos.getZ(i)])
    }
    // Espuma blanca en la línea de agua (con phase = balanceo).
    if (shore.length) {
      const foamN = Math.min(2600, Math.floor(70 * (L.rx + L.rz)))
      for (let i = 0; i < foamN; i++) {
        const p2 = shore[q() * shore.length | 0]
        const lx = p2[0] - L.x, lz = p2[1] - L.z, dd = Math.hypot(lx, lz) || 1
        const be = Math.pow(q(), 2) * 2, va = (q() - 0.5) * 1.2
        pushPoint(p2[0] + lx / dd * be - lz / dd * va, ht + 0.06 + Math.pow(q(), 2.2) * 0.9, p2[1] + lz / dd * be + lx / dd * va,
          [1, 1, 1], 0.1 + q() * 0.2, 0.05 + q() * 0.95)
      }
      // 1–2 ramas secas (driftwood) por isla.
      const branches = 1 + (q() * 2 | 0)
      for (let bnum = 0; bnum < branches; bnum++) {
        const base = shore[q() * shore.length | 0]
        driftwood(base[0], ht + 0.1, base[1])
      }
    }
  }

  // ─── PLANTAS ACUÁTICAS (Vt): juncos rooteados en el LECHO (mayoría SUMERGIDOS,
  // ~12% EMERGEN sobre la superficie) en ~16 matas, + plantas de SUPERFICIE
  // (rosetas blancas) donde un junco emergente cruza el agua ─────────────────
  {
    // ~16 puntos-semilla (matas) en el borde de los lóbulos, a la línea de agua.
    const seeds = []
    for (let o = 0, guard = 0; o < 16 && guard++ < 16 * 14; ) {
      const L = lobes[q() * lobes.length | 0], l = q() * 6.2832
      const frac = clamp01((ht - L.cy) / L.ry)
      const f = Math.sqrt(Math.max(0.02, 1 - frac * frac)) * 0.94 * (1.1 + q() * 0.55)
      const m = Math.cos(l) * L.rx * f, h = Math.sin(l) * L.rz * f
      const gx = L.x + m * L.c - h * L.s, gz = L.z + m * L.s + h * L.c
      if (Math.hypot(gx, gz) > mt * 1.1) continue
      seeds.push([gx, gz]); o++
    }
    const surface = []
    const total = Math.round(16 * 1) * 46 // 736
    for (let count = 0, guard = 0; seeds.length && count < total && guard++ < total * 6; ) {
      const sd = seeds[q() * seeds.length | 0]
      const C = q() * 6.2832, w = Math.pow(q(), 0.6) * (2.4 + q() * 2.2)
      const T = sd[0] + Math.cos(C) * w, E = sd[1] + Math.sin(C) * w
      if (Math.hypot(T, E) > mt * 1.1 || lobeTop(T, E) > bedY + 1.4) continue
      const tall = q() < 0.12
      const k = bedY + (fbm(T * 0.06 + 3, E * 0.06 - 8, 2) - 0.5) * 1.3 // base EN EL LECHO
      const A = tall ? gt * 0.8 + 0.8 + q() * 3.2 : 3.5 + q() * 5          // altura
      const j = noise2(T * 0.02 + 51, E * 0.02 + 13) * 12.566 + (q() - 0.5) * 1.6
      const M = (0.5 + q() * 1.1) * (tall ? 1.6 : 1)
      const N = Math.cos(j) * M, P = Math.sin(j) * M
      const F = clamp01(0.35 + wt(T, E) * 0.45 + (q() - 0.5) * 0.2)
      const col = [0.8 + 0.2 * F, 0.64 + 0.19 * F, 0.04 + 0.04 * F]
      const lo = [col[0] * 0.25, col[1] * 0.25, col[2] * 0.25]
      const hi = [col[0] * 0.88, col[1] * 0.9, col[2] * 0.88]
      const mx = T + N * 0.35, my = k + A * 0.62, mz = E + P * 0.35
      pushLine(T, k, E, mx, my, mz, lo, col)
      pushLine(mx, my, mz, T + N, k + A, E + P, col, hi)
      // Junco emergente que cruza la superficie → planta de superficie ahí.
      if (tall && k + A > ht + 0.4 && q() < 0.5) {
        const V = clamp01((ht - k) / A)
        surface.push([T + N * V * 0.55, E + P * V * 0.55])
      }
      count++
    }
    // Plantas de superficie (Pt): roseta de puntos blancos flotando, con sway.
    for (const sp of surface) {
      const n = 10 + (q() * 14 | 0), rad = 0.7 + q() * 0.9
      for (let a = 0; a < n; a++) {
        const o = q() * 6.2832, s = Math.pow(q(), 0.7) * rad
        pushPoint(sp[0] + Math.cos(o) * s, ht + 0.08 + Math.pow(q(), 2) * 0.5, sp[1] + Math.sin(o) * s,
          [1, 1, 1], 0.11 + q() * 0.2, 0.05 + q() * 0.95)
      }
    }
  }

  // ─── POLVO (Ut): 8500 puntos azul-teal en anillo ──────────────────────────
  for (let e = 0; e < P.dustCount; e++) {
    const n = q() * 6.2832, r = mt * (0.95 + Math.pow(q(), 0.85) * 1.15)
    if (r > R * 1.3) continue
    const x = Math.cos(n) * r, z = Math.sin(n) * r
    const o = clamp01(1 - (r - mt) / (R * 1.3 - mt)) * 0.92 + 0.08
    const s = (0.25 + q() * 0.75) * o
    pushPoint(x, ht + q() * 0.6, z, [0.03 * s + 0.015, 0.15 * s + 0.025, 0.17 * s + 0.035], 0.1 + q() * 0.2, 0)
  }

  // Subir buffers de líneas (juncos + ramas) y puntos (liquen + espuma + polvo).
  const floraMat = new THREE.LineBasicMaterial({ vertexColors: true, fog: true })
  snowMats.push(floraMat)
  draw.finalizeLines(scene, floraMat)
  draw.finalizePoints(scene)

  // ─── NIEBLA azul (Bt): 4200 puntos aditivos sobre la laguna ───────────────
  const hazeUniforms = createHaze(scene, {
    R: mt * 1.28, G, count: P.hazeCount, color: [0.14, 0.42, 1.0], alpha: 0.16,
    heightFn: () => P.waterLevel,
  }).uniforms

  stage.setResizeHook((m) => {
    pointUniforms.uProj.value = m.proj
    hazeUniforms.uProj.value = m.proj
  })

  // ─── API del builder ──────────────────────────────────────────────────────
  let clock = 0
  function update(_swarm, dt, eco) {
    const step = dt || 0.016
    clock += step
    pointUniforms.uT.value = clock
    if (eco) scene.fog.density = 0.0009 + eco.fog * 0.0028
    stage.render(step)
    return []
  }
  function scare() {}

  return { update, scare, flash: stage.flash, resize: stage.resize, dispose: stage.dispose }
}
