import * as THREE from 'three'
import { createStage } from './stage.js'
import { createDraw, createPointCloud } from './engine/points.js'
import { createHaze } from './engine/haze.js'
import { createAgentKit } from './engine/agents3d.js'
import { createTrails } from './engine/trails.js'
import { lichenRosette, mossClump, LICHEN_ORANGE, LICHEN_PALE } from './engine/crust.js'
import { createRain, createSnow } from './engine/weather.js'
import { buildFallenLog } from './engine/deadwood.js'
import { createWaterSim, buildIslandMask } from './engine/waterSim.js'
import { createRoamers, updateRoamers } from '../sim/wander.js'
import { buildSpecies, POND_POOL } from './pond/species.js'
import { createFishRender } from './pond/fish.js'
import { buildKoi, createKoiSchool, swimKoi } from './pond/koi.js'
import { POND_CENSUS, POND_KOI_NAMES } from '../sim/agents.js'
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
  const SIM_SIZE = 256               // resolución de la simulación de altura
  const SIM_HALF = P.lagoonRadius * 1.35  // medio-lado del mundo que cubre la sim
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
  const waterUniforms = {
    uTime: { value: 0 },
    // Simulación de altura (heightfield): textura R=altura → ondas reales que se
    // propagan/interfieren/rebotan. Se setea al crear el sim, más abajo.
    uHeight: { value: null },
    uSimHalf: { value: SIM_HALF },
    uHTexel: { value: 1 / SIM_SIZE },
    // AGITAR: 0 en reposo; sube al sacudir y decae → oleaje global de toda la laguna.
    uAgitate: { value: 0 },
  }
  // MAREA: el nivel del agua sube y baja despacio (curTide se recalcula por frame
  // en update); el plano de agua, los troncos y los nenúfares lo siguen, y la
  // línea de agua trepa por las rocas/juncos fijos (borde mojado).
  let waterMesh = null
  let curTide = 0
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
      // FrontSide: solo la cara de arriba. En DoubleSide, desde un ángulo bajo se
      // veía el glow por debajo de las islas como un blob azul flotando.
      transparent: true, depthWrite: false, side: THREE.FrontSide, fog: false,
      vertexShader: `
        attribute vec3 color;
        uniform float uTime; uniform float uAgitate;
        uniform sampler2D uHeight; uniform float uSimHalf;
        varying vec2 vXZ; varying vec3 vCol; varying float vAg; varying vec2 vSuv;
        void main() {
          vXZ = position.xz; vCol = color;
          vec3 p = position;
          // UV de la simulación de altura (solo válido dentro de la laguna).
          vSuv = p.xz / (2.0 * uSimHalf) + 0.5;
          float simH = texture2D(uHeight, clamp(vSuv, 0.0, 1.0)).r;
          p.y += simH * 0.9;   // desplazamiento real de la superficie por la onda
          // AGITAR: onda radial que sale del centro y recorre la laguna + chapoteo.
          float rr = length(p.xz);
          float swell = sin(rr * 0.14 - uTime * 4.0) * exp(-rr * 0.004);
          p.y += uAgitate * (1.8 * swell + 0.7 * sin(p.x * 0.08 + uTime * 3.0) * sin(p.z * 0.07 - uTime * 2.6));
          vAg = uAgitate;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime; uniform sampler2D uHeight; uniform float uHTexel;
        varying vec2 vXZ; varying vec3 vCol; varying float vAg; varying vec2 vSuv;
        void main() {
          // Shimmer base: reflejos que se deslizan sobre la superficie.
          float w = sin(vXZ.x * 0.09 + uTime * 0.7) * sin(vXZ.y * 0.075 - uTime * 0.55)
                  + 0.5 * sin(vXZ.x * 0.03 - vXZ.y * 0.04 + uTime * 0.35)
                  + 0.28 * sin(vXZ.x * 0.24 - vXZ.y * 0.19 + uTime * 1.35)
                  + 0.16 * sin(vXZ.x * 0.51 + vXZ.y * 0.44 - uTime * 2.1);
          w += vAg * 1.4 * sin(length(vXZ) * 0.12 - uTime * 3.5);
          float glint = smoothstep(0.75, 1.4, w);
          // Cáusticas: red fina que se arrastra sobre el agua.
          float c1 = sin(vXZ.x * 0.33 + uTime * 0.9) * sin(vXZ.y * 0.29 - uTime * 0.75);
          float caustic = pow(max(0.0, c1), 3.0) * 0.5;
          // ── ONDAS REALES (heightfield): pendiente de la altura simulada.
          vec2 e = vec2(uHTexel, 0.0);
          bool inSim = vSuv.x > 0.0 && vSuv.x < 1.0 && vSuv.y > 0.0 && vSuv.y < 1.0;
          float hC = texture2D(uHeight, vSuv).r;
          float hx = texture2D(uHeight, vSuv + e.xy).r - texture2D(uHeight, vSuv - e.xy).r;
          float hz = texture2D(uHeight, vSuv + e.yx).r - texture2D(uHeight, vSuv - e.yx).r;
          float slope = length(vec2(hx, hz));
          float rip = inSim ? min(slope * 3.0, 0.9) : 0.0;   // líneas de cresta (bordes de onda)
          float lift = inSim ? hC * 0.5 : 0.0;               // crestas claras / valles oscuros
          vec3 col = vCol + glint * vec3(0.22, 0.46, 0.75) + caustic * vec3(0.16, 0.38, 0.72)
                   + rip * vec3(0.34, 0.62, 0.98) + lift * vec3(0.08, 0.16, 0.28)
                   + vAg * vec3(0.24, 0.5, 0.92) * (0.5 + 0.7 * glint);
          float lum = dot(vCol, vec3(0.5, 0.6, 0.7));
          float a = clamp(0.22 + lum * 2.2 + glint * 0.14 + caustic * 0.1 + rip * 0.32 + max(lift, 0.0) * 0.15 + vAg * 0.3, 0.0, 0.94);
          gl_FragColor = vec4(col, a);
        }`,
    })
    const water = new THREE.Mesh(geo, waterMat)
    water.renderOrder = 1
    scene.add(water)
    waterMesh = water
  }

  // Simulación de altura del agua (heightfield): gotas de lluvia, koi/agentes y
  // AGITAR inyectan ondas que se propagan, se interfieren y REBOTAN en las islas
  // (máscara = huella de los lóbulos). El shader del agua muestrea su textura.
  // Pared = solo donde la isla ASOMA sobre la línea de agua (no toda la base
  // sumergida): las ondas pasan sobre la roca sumergida y rebotan en la orilla.
  const islandMask = buildIslandMask(SIM_SIZE, SIM_HALF, (wx, wz) => lobeTop(wx, wz) > ht - 0.4)
  const waterSim = createWaterSim(stage.renderer, { size: SIM_SIZE, halfExtent: SIM_HALF, mask: islandMask })
  waterUniforms.uHeight.value = waterSim.texture

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
  // Tipo por nombre del censo → decide si el agente es AVE (planea sobre el agua,
  // se posa, caza) o no. Sin esto los agentes con nombre de pájaro nadaban.
  const nameType = new Map(POND_CENSUS.map((a) => [a.name, a.type]))
  for (let i = 0; i < n; i++) {
    // Si al slot le tocó un nombre de KOI (fauna acuática del censo), se dibuja
    // como koi de verdad —cuerpo con parches + coleteo— en vez de criatura glow.
    // Los koi son móviles no-voladores → el censo los pone en slots no-aéreos,
    // así que nunca coinciden con garza (hunter) ni el que cruza el cielo (skyer).
    const isKoi = POND_KOI_NAMES.has(agentNames[i])
    let group, params, cage, kind, tail = null, bodyPivot = null
    if (isKoi) {
      ({ group, bodyPivot, tail } = buildKoi(q))
      params = { dive: 0.5, hover: 0.35, rollMul: 0, spinY: 0, effR: 2 }
      cage = null; kind = 'koi'
    } else {
      kind = pool[q() * pool.length | 0]
      ;({ group, params } = buildSpecies(kind, kit))
      cage = params.rollMul > 0 ? group.children[0] : null // rodantes: jaula en children[0]
    }
    const baseScale = isKoi ? 1.6 + q() * 0.8 : 0.9 + q() * 0.5
    group.scale.setScalar(baseScale)
    scene.add(group)
    // Ave = nombre volador del censo. Planea SOBRE el agua y se posa; no nada.
    const isBird = nameType.get(agentNames[i]) === 'flying_animal'
    agents.push({
      group, cage, kind, baseScale, idx: i, homeY: 0.4 + q() * 1.2, isKoi, isBird, tail, bodyPivot,
      spd: 0.8 + q() * 0.5, phase: q() * 6.2832, wakeT: 0, // koi: coleteo + estela
      dive: params.dive, hover: params.hover, rollMul: params.rollMul,
      spinY: params.spinY, effR: params.effR,
      // Las 2 primeras son garzas: pican al agua a cazar peces (los koi nunca).
      hunter: !isKoi && i < 2, hstate: 'fly', stateT: 2 + q() * 4, striking: 0, struck: false, targetFish: -1, perch: null,
      skyer: !isKoi && i === 4, crossCool: 8 + q() * 16, crossing: 0, crossDur: 1, crossTx: 0, crossTz: 0, crossHi: 0,
      // Aves NO cazadoras: planean y de a ratos se posan en una piedra.
      birdT: 3 + q() * 6, perching: false, perchPos: null,
    })
    trailColors.push(isKoi ? 0xff5a2a : KIND_COLOR[kind])
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

  // ─── TRONCO(S) DE ÁRBOL flotando en el agua ───────────────────────────────
  // Musgo sobre el tronco (ref: alikim "secret pond"): cúmulos verdes abultados
  // pegados a la cara SUPERIOR del tronco. Van como Points HIJO del grupo del
  // tronco (el shader de puntos usa modelViewMatrix) → flotan/giran con él. Usan
  // el mismo mossClump que corona las rocas, así el musgo se lee igual en todo.
  function addLogMoss(group) {
    const mesh0 = group.children[0]                 // la malla oscura del tronco
    const gp = mesh0.geometry.attributes.position
    const gn = mesh0.geometry.attributes.normal
    const top = []                                  // vértices de la cara de arriba
    for (let i = 0; i < gp.count; i++) {
      if (gn.getY(i) > 0.32 && gp.getY(i) > -0.25) top.push(i)
    }
    if (!top.length) return
    const mp = [], mc = [], ms = [], mph = []
    const pushM = (x, y, z, col, size) => { mp.push(x, y, z); mc.push(col[0], col[1], col[2]); ms.push(size); mph.push(0) }
    const clumps = 16 + (q() * 12 | 0)              // cojín tupido a lo largo del lomo
    for (let i = 0; i < clumps; i++) {
      const vi = top[q() * top.length | 0]
      mossClump(pushM, gp.getX(vi), gp.getY(vi), gp.getZ(vi), {
        radius: 0.6 + q() * 1.2, height: 0.28 + q() * 0.42, density: 0.7 + q() * 0.6, size: 0.13 + q() * 0.07,
      })
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mp), 3))
    geo.setAttribute('hcol', new THREE.BufferAttribute(new Float32Array(mc), 3))
    geo.setAttribute('hsize', new THREE.BufferAttribute(new Float32Array(ms), 1))
    geo.setAttribute('hphs', new THREE.BufferAttribute(new Float32Array(mph), 1))
    const pts = new THREE.Points(geo, draw.pointMaterial)
    pts.frustumCulled = false
    group.add(pts)
  }
  const floatLogs = []
  for (let li = 0; li < 1 + (q() < 0.5 ? 1 : 0); li++) {
    // Mismo tronco caído orgánico del bosque (tubo ahusado + ramas), flotando.
    const g = buildFallenLog({ length: 13 + q() * 9, radius: 1.5 + q() * 0.9 })
    // Aparece sobre AGUA ABIERTA (no dentro de una isla).
    let lx = 0, lz = 0
    for (let tryn = 0; tryn < 20; tryn++) {
      const a = q() * 6.2832, rr = 10 + q() * (mt * 0.55)
      lx = Math.cos(a) * rr; lz = Math.sin(a) * rr
      let inside = false
      for (const L2 of lobes) { const dx = lx - L2.x, dz = lz - L2.z, rad = Math.max(L2.rx, L2.rz) * 1.15 + 4; if (dx * dx + dz * dz < rad * rad) { inside = true; break } }
      if (!inside) break
    }
    g.position.set(lx, ht, lz) // tronco al ras del agua
    g.rotation.y = q() * 6.2832
    addLogMoss(g)              // cojín de musgo sobre el lomo
    scene.add(g)
    floatLogs.push({ g, drift: q() * 6.2832, spin: (q() - 0.5) * 0.04, phase: q() * 6.2832 })
  }
  function updateLogs(step, t) {
    for (const L of floatLogs) {
      // Deriva lenta PLANA (sin cabeceo que lo incline); giro suave en Y.
      const sp = 0.6
      const nx = L.g.position.x + Math.cos(L.drift) * sp * step
      const nz = L.g.position.z + Math.sin(L.drift) * sp * step
      // Rebota si tocaría una isla (no la atraviesa) o el borde de la laguna.
      let blocked = Math.hypot(nx, nz) > mt * 0.88
      if (!blocked) {
        for (const L2 of lobes) {
          const dx = nx - L2.x, dz = nz - L2.z
          const rad = Math.max(L2.rx, L2.rz) * 1.15 + 4
          if (dx * dx + dz * dz < rad * rad) { blocked = true; break }
        }
      }
      if (blocked) L.drift += Math.PI + (q() - 0.5) * 0.6
      else { L.g.position.x = nx; L.g.position.z = nz }
      L.g.position.y = ht + curTide + Math.sin(t * 0.9 + L.phase) * 0.1   // flota al ras, sigue la marea
      L.g.rotation.y += L.spin * step
      L.g.rotation.x = 0; L.g.rotation.z = 0                     // siempre plano
    }
  }

  // ─── NENÚFARES: hoja de nenúfar + flor de loto de PÉTALOS en CÚPULA (mapeo
  // exacto del código de alikim "secret pond", ver docs/alikim-tronco-musgo.md +
  // el nivel blossom): ~40 pétalos repartidos en bandas (una CÚPULA), sépalos
  // VERDES abajo, centro AMARILLO, pétalos interiores más pálidos. Floración:
  // al abrir los pétalos se inclinan hacia afuera Y SE ENCOGEN, así que cerrados
  // forman un capullo gordo y apretado (alikim: sc - 0.5·bloom). Hoja: borde que
  // CAE (se inunda), degradado verde-amarillo y venas radiales. Sigue la marea.
  const LOTUS_COLS = [
    [1.0, 0.45, 0.12], [0.30, 0.78, 1.0], [1.0, 0.28, 0.66], [0.62, 0.42, 1.0], [1.0, 0.55, 0.82],
  ]
  const lotusMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true })
  snowMats.push(lotusMat)
  const mixW = (c, p) => [c[0] + (1 - c[0]) * p, c[1] + (1 - c[1]) * p, c[2] + (1 - c[2]) * p]
  // Pétalo: almendra puntiaguda apuntando +Y (capullo vertical), ahuecada (mids
  // hacia -Z, como el makeZ del loto de alikim). Color por vértice base→punta.
  function petalGeom(len, wid, lo, hi) {
    const mid = [(lo[0] + hi[0]) * 0.5, (lo[1] + hi[1]) * 0.5, (lo[2] + hi[2]) * 0.5]
    const cup = len * 0.14
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, 0, 0, wid, len * 0.42, -cup, 0, len, 0, -wid, len * 0.42, -cup,
    ]), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([
      lo[0], lo[1], lo[2], mid[0], mid[1], mid[2], hi[0], hi[1], hi[2], mid[0], mid[1], mid[2],
    ]), 3))
    g.setIndex([0, 1, 2, 0, 2, 3])
    return g
  }
  // Hoja de nenúfar: disco festoneado con muesca en V; el BORDE CAE (rim negativo
  // → se inunda al ras del agua). Degradado centro amarillo-verde → borde verde,
  // con venas radiales (oscurecimiento cada pocas divisiones). notch=null → disco
  // lleno (para el centro de la flor); cen/edge = colores.
  function padGeom(rad, notch, cen, edge, dip) {
    const full = notch === null, gap = full ? 0 : 0.5
    const seg = full ? 12 : 32
    const pos = [0, 0, 0], cols = [cen[0], cen[1], cen[2]], idx = []
    let prev = -1
    for (let s = 0; s <= seg; s++) {
      const a = (full ? 0 : notch + gap / 2) + (s / seg) * (6.2832 - gap)
      const r = rad * (0.9 + 0.1 * Math.sin(a * 5))
      const vein = !full && s % 3 === 0 ? 0.6 : 1
      pos.push(Math.cos(a) * r, -(dip || 0) * rad, Math.sin(a) * r)
      cols.push(edge[0] * vein, edge[1] * vein, edge[2] * vein)
      const vi = pos.length / 3 - 1
      if (prev >= 0) idx.push(0, prev, vi)
      prev = vi
    }
    if (full) idx.push(0, prev, 1)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols), 3))
    g.setIndex(idx)
    return g
  }
  // Bandas de pétalos (cúpula), de fuera (sépalos verdes, muy tumbados) a dentro
  // (pequeños, casi verticales, pálidos). th = inclinación abierta de la banda.
  const BANDS = [
    { n: 7, th: 1.5, lf: 1.15, wf: 0.36, sepal: true },
    { n: 9, th: 1.12, lf: 1.06, wf: 0.34, pale: 0.0 },
    { n: 8, th: 0.88, lf: 0.92, wf: 0.33, pale: 0.14 },
    { n: 7, th: 0.64, lf: 0.78, wf: 0.32, pale: 0.34 },
    { n: 6, th: 0.42, lf: 0.62, wf: 0.3, pale: 0.54 },
    { n: 4, th: 0.24, lf: 0.48, wf: 0.28, pale: 0.74 },
  ]
  const SEPAL_LO = [0.08, 0.24, 0.05], SEPAL_HI = [0.16, 0.44, 0.1]
  const PAD_CEN = [0.5, 0.6, 0.1], PAD_EDGE = [0.14, 0.46, 0.11]
  const lilies = []
  {
    const LN = 7 + (q() * 3 | 0)
    for (let i = 0; i < LN; i++) {
      // Sobre AGUA ABIERTA (no dentro de una isla), como los troncos.
      let lx = 0, lz = 0, ok = false
      for (let t = 0; t < 24 && !ok; t++) {
        const a = q() * 6.2832, rr = 8 + q() * (mt * 0.72)
        lx = Math.cos(a) * rr; lz = Math.sin(a) * rr
        ok = Math.hypot(lx, lz) < mt * 0.9
        if (ok) for (const L2 of lobes) { const dx = lx - L2.x, dz = lz - L2.z, rad = Math.max(L2.rx, L2.rz) * 1.1 + 3; if (dx * dx + dz * dz < rad * rad) { ok = false; break } }
      }
      const group = new THREE.Group()
      group.position.set(lx, ht, lz)
      // Hoja: borde cae 0.14·rad → se inunda al ras del agua.
      group.add(new THREE.Mesh(padGeom(2.4 + q() * 1.8, q() * 6.2832, PAD_CEN, PAD_EDGE, 0.14), lotusMat))
      let flowerGroup = null, petals = null
      if (q() < 0.72) {
        const col = LOTUS_COLS[q() * LOTUS_COLS.length | 0]
        const fh = 1.7 + q() * 1.1
        flowerGroup = new THREE.Group()
        flowerGroup.position.y = 0.34            // la flor EMERGE sobre el agua
        petals = []
        for (const B of BANDS) {
          const hi = B.sepal ? SEPAL_HI : mixW(col, B.pale)
          const lo = B.sepal ? SEPAL_LO : [hi[0] * 0.5, hi[1] * 0.5, hi[2] * 0.5]
          const geom = petalGeom(fh * B.lf, fh * B.wf, lo, hi)
          const off = q() * 6.2832
          for (let p = 0; p < B.n; p++) {
            const m = new THREE.Mesh(geom, lotusMat)
            flowerGroup.add(m)
            petals.push({ m, az: (p / B.n) * 6.2832 + off, th: B.th })
          }
        }
        // Centro amarillo (receptáculo/estambres).
        const cen = new THREE.Mesh(padGeom(fh * 0.2, null, [1, 0.95, 0.55], [1, 0.82, 0.2], 0), lotusMat)
        cen.position.y = fh * 0.06
        flowerGroup.add(cen)
        group.add(flowerGroup)
      }
      scene.add(group)
      lilies.push({ group, flowerGroup, petals, phase: q(), period: 12 + q() * 10, bob: q() * 6.2832 })
    }
  }
  const _pQ = new THREE.Quaternion(), _pR = new THREE.Quaternion()
  const _yAx = new THREE.Vector3(0, 1, 0), _xAx = new THREE.Vector3(1, 0, 0)
  function updateLilies() {
    const y0 = ht + curTide
    for (let i = 0; i < lilies.length; i++) {
      const L = lilies[i]
      // Hoja al ras del agua (+3cm para no pelear con el plano) y sigue la marea.
      L.group.position.y = y0 + 0.03 + Math.sin(clock * 0.8 + L.bob) * 0.04
      if (!L.flowerGroup) continue
      // Floración (alikim: q = quaternFromETh(e, -th - bloom)): el bloom se SUMA
      // a la inclinación base de cada banda, no la reemplaza. Así los sépalos
      // verdes (th grande) siguen abiertos SIEMPRE → el collar de hojas que
      // envuelve el loto no se pierde al cerrar; sólo los pétalos internos
      // (th chico) suben a capullo. Al abrir, todos se inclinan +bloom y se encogen.
      const o = 0.5 - 0.5 * Math.cos((clock / L.period + L.phase) * 6.2832) // 0 cerrado → 1 abierto
      const bloom = -0.1 + o                        // alikim: [-0.1, 0.9]
      const petScale = 1 - 0.34 * o
      for (const P of L.petals) {
        const spread = Math.max(0.05, P.th + bloom) // th de banda + bloom; sépalos quedan abiertos
        _pR.setFromAxisAngle(_yAx, P.az)
        _pQ.setFromAxisAngle(_xAx, spread)
        P.m.quaternion.multiplyQuaternions(_pR, _pQ)
        P.m.scale.setScalar(petScale)
      }
    }
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

  // CARDUMEN DE KOI anónimo cerca de la superficie (además de los koi con nombre):
  // boids propio, bordea las islas. Los koi con nombre salen del censo (arriba).
  const koiObs = lobes.map((L) => ({ x: L.x, z: L.z, r: Math.max(L.rx, L.rz) * 1.1 + 2 }))
  const koiSchool = createKoiSchool(scene, 24, q, {
    radius: mt * 0.82, surfaceY: ht + 0.1, floorY: ht - 6.5, obstacles: koiObs,
    wake: (x, z, s) => spawnRipple(x, z, s), // estela de agua al nadar en superficie
  })

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

  // Garzas: la mayor parte del tiempo VUELAN o se POSAN en una piedra; sólo de
  // vez en cuando bajan a pescar. Estados: 'fly' | 'perch' | 'strike'.
  function heronPerch() {
    const L = lobes[q() * lobes.length | 0]
    const ang = q() * 6.2832, t = 0.2 + q() * 0.5
    const px = L.x + Math.cos(ang) * L.rx * t, pz = L.z + Math.sin(ang) * L.rz * t
    const top = lobeTop(px, pz)
    return { x: px, z: pz, y: (top > -Infinity ? top : ht) + 1.2 }
  }
  function huntHerons(step, predations, eco) {
    const F = fish.state.fish
    // Refugio con lluvia (paridad con ciudad/bosque vía sim/perch.js): a más
    // lluvia, las garzas prefieren quedarse posadas y casi no salen a pescar.
    // Con rain=0 (o sin eco) todo queda idéntico al comportamiento seco.
    const shelter = (eco && eco.rain) || 0
    for (let i = 0; i < n; i++) {
      const a = agents[i]
      if (!a.hunter) continue
      a.stateT -= step
      if (a.hstate === 'strike') {
        a.striking -= step
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
        if (a.striking <= 0) { a.hstate = 'fly'; a.stateT = 6 + q() * 8 }
      } else if (a.hstate === 'perch') {
        // Quieta sobre la piedra (con leve balanceo). No deambula.
        worldPos[i * 3] += (a.perch.x - worldPos[i * 3]) * 0.12
        worldPos[i * 3 + 2] += (a.perch.z - worldPos[i * 3 + 2]) * 0.12
        worldPos[i * 3 + 1] = a.perch.y + Math.sin(clock * 1.3 + a.idx) * 0.08
        roamers[i].x = worldPos[i * 3] / LR; roamers[i].z = worldPos[i * 3 + 2] / LR
        roamers[i].vx *= 0.8; roamers[i].vz *= 0.8
        if (a.stateT <= 0) {
          // Si llueve, se quedan refugiadas otro rato en vez de salir a volar.
          if (q() < shelter) a.stateT = 4 + q() * 6
          else { a.hstate = 'fly'; a.stateT = 5 + q() * 7 }
        }
      } else { // 'fly' — vuela normal; al terminar decide qué hacer
        if (a.stateT <= 0) {
          const r = q()
          // Con lluvia crece la prob. de posarse (hasta ~0.85) y la ventana de
          // pesca se cierra: seco → 0.35/0.50 (idéntico al original).
          const perchP = 0.35 + shelter * 0.5
          const strikeP = perchP + 0.15 * (1 - shelter)
          if (r < perchP) {          // posarse en una piedra
            a.hstate = 'perch'; a.perch = heronPerch(); a.stateT = 5 + q() * 8
          } else if (r < strikeP) {  // ir a pescar (ocasional)
            let best = -1, bestD = 55
            for (let fi = 0; fi < F.length; fi++) {
              const d = Math.hypot(F[fi].x * mt - worldPos[i * 3], F[fi].z * mt - worldPos[i * 3 + 2])
              if (d < bestD) { bestD = d; best = fi }
            }
            if (best >= 0) { a.hstate = 'strike'; a.striking = 0.7; a.struck = false; a.targetFish = best }
            else a.stateT = 2 + q() * 3
          } else { a.stateT = 4 + q() * 6 } // seguir volando
        }
      }
    }
  }

  // Un agente ave, de vez en cuando, SUBE a cruzar el cielo bien alto y vuelve.
  // Es un agente real (con nombre del censo, estela y etiqueta) — no un adorno.
  function crossSky(step) {
    for (let i = 0; i < n; i++) {
      const a = agents[i]
      if (!a.skyer) continue
      if (a.crossing > 0) {
        a.crossing -= step
        const k = 1 - Math.max(0, a.crossing) / a.crossDur       // 0 → 1
        // Arco alto: sube y baja (medio seno), pico ~ht+30..42.
        worldPos[i * 3 + 1] = ht + Math.sin(Math.min(1, k) * Math.PI) * (30 + a.crossHi)
        // Empuja su rumbo hacia el borde opuesto para que de verdad cruce.
        const r = roamers[i]
        const dx = a.crossTx - worldPos[i * 3], dz = a.crossTz - worldPos[i * 3 + 2], dd = Math.hypot(dx, dz) || 1
        r.vx += dx / dd * 0.5 * step; r.vz += dz / dd * 0.5 * step
        if (a.crossing <= 0) a.crossCool = 16 + q() * 34
      } else {
        a.crossCool -= step
        if (a.crossCool <= 0) {
          const ang = Math.atan2(worldPos[i * 3 + 2], worldPos[i * 3]) + Math.PI + (q() - 0.5)
          a.crossTx = Math.cos(ang) * mt * 1.3; a.crossTz = Math.sin(ang) * mt * 1.3
          a.crossHi = q() * 12; a.crossDur = 6 + q() * 4; a.crossing = a.crossDur
        }
      }
    }
  }

  // Aves NO cazadoras: planean sobre el agua (altura la pone mapPositions) y de a
  // ratos bajan a posarse en una piedra, como las garzas pero sin pescar.
  function updateBirds(step) {
    for (let i = 0; i < n; i++) {
      const a = agents[i]
      if (!a.isBird || a.hunter || a.skyer) continue
      a.birdT -= step
      if (a.perching) {
        worldPos[i * 3] += (a.perchPos.x - worldPos[i * 3]) * 0.1
        worldPos[i * 3 + 2] += (a.perchPos.z - worldPos[i * 3 + 2]) * 0.1
        worldPos[i * 3 + 1] = a.perchPos.y + Math.sin(clock * 1.3 + a.idx) * 0.08
        roamers[i].x = worldPos[i * 3] / LR; roamers[i].z = worldPos[i * 3 + 2] / LR
        roamers[i].vx *= 0.8; roamers[i].vz *= 0.8
        if (a.birdT <= 0) { a.perching = false; a.birdT = 6 + q() * 8 }
      } else if (a.birdT <= 0) {
        if (q() < 0.4) { a.perching = true; a.perchPos = heronPerch(); a.birdT = 5 + q() * 7 }
        else a.birdT = 4 + q() * 6
      }
    }
  }

  // Deambular sobre el agua: roamers normalizados → radio de laguna.
  const roamers = createRoamers(cfg.wander, n, q)
  const extraRoamers = createRoamers(cfg.wander, EXTRA, q)
  const LR = mt * 1.05
  // Obstáculos: las islas. Los agentes las bordean (no las atraviesan).
  const islandObs = lobes.map((L) => ({ x: L.x / LR, z: L.z / LR, r: (Math.max(L.rx, L.rz) * 1.06) / LR }))
  const worldPos = new Float32Array(n * 3)
  let simTime = 0
  function mapPositions(dt, t) {
    simTime += dt
    updateRoamers(roamers, cfg.wander, dt, q, simTime, null, null, islandObs)
    updateRoamers(extraRoamers, cfg.wander, dt, q, simTime + 31.7, null, null, islandObs)
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
      let j
      if (a.isBird) {
        // Aves: planean SOBRE el agua (huntHerons/crossSky bajan a cazar/cruzar).
        j = ht + 3 + a.homeY * 0.3 + Math.sin(t * 1.1 + a.idx * 2.1) * (0.5 + a.hover * 0.1)
      } else if (a.isKoi) {
        // Koi: justo en la superficie, para que se vean (no bajo el agua brillante).
        j = ht + 0.1 + Math.sin(t * 1.4 + a.idx * 2.1) * 0.12
      } else {
        // Fauna acuática/ribera glow: bucea/planea bajo el agua (spec §4.3).
        j = ht - a.dive + a.homeY * 0.3 + Math.sin(t * 1.4 + a.idx * 2.1) * (0.34 + a.hover * 0.12)
        if (j < bedY + 0.9) j = bedY + 0.9
      }
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
  let rippleTimer = 0, dropTimer = 0
  function spawnRipple(x, z, str, radius) {
    // Inyecta una gota en la simulación de altura → onda real que se propaga.
    waterSim.drop(x, z, str * 0.14, radius)
  }
  // Siembra las ondas AMBIENTE (la sim propaga; acá solo se decide dónde/cuándo).
  function seedRipples(step) {
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
      // Los extras glow nadan justo bajo la superficie → también mueven el agua
      // (las aves ahora planean arriba y no la tocan salvo al picar).
      for (let t = 0; t < 8 && spawned < 8; t++) {
        const e = extras[q() * EXTRA | 0], p = e.group.position
        if (Math.abs(p.y - ht) > 2.4) continue
        spawnRipple(p.x, p.z, 0.4 + q() * 0.2)
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
    // El oleaje de AGITAR decae en ~3s.
    if (waterUniforms.uAgitate.value > 0) waterUniforms.uAgitate.value = Math.max(0, waterUniforms.uAgitate.value - step * 0.38)
    if (eco) scene.fog.density = 0.0009 + eco.fog * 0.0028

    // Marea lenta: dos senos → el nivel sube y baja de forma orgánica (~±0.55).
    // El plano de agua sigue la marea; troncos y nenúfares leen curTide.
    curTide = Math.sin(clock * 0.11) * 0.4 + Math.sin(clock * 0.043 + 1.3) * 0.16
    if (waterMesh) waterMesh.position.y = curTide

    const predations = []
    mapPositions(step, clock)
    fish.update(step, clock)      // mueve los peces primero
    huntHerons(step, predations, eco)  // garzas pican (puede sobreescribir su y)
    crossSky(step)                // un ave cruza el cielo alto de vez en cuando
    updateBirds(step)             // aves no cazadoras planean y se posan (no nadan)
    updateBugs(step, clock)
    updateFrogs(step)
    updateLogs(step, clock)
    updateLilies()
    koiSchool.update(step, clock)
    fishEatBugs()
    for (let i = 0; i < n; i++) {
      const a = agents[i], r = roamers[i]
      const y = worldPos[i * 3 + 1]
      a.group.position.set(worldPos[i * 3], y, worldPos[i * 3 + 2])
      // KOI: mira hacia donde nada, coletea, y deja estela al nadar en superficie.
      if (a.isKoi) {
        a.group.rotation.set(0, Math.atan2(-r.vz, r.vx), 0)
        swimKoi(a, clock)
        a.group.scale.setScalar(a.baseScale * (1 + (swarm ? swarm.flash[i] : 0) * 0.35))
        a.wakeT -= step
        if (a.wakeT <= 0) { spawnRipple(worldPos[i * 3], worldPos[i * 3 + 2], 0.4); a.wakeT = 0.5 + q() * 0.5 }
        continue
      }
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

    seedRipples(step)            // siembra gotas (agentes/extras/peces cerca del tope)
    waterSim.update()            // paso de la simulación de altura (propaga/rebota)
    waterUniforms.uHeight.value = waterSim.texture // el ping-pong cambia la textura
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
    koiSchool.scatter(strength)
    // AGITAR sacude TODA el agua: oleaje global (uAgitate) + un anillo central
    // fuerte y varios repartidos que barren la laguna.
    waterUniforms.uAgitate.value = Math.min(1.6, 0.9 + strength * 0.6)
    spawnRipple(0, 0, 1.5 * strength)
    for (let kk = 0; kk < 8; kk++) {
      const a = q() * 6.2832, rr = Math.sqrt(q()) * mt * 0.9
      spawnRipple(Math.cos(a) * rr, Math.sin(a) * rr, 0.8 + strength * 0.5)
    }
  }

  return {
    update, scare, setPointer,
    flash: stage.flash, resize: stage.resize, dispose: stage.dispose,
    camera: stage.camera, controls: stage.controls,
  }
}
