import * as THREE from 'three'
import { createStage } from './stage.js'
import { createDraw, createPointCloud } from './engine/points.js'
import { createHaze } from './engine/haze.js'
import { createAgentKit } from './engine/agents3d.js'
import { createTrails } from './engine/trails.js'
import { lichenRosette, mossClump, LICHEN_ORANGE, LICHEN_PALE } from './engine/crust.js'
import { createRain, createSnow } from './engine/weather.js'
import { createRoamers, updateRoamers } from '../sim/wander.js'
import { buildSpecies, POND_POOL } from './pond/species.js'
import { createFishRender } from './pond/fish.js'
import { noise2, fbm } from './noise.js'

// Mundo AGUA (pond). Calca el mundo de agua de murmur.living: ISLAS de arena
// (elipsoides que suben del lecho) flotando en un campo de AGUA azul brillante
// sobre fondo negro, con juncos dispersos en la línea de agua, niebla azul y
// polvo de borde. Mapeo exacto del bundle en
// `docs/superpowers/specs/2026-08-11-pond-visual-map.md`.
//
// Paridad (spec §4): mt=64, ht=-3.4, gt=11, G=85. Valores en `cfg.pond`.
export function createPond(container, cfg, agentNames = []) {
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
  // Piedra oscura, mojada (roca de río/mar de Chile): gris-carbón frío, no arena.
  const SAND_LO = [0.065, 0.072, 0.085]  // roca húmeda en sombra
  const SAND_HI = [0.30, 0.315, 0.35]    // canto iluminado (gris frío)
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
  function wt(x, z) { let m = 0; for (const L of lobes) m = Math.max(m, smooth((3.2 - lobeQ(L, x, z)) / 2.9)); return m }
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

  // Flor de ribera: tallo curvo de 2 segmentos + cabeza de color (como el bosque).
  const FLOWER_COLS = [[1, 0.48, 0.09], [1, 0.37, 0.69], [0.93, 0.95, 1], [1, 0.88, 0.1], [0.95, 0.3, 0.3], [1, 0.69, 0.35]]
  const STEM_LO = [0.16, 0.22, 0.1], STEM_HI = [0.38, 0.46, 0.24]
  function pondFlower(x, y, z) {
    const h = 0.8 + q() * 1.3
    const a = q() * 6.2832, c = 0.3 + q() * 0.7
    const lx = Math.cos(a) * c, lz = Math.sin(a) * c
    const mx = x + lx * 0.4, my = y + h * 0.55, mz = z + lz * 0.4
    const tx = x + lx, ty = y + h, tz = z + lz
    pushLine(x, y, z, mx, my, mz, STEM_LO, STEM_HI)
    pushLine(mx, my, mz, tx, ty, tz, STEM_HI, STEM_HI)
    const col = FLOWER_COLS[q() * FLOWER_COLS.length | 0]
    pushPoint(tx, ty + 0.05, tz, col, 0.3 + q() * 0.3, q())
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

  // ─── AGUA (zt): plano con glow azul + shimmer animado + WAKE ──────────────
  // Base fiel a murmur (vertex-color del campo Y/Mt/Nt) + mejoras: brillos que
  // se deslizan (movimiento) y anillos de estela donde cruzan agentes/peces.
  const RIPPLES = 22
  const waterUniforms = {
    uTime: { value: 0 },
    // x, z, radio, fuerza — sembrados en la superficie por los elementos que pasan.
    uRipples: { value: Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, 0, 0)) },
  }
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
    const waterMat = new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      vertexShader: `
        attribute vec3 color;
        varying vec2 vXZ; varying vec3 vCol;
        void main() {
          vXZ = position.xz; vCol = color;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        precision mediump float;
        #define N ${RIPPLES}
        uniform float uTime; uniform vec4 uRipples[N];
        varying vec2 vXZ; varying vec3 vCol;
        void main() {
          // Shimmer: reflejos que se deslizan sobre la superficie.
          // Oleaje multi-octava (olas grandes + rizado fino), como la ref de agua.
          float w = sin(vXZ.x * 0.09 + uTime * 0.7) * sin(vXZ.y * 0.075 - uTime * 0.55)
                  + 0.5 * sin(vXZ.x * 0.03 - vXZ.y * 0.04 + uTime * 0.35)
                  + 0.28 * sin(vXZ.x * 0.24 - vXZ.y * 0.19 + uTime * 1.35)
                  + 0.16 * sin(vXZ.x * 0.51 + vXZ.y * 0.44 - uTime * 2.1);
          float glint = smoothstep(0.75, 1.4, w);
          // Cáusticas: red fina que se arrastra sobre el agua.
          float c1 = sin(vXZ.x * 0.33 + uTime * 0.9) * sin(vXZ.y * 0.29 - uTime * 0.75);
          float caustic = pow(max(0.0, c1), 3.0) * 0.5;
          // Wake: anillos que se expanden donde pasa un elemento.
          float wake = 0.0;
          for (int i = 0; i < N; i++) {
            vec4 r = uRipples[i];
            if (r.w <= 0.001) continue;
            float d = distance(vXZ, r.xy);
            // Tren de ondas: varias crestas que se alejan del impacto y se
            // amortiguan con la distancia (como una gota real en el agua).
            float ring = sin((d - r.z) * 1.9) * exp(-abs(d - r.z) * 0.42);
            float env = smoothstep(9.0, 0.0, abs(d - r.z));
            wake += max(0.0, ring) * env * r.w;
          }
          wake = min(wake, 1.5);
          vec3 col = vCol + glint * vec3(0.22, 0.46, 0.75) + caustic * vec3(0.16, 0.38, 0.72) + wake * vec3(0.32, 0.60, 0.98);
          float lum = dot(vCol, vec3(0.5, 0.6, 0.7));
          float a = clamp(0.22 + lum * 2.2 + glint * 0.14 + caustic * 0.1 + wake * 0.55, 0.0, 0.92);
          gl_FragColor = vec4(col, a);
        }`,
    })
    const water = new THREE.Mesh(geo, waterMat)
    water.renderOrder = 1
    scene.add(water)
  }

  // ─── ISLAS (It): elipsoide de icosfera deformada + arena + espuma + ramas ──
  for (const L of lobes) {
    const geo = new THREE.IcosahedronGeometry(1, 4)
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
        + (fbm(pos.getX(i) * 0.22 + seed, pos.getZ(i) * 0.22, 3) - 0.5) * 0.42
        + (noise2(pos.getX(i) * 0.9 + seed, pos.getZ(i) * 0.9) - 0.5) * 0.22)
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

    // Malla de arena LIMPIA (sin stipple uniforme). Encima, cobertura ORGÁNICA
    // (líquenes/musgo/flores en manchas sobre las caras hacia arriba, como las
    // rocas del bosque) + espuma en la línea de agua.
    const shore = []
    for (let i = 0; i < pos.count; i++) {
      const wy = pos.getY(i) + L.cy
      if (wy > ht - 0.5 && wy < ht + 0.9) shore.push([L.x + pos.getX(i), L.z + pos.getZ(i)])
    }
    // Espuma blanca en la línea de agua (con phase = balanceo).
    if (shore.length) {
      const foamN = Math.min(7000, Math.floor(210 * (L.rx + L.rz)))
      for (let i = 0; i < foamN; i++) {
        const p2 = shore[q() * shore.length | 0]
        const lx = p2[0] - L.x, lz = p2[1] - L.z, dd = Math.hypot(lx, lz) || 1
        const be = Math.pow(q(), 2) * 2, va = (q() - 0.5) * 1.2
        pushPoint(p2[0] + lx / dd * be - lz / dd * va, ht + 0.06 + Math.pow(q(), 2.2) * 0.9, p2[1] + lz / dd * be + lx / dd * va,
          [1, 1, 1], 0.055 + q() * 0.1, 0.05 + q() * 0.95)
      }
      // 1–2 ramas secas (driftwood) por isla.
      const branches = 1 + (q() * 2 | 0)
      for (let bnum = 0; bnum < branches; bnum++) {
        const base = shore[q() * shore.length | 0]
        driftwood(base[0], ht + 0.1, base[1])
      }
    }

    // Cobertura orgánica sobre el agua (caras hacia arriba): líquenes naranjas,
    // musgo verde en manchas, y flores en las partes más planas.
    const up = []
    for (let i = 0; i < pos.count; i++) {
      if (nrm.getY(i) > 0.15 && pos.getY(i) + L.cy > ht + 0.3) up.push(i)
    }
    if (up.length) {
      const area = L.rx * L.rz
      // LÍQUENES: rosetas planas (naranja y gris-verde) sembradas en manchas.
      const rosettes = Math.min(60, Math.max(6, Math.floor(area * 0.16)))
      for (let i = 0; i < rosettes; i++) {
        const vi = up[q() * up.length | 0]
        const fx = pos.getX(vi), fy = pos.getY(vi), fz = pos.getZ(vi)
        // El ruido decide DÓNDE hay colonia: deja piedra desnuda entre parches.
        if (fbm(fx * 0.35 + seed * 1.7, fz * 0.35, 2) < 0.42) continue
        lichenRosette(pushPoint, L.x + fx, L.cy + fy, L.z + fz, {
          radius: 0.5 + q() * 1.5,
          color: q() < 0.55 ? LICHEN_ORANGE : LICHEN_PALE,
          size: 0.085 + q() * 0.06,
        })
      }
      // MUSGO: cúmulos abultados que coronan la piedra (donde junta humedad).
      const clumps = Math.min(26, Math.max(3, Math.floor(area * 0.07)))
      for (let i = 0; i < clumps; i++) {
        const vi = up[q() * up.length | 0]
        const fx = pos.getX(vi), fy = pos.getY(vi), fz = pos.getZ(vi)
        if (nrm.getY(vi) < 0.42) continue
        if (fbm(fx * 0.3 + seed * 2.3 + 9, fz * 0.3, 2) < 0.5) continue
        mossClump(pushPoint, L.x + fx, L.cy + fy, L.z + fz, {
          radius: 0.8 + q() * 1.8, height: 0.35 + q() * 0.5, density: 0.8 + q() * 0.6,
        })
      }
      let want = 26 + (q() * 22 | 0)
      for (let guard = 0; want > 0 && guard < 400; guard++) {
        const vi = up[q() * up.length | 0]
        if (nrm.getY(vi) < 0.5) continue
        pondFlower(L.x + pos.getX(vi), L.cy + pos.getY(vi), L.z + pos.getZ(vi))
        want--
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
      const A = tall ? gt * 0.9 + 3 + q() * 5 : 6 + q() * 7                // altura (más largos)
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
          [1, 1, 1], 0.07 + q() * 0.12, 0.05 + q() * 0.95)
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
    R: mt * 1.72, G, count: P.hazeCount, color: [0.12, 0.35, 1.0], alpha: 0.2,
    heightFn: () => P.waterLevel,
  }).uniforms

  // ─── AGENTES: las 6 especies acuáticas (pool ponderado) ───────────────────
  const kit = createAgentKit(rc)
  const KIND_COLOR = { lamp: 0xeef2ff, ice: 0xaee6ff, strider: 0x39c8ff, orb: 0xe08bd8, burst: 0xbfe6ff, pins: 0x86e03a }
  const pool = []
  for (const [kind, wgt] of POND_POOL) for (let i = 0; i < wgt; i++) pool.push(kind)
  const n = cfg.fireflies.count
  const agents = []
  const trailColors = []
  for (let i = 0; i < n; i++) {
    const kind = pool[q() * pool.length | 0]
    const { group, params } = buildSpecies(kind, kit)
    const baseScale = 0.9 + q() * 0.5
    group.scale.setScalar(baseScale)
    scene.add(group)
    // Las especies "rodantes" envuelven su jaula en group.children[0].
    const cage = params.rollMul > 0 ? group.children[0] : null
    agents.push({
      group, cage, kind, baseScale, idx: i, homeY: 0.4 + q() * 1.2,
      dive: params.dive, hover: params.hover, rollMul: params.rollMul,
      spinY: params.spinY, effR: params.effR,
      // Las 2 primeras son garzas: pican al agua a cazar peces.
      hunter: i < 2, huntCool: 3 + q() * 4, striking: 0, struck: false, targetFish: -1,
    })
    trailColors.push(KIND_COLOR[kind])
  }
  // ─── RANAS: bichitos que se suben a las piedras y de a ratos saltan al agua.
  // Cada una elige un punto ALTO de una isla, se posa un rato, y salta a otra.
  const FROGN = 7
  const frogs = []
  function frogPerch() {
    const L = lobes[q() * lobes.length | 0]
    const a = q() * 6.2832, t = q() * 0.62      // dentro de la huella de la isla
    const fx = L.x + Math.cos(a) * L.rx * t, fz = L.z + Math.sin(a) * L.rz * t
    const top = lobeTop(fx, fz)
    return { x: fx, z: fz, y: (top > -Infinity ? top : ht) + 0.35 }
  }
  const frogCloud = createPointCloud(FROGN * 3, draw.pointMaterial)
  for (let i = 0; i < FROGN; i++) {
    const p0 = frogPerch()
    frogs.push({ ...p0, tx: p0.x, tz: p0.z, ty: p0.y, wait: 1 + q() * 5, jump: 0 })
    for (let k = 0; k < 3; k++) {
      const j = (i * 3 + k) * 3
      // Verde rana con vientre más claro.
      frogCloud.col[j] = k === 2 ? 0.72 : 0.22
      frogCloud.col[j + 1] = k === 2 ? 0.82 : 0.62 + q() * 0.2
      frogCloud.col[j + 2] = k === 2 ? 0.55 : 0.2
      frogCloud.size[i * 3 + k] = k === 2 ? 0.16 : 0.3
    }
  }
  scene.add(frogCloud.mesh)
  function updateFrogs(step) {
    for (let i = 0; i < FROGN; i++) {
      const f = frogs[i]
      if (f.jump > 0) {
        // Salto: parábola entre la piedra actual y la siguiente.
        f.jump = Math.max(0, f.jump - step / 0.9)
        const k = 1 - f.jump
        f.x += (f.tx - f.x) * 0.12
        f.z += (f.tz - f.z) * 0.12
        f.y = f.y + (f.ty - f.y) * 0.12 + Math.sin(k * Math.PI) * 0.22
        if (f.jump === 0) { f.x = f.tx; f.z = f.tz; f.y = f.ty; f.wait = 2 + q() * 7 }
      } else {
        f.wait -= step
        if (f.wait <= 0) { const p1 = frogPerch(); f.tx = p1.x; f.tz = p1.z; f.ty = p1.y; f.jump = 1 }
      }
      // Cuerpo (2 puntos) + ojo.
      const b = i * 3
      frogCloud.pos[b * 3] = f.x; frogCloud.pos[b * 3 + 1] = f.y; frogCloud.pos[b * 3 + 2] = f.z
      frogCloud.pos[(b + 1) * 3] = f.x + 0.22; frogCloud.pos[(b + 1) * 3 + 1] = f.y - 0.05; frogCloud.pos[(b + 1) * 3 + 2] = f.z + 0.1
      frogCloud.pos[(b + 2) * 3] = f.x - 0.12; frogCloud.pos[(b + 2) * 3 + 1] = f.y + 0.16; frogCloud.pos[(b + 2) * 3 + 2] = f.z - 0.08
    }
    frogCloud.commit()
  }

  // AGENTES EXTRA (decorativos): más vida en la laguna sin tocar el swarm/censo
  // del host (esos son los `n` nombrados). No llevan etiqueta ni estela.
  const EXTRA = 16
  const extras = []
  for (let i = 0; i < EXTRA; i++) {
    const kind = pool[q() * pool.length | 0]
    const { group, params } = buildSpecies(kind, kit)
    group.scale.setScalar(0.85 + q() * 0.5)
    scene.add(group)
    extras.push({
      group, cage: params.rollMul > 0 ? group.children[0] : null,
      idx: n + i, homeY: 0.4 + q() * 1.2,
      dive: params.dive, hover: params.hover, spinY: params.spinY,
    })
  }

  // yOffset negativo: las estelas se siembran POR ENCIMA del agente para que
  // floten sobre la superficie del agua (si no, quedan sumergidas e invisibles).
  const trails = createTrails(scene, n, trailColors, rc, draw.pointMaterial, -0.3)

  // Cardúmenes de peces bajo el agua (boids). state.fish expone posiciones.
  const fish = createFishRender(scene, cfg, q)

  // ─── BICHOS (mosquitos) que vuelan sobre el agua ──────────────────────────
  const BUGN = 90
  const bugR = mt * 0.85
  const bugs = []
  function placeBug(b) {
    const a = q() * 6.2832, r = Math.sqrt(q()) * bugR
    b.x = Math.cos(a) * r; b.z = Math.sin(a) * r
    b.y = ht + 1.0 + q() * 2.8
    b.tx = b.x + (q() - 0.5) * 22; b.tz = b.z + (q() - 0.5) * 22
    b.phase = q() * 6.2832; b.alive = true; b.respawn = 0
  }
  for (let i = 0; i < BUGN; i++) { const b = {}; placeBug(b); bugs.push(b) }
  const bugCloud = createPointCloud(BUGN, draw.pointMaterial)
  for (let i = 0; i < BUGN; i++) {
    bugCloud.col[i * 3] = 0.65; bugCloud.col[i * 3 + 1] = 0.92; bugCloud.col[i * 3 + 2] = 1.0
    bugCloud.size[i] = 0.24 + q() * 0.16
  }
  scene.add(bugCloud.mesh)
  function updateBugs(step, t) {
    for (let i = 0; i < BUGN; i++) {
      const b = bugs[i]
      if (!b.alive) {
        b.respawn -= step
        if (b.respawn <= 0) placeBug(b)
        else { bugCloud.pos[i * 3 + 1] = -9999; continue }
      }
      const dx = b.tx - b.x, dz = b.tz - b.z, dd = Math.hypot(dx, dz)
      if (dd < 2 || q() < 0.01) { const a = q() * 6.2832, r = Math.sqrt(q()) * bugR; b.tx = Math.cos(a) * r; b.tz = Math.sin(a) * r }
      else { b.x += dx / dd * 6 * step; b.z += dz / dd * 6 * step }
      bugCloud.pos[i * 3] = b.x
      bugCloud.pos[i * 3 + 1] = b.y + Math.sin(t * 3 + b.phase) * 0.5
      bugCloud.pos[i * 3 + 2] = b.z
    }
    bugCloud.commit()
  }
  // Peces cerca de la superficie comen bichos (el bicho reaparece luego).
  function fishEatBugs() {
    const F = fish.state.fish
    for (let bi = 0; bi < BUGN; bi++) {
      const b = bugs[bi]
      if (!b.alive) continue
      for (let fi = 0; fi < F.length; fi++) {
        const f = F[fi]
        if (f.y < ht - 3) continue
        if (Math.hypot(f.x * mt - b.x, f.z * mt - b.z) < 2.4) {
          b.alive = false; b.respawn = 2 + q() * 2.5
          f.vy += 0.02; spawnRipple(b.x, b.z, 0.6)
          break
        }
      }
    }
  }

  // Garzas: unos pocos agentes pican al agua y atrapan un pez (→ depredación).
  function huntHerons(step, predations) {
    const F = fish.state.fish
    for (let i = 0; i < n; i++) {
      const a = agents[i]
      if (!a.hunter) continue
      if (a.striking > 0) {
        a.striking -= step
        // Picado: la garza baja al agua y vuelve (parábola en el tiempo).
        const k = Math.max(0, 1 - Math.abs(a.striking / 0.7 - 0.5) * 2)
        worldPos[i * 3 + 1] = ht + 1.5 - k * 4.2
        const f = F[a.targetFish]
        if (f) {
          const dx = f.x * mt - worldPos[i * 3], dz = f.z * mt - worldPos[i * 3 + 2], dd = Math.hypot(dx, dz) || 1
          roamers[i].vx += dx / dd * 0.4 * step; roamers[i].vz += dz / dd * 0.4 * step
          if (a.striking < 0.35 && !a.struck) {
            a.struck = true
            if (dd < 5) {
              const dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'right' : 'left') : (dz > 0 ? 'ahead' : 'behind')
              predations.push({ hunterIdx: a.idx, dir })
              fish.scatter(0.6); spawnRipple(f.x * mt, f.z * mt, 1.0)
            }
          }
        }
        if (a.striking <= 0) { a.striking = 0; a.huntCool = 5 + q() * 6 }
      } else {
        a.huntCool -= step
        if (a.huntCool <= 0) {
          let best = -1, bestD = 45
          for (let fi = 0; fi < F.length; fi++) {
            const d = Math.hypot(F[fi].x * mt - worldPos[i * 3], F[fi].z * mt - worldPos[i * 3 + 2])
            if (d < bestD) { bestD = d; best = fi }
          }
          if (best >= 0) { a.striking = 0.7; a.struck = false; a.targetFish = best } else a.huntCool = 1 + q()
        }
      }
    }
  }

  // Deambular sobre el agua: roamers normalizados → radio de laguna.
  const roamers = createRoamers(cfg.wander, n, q)
  const extraRoamers = createRoamers(cfg.wander, EXTRA, q)
  const LR = mt * 1.05
  const worldPos = new Float32Array(n * 3)
  let simTime = 0
  function mapPositions(dt, t) {
    simTime += dt
    updateRoamers(roamers, cfg.wander, dt, q, simTime, null, null, null)
    updateRoamers(extraRoamers, cfg.wander, dt, q, simTime + 31.7, null, null, null)
    for (let i = 0; i < EXTRA; i++) {
      const a = extras[i], r = extraRoamers[i]
      let j = ht - a.dive + a.homeY * 0.3 + Math.sin(t * 1.4 + a.idx * 2.1) * (0.34 + a.hover * 0.12)
      if (j < bedY + 0.9) j = bedY + 0.9
      a.group.position.set(r.x * LR, j, r.z * LR)
      if (a.spinY) a.group.rotation.y += a.spinY * dt
      if (j < ht + 1.2) {
        a.group.rotation.x = Math.sin(t * 1.7 + a.idx) * 0.085
        a.group.rotation.z = Math.cos(t * 1.5 + a.idx) * 0.085
      }
    }
    for (let i = 0; i < n; i++) {
      const a = agents[i], r = roamers[i]
      // Física de agua (spec §4.3): unas bucean (dive>0), otras planean (dive<0).
      let j = ht - a.dive + a.homeY * 0.3 + Math.sin(t * 1.4 + a.idx * 2.1) * (0.34 + a.hover * 0.12)
      if (j < bedY + 0.9) j = bedY + 0.9
      worldPos[i * 3] = r.x * LR; worldPos[i * 3 + 1] = j; worldPos[i * 3 + 2] = r.z * LR
    }
  }

  const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3(), _axis = new THREE.Vector3(), _quat = new THREE.Quaternion()
  const _proj = new THREE.Vector3()
  let ptrX = null, ptrY = null, _lx = 0, _ly = 0
  // El lente fisheye desplaza la posición VISUAL del agente respecto a su NDC
  // lógico; para que el hover matchee lo que se ve, distorsiono la proyección
  // igual que el shader del lente (mix(1-k,1,rn²), invertido por iteración).
  const _fk = Math.min(rc.fisheye, 0.62)
  function lensNDC(px, py) {
    let sx = px, sy = py
    for (let it = 0; it < 3; it++) {
      // rn del shader = |cc|/0.7071 con cc = uv-0.5 (max 0.5) → en NDC es |ndc|/1.4142.
      const rn = Math.hypot(sx, sy) / 1.4142
      const f = (1 - _fk) + _fk * rn * rn
      sx = px / f; sy = py / f
    }
    return [sx, sy]
  }

  // Wake: pool de ondas que se expanden y desvanecen; se siembran donde un
  // elemento cruza/roza la superficie (agentes cerca del nivel, peces al tope).
  let rippleHead = 0, rippleTimer = 0, dropTimer = 0
  function spawnRipple(x, z, str) {
    waterUniforms.uRipples.value[rippleHead].set(x, z, 0.5, str)
    rippleHead = (rippleHead + 1) % RIPPLES
  }
  function updateRipples(step) {
    for (const r of waterUniforms.uRipples.value) {
      if (r.w <= 0.001) continue
      r.z += 8 * step                       // expandir el radio
      r.w = Math.max(0, r.w - 0.34 * step)  // desvanecer lento → más visible
    }
    rippleTimer -= step
    if (rippleTimer <= 0) {
      // Varios focos por tick: agentes cerca de la superficie + peces al tope.
      // Cuanto más rápido va un agente cerca de la superficie, más agua mueve.
      let spawned = 0
      for (let t = 0; t < 14 && spawned < 5; t++) {
        const i = q() * n | 0
        const dy = Math.abs(worldPos[i * 3 + 1] - ht)
        if (dy > 2.2) continue
        const r = roamers[i]
        const sp = Math.hypot(r.vx, r.vz) * LR
        const near = 1 - dy / 2.2
        spawnRipple(worldPos[i * 3], worldPos[i * 3 + 2], (0.5 + Math.min(1.2, sp * 0.9)) * near)
        spawned++
      }
      const f = fish.state.fish
      for (let t = 0; t < 3; t++) { const k = q() * f.length | 0; if (f[k] && f[k].y > ht - 2.4) spawnRipple(f[k].x * mt, f[k].z * mt, 0.5) }
      rippleTimer = 0.07 + q() * 0.1
    }
  }

  // ─── CLIMA: lluvia y nieve sobre la laguna (mismo motor que el bosque) ────
  // La lluvia arranca por encima del agua, no del suelo del bosque.
  const rain = createRain(scene, mt * 1.35, ht + 1)
  const snow = createSnow(scene, mt * 1.35, ht + 1, pointUniforms.uProj)

  stage.setResizeHook((m) => {
    pointUniforms.uProj.value = m.proj
    hazeUniforms.uProj.value = m.proj
    kit.setResolution(m.w * m.dpr, m.h * m.dpr)
  })

  // ─── API del builder ──────────────────────────────────────────────────────
  let clock = 0
  function update(swarm, dt, eco) {
    const step = dt || 0.016
    clock += step
    pointUniforms.uT.value = clock
    waterUniforms.uTime.value = clock
    if (eco) scene.fog.density = 0.0009 + eco.fog * 0.0028

    const predations = []
    mapPositions(step, clock)
    fish.update(step, clock)      // mueve los peces primero
    huntHerons(step, predations)  // garzas pican (puede sobreescribir su y)
    updateBugs(step, clock)
    updateFrogs(step)
    fishEatBugs()
    for (let i = 0; i < n; i++) {
      const a = agents[i], r = roamers[i]
      const y = worldPos[i * 3 + 1]
      a.group.position.set(worldPos[i * 3], y, worldPos[i * 3 + 2])
      if (a.spinY) a.group.rotation.y += a.spinY * step
      // Rodado de jaula según la velocidad (lamp/ice/strider).
      if (a.rollMul > 0 && a.cage) {
        const wvx = r.vx * LR, wvz = r.vz * LR, sp = Math.hypot(wvx, wvz)
        if (sp > 1e-4) {
          _dir.set(wvx, 0, wvz).normalize()
          _axis.crossVectors(_up, _dir)
          if (_axis.lengthSq() < 1e-5) _axis.set(1, 0, 0)
          _axis.normalize()
          _quat.setFromAxisAngle(_axis, (sp * step) / a.effR * a.rollMul)
          a.cage.quaternion.premultiply(_quat)
        }
      }
      // Cabeceo cerca de la superficie; se endereza si planea alto.
      if (y < ht + 1.2) {
        a.group.rotation.x = Math.sin(clock * 1.7 + a.idx) * 0.085
        a.group.rotation.z = Math.cos(clock * 1.5 + a.idx) * 0.085
      } else {
        a.group.rotation.x *= 1 - 3 * step
        a.group.rotation.z *= 1 - 3 * step
      }
      const pulse = 1 + (swarm ? swarm.flash[i] : 0) * 0.35
      if (a.cage) a.cage.scale.setScalar(pulse)
      else a.group.scale.setScalar(a.baseScale * pulse)
    }

    // Etiqueta flotante al pasar el mouse por encima de un agente.
    let bestI = -1
    if (ptrX !== null) {
      let bestD = 0.14
      for (let i = 0; i < n; i++) {
        // Ocluido por una isla (el agente está por debajo de su superficie ahí):
        // no mostrar su etiqueta sobre la roca. `lobeTop` = -Inf fuera de islas.
        if (worldPos[i * 3 + 1] < lobeTop(worldPos[i * 3], worldPos[i * 3 + 2]) + 0.5) continue
        _proj.set(worldPos[i * 3], worldPos[i * 3 + 1] + 3, worldPos[i * 3 + 2]).project(stage.camera)
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

    // Clima: cae lluvia (o nieve si hiela) y cada gota pica el agua.
    if (eco) {
      const snowing = eco.temperature <= -3
      const rainI = snowing ? 0 : eco.rain
      rain.update(step, rainI)
      snow.update(step, clock, snowing ? (0.6 + eco.rain * 0.6) : 0)
      // Gotas sobre la superficie: ondas chicas y numerosas según la intensidad.
      if (rainI > 0.02) {
        dropTimer -= step
        if (dropTimer <= 0) {
          const drops = 1 + (q() * (1 + rainI * 5) | 0)
          for (let d = 0; d < drops; d++) {
            const a = q() * 6.2832, rr = Math.sqrt(q()) * mt * 1.1
            spawnRipple(Math.cos(a) * rr, Math.sin(a) * rr, 0.22 + rainI * 0.3)
          }
          dropTimer = 0.03 + q() * 0.06
        }
      }
    }

    updateRipples(step)
    trails.update(worldPos)
    stage.render(step)
    return predations
  }

  function setPointer(x, y) { ptrX = x; ptrY = y }

  function scare(strength = 1) {
    for (const r of roamers) {
      const m = Math.hypot(r.x, r.z) || 1e-3
      const k = (0.7 + Math.random() * 1.1) * strength
      r.vx += (r.x / m) * k + (Math.random() - 0.5) * k * 1.5
      r.vz += (r.z / m) * k + (Math.random() - 0.5) * k * 1.5
      r.state = 'move'; r.stateT = 1.2 + Math.random() * 1.5
    }
    fish.scatter(strength * 1.5)
  }

  return {
    update, scare, setPointer,
    flash: stage.flash, resize: stage.resize, dispose: stage.dispose,
    camera: stage.camera, controls: stage.controls,
  }
}
