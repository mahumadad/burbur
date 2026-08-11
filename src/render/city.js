import * as THREE from 'three'
import { createStage } from './stage.js'
import { createHaze } from './engine/haze.js'
import { createRain, createSnow, createSnowCaps } from './engine/weather.js'
import { createDraw } from './engine/points.js'
import { createAgentKit } from './engine/agents3d.js'
import { createTrails } from './engine/trails.js'
import { cityGrid } from './cityGrid.js'
import { fbm, noise2 } from './noise.js'
import { createBoxBuilder, rgbToHex, shadeGeometry } from './boxbuilder.js'
import { PALETTE } from '../config.js'
import { CITY_CENSUS } from '../sim/agents.js'
import { createRoamers, updateRoamers } from '../sim/wander.js'
import { createPerchers, updatePerchers } from '../sim/perch.js'

const rnd = Math.random
// Selección aleatoria uniforme de un elemento de un arreglo (paletas, colores).
function pick(arr) { return arr[(rnd() * arr.length) | 0] }

// Constantes de paridad (reversed del bundle original, tabla `hg`/geometría de ciudad):
//   Wt = medio-lado de la cuadrícula, Gt = ancho de calle, Kt = altura de bordillo,
//   we = nivel de suelo de la calle. R_CITY = radio aproximado del bloque.
const Wt = 62, Gt = 13, Kt = 2.4, we = -4
const R_CITY = Wt * 1.18
// `qt` del original: mitad de calzada útil para tráfico (spawn/rejoin de agentes).
const qt = Wt * 0.85
// `p.streets` en el bundle original vale 2 (no está en CONFIG del proyecto):
// valor de paridad fijo, no expuesto todavía como opción.
const STREETS = 2

// Paleta de edificios (`$t` en el bundle original), 6 colores RGB exactos.
const BUILDING_PALETTE = [
  [0.99, 0.86, 0.66],   // crema/arena
  [1, 0.58, 0.14],      // naranja
  [0.985, 0.71, 0.52],  // durazno
  [0.72, 0.55, 0.96],   // lavanda
  [1, 0.84, 0.79],      // rosa pálido
  [0.99, 0.45, 0.12],   // rojo-naranja
]
// Color de la neblina de la ciudad (acento naranja, a diferencia del azul
// frío del bosque en `cfg.render.hazeColor`).
const CITY_HAZE_COLOR = [1, 0.48, 0.12]
// `p.towers` del original: multiplicador global de la probabilidad de torre
// por bloque. Valor de paridad = 1 (no expuesto como opción todavía).
const TOWERS = 1
// `p.grass`/`p.flowers` del original: multiplicadores globales de densidad
// de pasto y flores. Valores de paridad = 1 (no expuestos todavía).
const GRASS = 1
const FLOWERS = 1

// Mundo CIUDAD ("Block ecosystem"). Usa el stage compartido; el suelo es el
// puerto fiel de `pn`/`mn`/`ln` del bundle original: retícula 150×150 con
// altura y color por SDF a manzana redondeada, más "polvo" suelto (sin
// wireframe: el original no le pone uno). Edificios, agentes y clima
// llegan en tareas posteriores.
export function createCityScene(container, cfg, agentNames = []) {
  const rc = cfg.render
  const stage = createStage(container, cfg)
  const { scene, camera, labelEl } = stage
  const draw = createDraw(rc)

  // Puntos de interés registrados para tareas siguientes (coordenadas
  // normalizadas por R_CITY, igual que el bosque normaliza por su radio):
  // cima de cada torre para que los agentes se posen ahí (Task 13/B8) y
  // posiciones de techo para que la nieve los cubra (Task 14/B9).
  const poiPerch = []
  const capPos = []
  // Materiales pintables por hora del día/clima (equivalente a `snowMats` del
  // bosque, pero sin acumulación de nieve en el suelo): suelo, pasto y flores.
  let groundMat, grassMat, floraMat

  // Retícula de calles → manzanas (`tn` del bundle real). Se mantiene en el
  // scope de la factory: las tareas siguientes (edificios, pasto, polvo,
  // rutas de agentes) la necesitan para saber qué es calle y qué es manzana.
  const grid = cityGrid({ Wt, Gt, streets: STREETS, palette: BUILDING_PALETTE }, rnd)
  const blocks = grid.blocks   // `Xt` del original: manzanas {cx,cz,hx,hz,cr,tint,area}.
  const cutsX = grid.cutsX     // `Jt` del original: centros de calle en X.
  const cutsZ = grid.cutsZ     // `Yt` del original: centros de calle en Z.
  // `Zt` del original: edificios ya colocados (colisión + brillo). Las
  // tareas de edificios (P4/P5) lo van llenando; acá arranca vacío porque
  // el suelo (mn/fn) ya tiene que poder leerlo aunque todavía no haya nada.
  const placed = []
  // `w` del original: puntos a evitar por el polvo suelto de manzana/calle
  // (P6, pendiente). Lo llenan yn (torres) y, más adelante, Sn/wn.
  const dustAvoid = []

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  // `St(a,b,x)` del original: smoothstep clásico.
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
  // `Fe(x,z)` del original: "fertilidad" — ruido fbm normalizado a [0,1] con
  // un umbral (.34) y una escala (.36) fijos, reusado por el color de calle
  // sucia (mn) y luego por pasto/flores (P6).
  function fertility(x, z) {
    return clamp((fbm(x * 0.045 + 21, z * 0.045 + 9, 3) - 0.34) / 0.36, 0, 1)
  }

  // `nn(block,x,z)` del original: SDF a rectángulo redondeado (negativo = adentro).
  function nn(block, x, z) {
    const r = Math.abs(x - block.cx) - (block.hx - block.cr)
    const i = Math.abs(z - block.cz) - (block.hz - block.cr)
    const a = Math.max(r, 0), o = Math.max(i, 0)
    return Math.sqrt(a * a + o * o) + Math.min(Math.max(r, i), 0) - block.cr
  }
  // `rn(x,z)` del original: manzana más cercana → {d: distancia con signo, i: índice}.
  function rn(x, z) {
    let d = 1e9, idx = 0
    for (let i = 0; i < blocks.length; i++) {
      const a = nn(blocks[i], x, z)
      if (a < d) { d = a; idx = i }
    }
    return { d, i: idx }
  }
  // `an(x,z)` del original: distancia con signo a la manzana más cercana
  // (negativa adentro, positiva en la calle).
  function an(x, z) { return rn(x, z).d }
  // `on(x,z,out)` del original: gradiente de `an` (normal hacia el borde
  // más cercano), por diferencias finitas. Lo usan Cn/wn (mobiliario, P5).
  function on(x, z, out) {
    const r = 0.6
    const i = an(x + r, z) - an(x - r, z)
    const a = an(x, z + r) - an(x, z - r)
    const o = Math.hypot(i, a) || 1
    out.x = i / o
    out.z = a / o
    return out
  }
  // `sn(e)` del original: máscara de manzana (1 adentro, 0 en la calle),
  // smoothstep sobre la distancia con signo con un ancho de transición de 3.2.
  function sn(e) { const t = clamp(-e / 3.2, 0, 1); return t * t * (3 - 2 * t) }
  // `cn(x,z)` del original: ruido de bordillo (textura fina de la manzana).
  function cn(x, z) { return (fbm(x * 0.05 + 9.1, z * 0.05 - 4.7, 2) - 0.5) * 0.6 }
  // `ln(x,z)` del original: ALTURA DEL SUELO. we (nivel de calle) en la
  // calle, we+Kt+ruido en la manzana (bordillo elevado), con sn de por medio.
  function ln(x, z) { return we + (Kt + cn(x, z)) * sn(an(x, z)) }
  // `un(x,z,m)` del original: ¿(x,z) colisiona con algún edificio ya
  // colocado (con margen m)? Usa `placed` (Zt).
  function un(x, z, m) {
    for (let r = 0; r < placed.length; r++) {
      const p = placed[r]
      if (Math.abs(x - p.cx) < p.hx + m && Math.abs(z - p.cz) < p.hz + m) return true
    }
    return false
  }
  // `xn(x,z)` del original: ¿(x,z) está cerca de una calle? (dist a algún
  // corte de calle Jt/Yt < Gt*.85). La usa el mobiliario (Sn/Cn/wn) para
  // pegarse al borde de la manzana que da a la calle.
  function xn(x, z) {
    for (let n = 0; n < cutsX.length; n++) if (Math.abs(x - cutsX[n]) < Gt * 0.85) return true
    for (let n = 0; n < cutsZ.length; n++) if (Math.abs(z - cutsZ[n]) < Gt * 0.85) return true
    return false
  }
  // `fn(x,z)` del original: proximidad (0..1) al edificio más cercano de
  // `placed`, para el "glow" de calle cerca de la base de una torre.
  function fn(x, z) {
    let n = 0
    for (let r = 0; r < placed.length; r++) {
      const p = placed[r]
      const a = Math.max(Math.abs(x - p.cx) - p.hx, 0)
      const o = Math.max(Math.abs(z - p.cz) - p.hz, 0)
      const s = 1 - clamp(Math.hypot(a, o) / 6, 0, 1)
      if (s > n) n = s
    }
    return n
  }
  // `mn(x,z,out)` del original: COLOR DE VÉRTICE DEL SUELO. Tinte de la
  // manzana (out) mezclado con calle oscura desaturada hacia el centro,
  // "polvo" naranja cerca de manzanas/edificios (Fe + fbm) y un leve glow
  // cálido cerca de edificios (fn). Escribe en `out` (array [r,g,b]) y
  // devuelve la máscara de manzana `o` (la misma que usa `ln` para la altura).
  function mn(x, z, out) {
    const r = rn(x, z)
    const i = r.d
    const a = blocks[r.i].tint
    const o = sn(i)
    let s = 1 - smoothstep(Wt * 0.58, Wt * 1.04, Math.hypot(x, z))
    s = 0.1 + 0.9 * s
    const c = i > 0 ? Math.exp(-i / 4.4) : 1
    const l = c * c
    const u = 0.028 + 0.4 * l
    const d = 0.024 + 0.225 * l
    const f = 0.022 + 0.078 * l
    const p = fertility(x, z)
    const m = 0.34 + 0.34 * fbm(x * 0.11 + 5, z * 0.11 - 7, 2)
    let h = clamp((fbm(x * 0.06 + 3.7, z * 0.06 + 11.2, 3) - 0.52) * 3.2, 0, 1) * o
    h = Math.max(h, fn(x, z) * 0.75 * o)
    let g = clamp(1 + i / 5, 0, 1)
    g *= g
    let cr = a[0] * m, cg = a[1] * m, cb = a[2] * m
    cr = cr * (1 - h) + (0.09 + 0.14 * p) * h
    cg = cg * (1 - h) + (0.24 + 0.18 * p) * h
    cb = cb * (1 - h) + (0.045 + 0.05 * p) * h
    cr += g * 0.24
    cg += g * 0.14
    cb += g * 0.05
    out[0] = (u + (cr - u) * o) * s
    out[1] = (d + (cg - d) * o) * s
    out[2] = (f + (cb - f) * o) * s
    return o
  }
  // `En()` del original: manzana al azar ponderada por área (más área ⇒ más
  // probable). La usa `pn` para sembrar el "polvo" de manzana.
  function En() {
    let total = 0
    for (let t = 0; t < blocks.length; t++) total += blocks[t].area
    let n = rnd() * total
    for (let t = 0; t < blocks.length; t++) {
      n -= blocks[t].area
      if (n <= 0) return blocks[t]
    }
    return blocks[blocks.length - 1]
  }

  // ─── SUELO: `pn()` del bundle real, port textual ───────────────────────
  // Grilla 150×150 sobre un cuadrado de lado Wt*2.35, altura = ln, color =
  // mn (por vértice). El original NO usa THREE.PlaneGeometry: arma posición
  // e índice a mano, con la diagonal del quad alternada en tablero de ajedrez
  // (evita el sesgo direccional que deja una PlaneGeometry estándar). Encima,
  // dos pasadas de puntos sueltos (no por `draw`, como indica la guía de
  // puerto): "polvo" de manzana (20000, color = mn) y "polvo" de calle
  // (6500, tono naranja tenue cerca del bordillo). No hay wireframe: el
  // look "matrix" de la ciudad lo dan estos puntos, no una malla visible.
  function pn() {
    const segs = 150
    const side = Wt * 2.35
    const half = side / 2
    const vcount = (segs + 1) * (segs + 1)
    const positions = new Float32Array(vcount * 3)
    const colors = new Float32Array(vcount * 3)
    const tmpCol = [0, 0, 0]
    for (let i = 0; i <= segs; i++) {
      for (let r = 0; r <= segs; r++) {
        const idx = i * (segs + 1) + r
        const x = -half + (r / segs) * side
        const z = -half + (i / segs) * side
        const f = mn(x, z, tmpCol)
        positions[idx * 3] = x
        // Misma fórmula que `ln(x,z)`, pero reusando la máscara `f` que ya
        // calculó `mn` (evita recalcular rn/an dos veces por vértice).
        positions[idx * 3 + 1] = we + (Kt + cn(x, z)) * f
        positions[idx * 3 + 2] = z
        colors[idx * 3] = tmpCol[0]
        colors[idx * 3 + 1] = tmpCol[1]
        colors[idx * 3 + 2] = tmpCol[2]
      }
    }
    const indices = new Uint16Array(segs * segs * 6)
    let m = 0
    for (let i = 0; i < segs; i++) {
      for (let r = 0; r < segs; r++) {
        const h = i * (segs + 1) + r, g = h + 1, _ = h + (segs + 1), v = _ + 1
        if ((r + i) % 2 === 0) {
          indices[m++] = h; indices[m++] = _; indices[m++] = g
          indices[m++] = g; indices[m++] = _; indices[m++] = v
        } else {
          indices[m++] = h; indices[m++] = _; indices[m++] = v
          indices[m++] = h; indices[m++] = v; indices[m++] = g
        }
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.setIndex(new THREE.BufferAttribute(indices, 1))
    groundMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true })
    scene.add(new THREE.Mesh(geo, groundMat))

    // Polvo de manzana: 20000 puntos sembrados alrededor de una manzana al
    // azar (ponderada por área, `En`), descartados si caen muy lejos del
    // borde (SDF>0.4) o si el color de suelo ahí es casi calle pura (o<0.12).
    const blockDustN = 20000
    const streetDustN = 6500
    const total = blockDustN + streetDustN
    const dpos = new Float32Array(total * 3)
    const dcol = new Float32Array(total * 3)
    let c = 0
    for (let budget = blockDustN * 3; c < blockDustN && budget-- > 0;) {
      const b = En()
      const x = b.cx + (rnd() * 2 - 1) * (b.hx + 1)
      const z = b.cz + (rnd() * 2 - 1) * (b.hz + 1)
      if (nn(b, x, z) > 0.4) continue
      if (mn(x, z, tmpCol) < 0.12) continue
      const bright = rnd() < 0.78 ? 0.42 + rnd() * 0.28 : 1.18
      const t = c * 3
      dpos[t] = x
      dpos[t + 1] = ln(x, z) + 0.07
      dpos[t + 2] = z
      dcol[t] = Math.min(1, tmpCol[0] * bright)
      dcol[t + 1] = Math.min(1, tmpCol[1] * bright)
      dcol[t + 2] = Math.min(1, tmpCol[2] * bright)
      c++
    }
    // Polvo de calle: 6500 puntos naranjas tenues, más densos cerca del
    // bordillo (exp(-dist/3.4)) y descartados lejos de toda manzana (dist>8).
    let j = 0
    for (let budget = streetDustN * 8; j < streetDustN && budget-- > 0;) {
      const x = (rnd() * 2 - 1) * Wt
      const z = (rnd() * 2 - 1) * Wt
      const d = an(x, z)
      if (d < 0.3 || d > 8) continue
      const fall = Math.exp(-d / 3.4)
      if (rnd() > fall) continue
      const I = (0.25 + rnd() * 0.6) * fall
      const t = (c + j) * 3
      dpos[t] = x
      dpos[t + 1] = we + 0.07
      dpos[t + 2] = z
      dcol[t] = 0.02 + 0.45 * I
      dcol[t + 1] = 0.016 + 0.25 * I
      dcol[t + 2] = 0.013 + 0.09 * I
      j++
    }
    const total2 = c + j
    const dgeo = new THREE.BufferGeometry()
    dgeo.setAttribute('position', new THREE.BufferAttribute(dpos.slice(0, total2 * 3), 3))
    dgeo.setAttribute('color', new THREE.BufferAttribute(dcol.slice(0, total2 * 3), 3))
    const dustMat = new THREE.PointsMaterial({ vertexColors: true, size: 0.12, sizeAttenuation: true, fog: true })
    const dustPts = new THREE.Points(dgeo, dustMat)
    dustPts.frustumCulled = false
    scene.add(dustPts)
  }
  pn()

  // ─── EDIFICIOS (torres): puerto fiel de `yn` (constructor, 3 arquetipos)
  // y `bn` (colocación por bloque) ─────────────────────────────────────────
  // A diferencia de una interpretación en losas translúcidas apiladas, la
  // torre real es un conjunto SÓLIDO de cajas armado con el box builder
  // (`gn`/createBoxBuilder): el look "matrix" en capas lo da enteramente
  // `finish(tint,'lichen')` (malla MeshBasicMaterial opacity .42 depthWrite
  // false + nube de puntos ámbar), no un material aditivo aparte. Tres
  // arquetipos elegidos por `m=rnd()`:
  //   m<.36  columnata: losa base + columnas perimetrales + N pisos con
  //          columnas cortas entre losas + remate.
  //   m<.64  racimo de pilares: grid de pilares con "capitel" (aro ancho) +
  //          aros de piso apilados + cornisa perimetral arriba.
  //   else   muros con aletas: N muros paralelos en Z con aletas verticales
  //          + un muro central (a veces doble, más bajo).
  // Remates comunes a los tres: caja de techo (70% prob.) y antena (60%).
  function spawnTower(block) {
    const t = block.hx * 2, n = block.hz * 2
    const r = Math.min(t - 6, 10 + rnd() * 16)
    const i = Math.min(n - 6, 9 + rnd() * 13)
    if (r < 7 || i < 7) return false

    // Hasta 8 intentos de ubicar la torre sin pisar otra ya colocada.
    let a = 0, o = 0, ok = false
    for (let c = 0; c++ < 8 && !ok; ) {
      a = block.cx + (rnd() - 0.5) * (t - r - 5)
      o = block.cz + (rnd() - 0.5) * (n - i - 5)
      ok = true
      for (let l = 0; l < placed.length; l++) {
        const u = placed[l]
        if (Math.abs(a - u.cx) < r / 2 + u.hx + 2.5 && Math.abs(o - u.cz) < i / 2 + u.hz + 2.5) {
          ok = false
          break
        }
      }
    }
    if (!ok) return false

    const d = we + Kt + 0.2
    const tint = rnd() < 0.66 ? block.tint : BUILDING_PALETTE[(rnd() * BUILDING_PALETTE.length) | 0]
    const p = createBoxBuilder(rnd)
    const m = rnd()
    let h
    const x = r / 2, S = i / 2
    const C = rnd() < 0.22 ? 1.7 + rnd() * 1.1 : 1

    if (m < 0.36) {
      const T = 5.5 + rnd() * 2.5
      const E = Math.round((2 + (rnd() * 3 | 0)) * C)
      const D = 4.2 + rnd() * 1.6
      const O = T + E * D
      h = 0.8 + O + 1.1
      p.box(r, 0.8, i, a, d + 0.4, o)
      const k = 3.8 + rnd() * 1.2
      for (let v = -x + 1.1; v <= x - 1; v += k) {
        p.box(1.2, T, 1.2, a + v, d + 0.8 + T / 2, o - S + 0.7)
        p.box(1.2, T, 1.2, a + v, d + 0.8 + T / 2, o + S - 0.7)
      }
      for (let y = -S + 1.1 + k; y <= S - 1.1 - k * 0.5; y += k) {
        p.box(1.2, T, 1.2, a - x + 0.7, d + 0.8 + T / 2, o + y)
        p.box(1.2, T, 1.2, a + x - 0.7, d + 0.8 + T / 2, o + y)
      }
      for (let f = 0; f < E; f++) {
        const A = d + 0.8 + T + f * D
        p.box(r, 1.1, i, a, A + 0.55, o)
        for (let v = -x + 0.9; v <= x - 0.8; v += 2.6) {
          p.box(0.9, D - 1.1, 0.9, a + v, A + 1.1 + (D - 1.1) / 2, o - S + 0.5)
          p.box(0.9, D - 1.1, 0.9, a + v, A + 1.1 + (D - 1.1) / 2, o + S - 0.5)
        }
      }
      p.box(r, 1.1, i, a, d + 0.8 + O + 0.55, o)
      p.box(r - 4.5, O * 0.9, i - 4.5, a, d + 0.8 + O / 2, o)
    } else if (m < 0.64) {
      const j = Math.round((3 + (rnd() * 3 | 0)) * C)
      const M = 4.4 + rnd() * 1.6
      h = j * (M + 1.3)
      const N = 2 + (rnd() * 2 | 0)
      const P = 2.1 + rnd() * 0.9
      for (let g = 0; g < N; g++) {
        for (let zi = 0; zi < 2; zi++) {
          const F = a - x + 2.4 + g * (r - 4.8) / (N - 1)
          const I = o - S + 2.4 + zi * (i - 4.8)
          for (let b = 0; b < j; b++) {
            const L = d + b * (M + 1.3)
            p.box(P, M, P, F, L + M / 2, I)
            p.box(P + 1.6, 1, P + 1.6, F, L + M - 0.5, I)
          }
        }
      }
      for (let b = 1; b <= j; b++) p.box(r, 1.3, i, a, d + b * (M + 1.3) - 0.65, o)
      const R = d + h + 0.35
      p.box(r, 0.7, 0.5, a, R, o - S + 0.25)
      p.box(r, 0.7, 0.5, a, R, o + S - 0.25)
      p.box(0.5, 0.7, i, a - x + 0.25, R, o)
      p.box(0.5, 0.7, i, a + x - 0.25, R, o)
    } else {
      h = (15 + rnd() * 13) * C
      const wallCount = 2 + +(rnd() < 0.4)
      const B = 4.4 + rnd() * 1.8
      for (let g = 0; g < wallCount; g++) {
        const V = -S + B / 2 + g * (i - B) / (wallCount - 1)
        p.box(r, h, B, a, d + h / 2, o + V)
        for (let v = -x + 1; v <= x - 0.9; v += 2.4) {
          p.box(0.8, h * 0.92, 0.7, a + v, d + h * 0.46, o + V - B / 2 - 0.32)
          p.box(0.8, h * 0.92, 0.7, a + v, d + h * 0.46, o + V + B / 2 + 0.32)
        }
      }
      const ee = 4.2 + rnd() * 1.6
      const H = (rnd() - 0.5) * (r - ee) * 0.6
      p.box(ee, h, i, a + H, d + h / 2, o)
      if (rnd() < 0.4) p.box(ee, h * 0.8, i, a - H, d + h * 0.4, o)
    }

    if (rnd() < 0.7) {
      p.box(2.2 + rnd() * 2, 1.6 + rnd() * 1.2, 2 + rnd() * 2, a + (rnd() - 0.5) * r * 0.4, d + h + 0.8, o + (rnd() - 0.5) * i * 0.4)
    }
    if (rnd() < 0.6) {
      p.box(0.22, (3.5 + rnd() * 2.5) * (C > 1 ? 1.5 : 1), 0.22, a + (rnd() - 0.5) * r * 0.5, d + h + 2.2, o + (rnd() - 0.5) * i * 0.5)
    }

    scene.add(p.finish(tint, 'lichen'))
    placed.push({ cx: a, cz: o, hx: x, hz: S })
    dustAvoid.push({ x: a, z: o, r: Math.min(x, S) * 0.95 })
    // Bookkeeping fuera del bundle original: percha para agentes (B8) y
    // posición de capa de nieve (B9), tareas todavía pendientes.
    poiPerch.push({ x: a / R_CITY, z: o / R_CITY, h: d + h - we })
    capPos.push(a, d + h, o)
    return true
  }

  // `bn` del original: por bloque, probabilidad de torre según su tamaño
  // (más área ⇒ más probable); los bloques muy grandes pueden recibir una
  // 2ª torre desplazada. Si la mala suerte del rnd dejó todo vacío, fuerza
  // una torre en el bloque de mayor área.
  function placeTowers() {
    const e = TOWERS
    for (let t = 0; t < blocks.length; t++) {
      const n = blocks[t]
      const r = Math.min(n.hx, n.hz) * 2
      const i = (r >= 20 ? 0.85 : r >= 14 ? 0.5 : 0.2) * e
      if (rnd() < i) spawnTower(n)
      if (r >= 40 && rnd() < 0.6 * Math.min(e, 1.5)) spawnTower(n)
    }
    if (!placed.length && blocks.length && e > 0) {
      const sorted = blocks.slice().sort((x, y) => y.area - x.area)
      for (let o = 0; o < sorted.length && !spawnTower(sorted[o]); o++);
    }
  }
  placeTowers()

  // ─── Sn: GRÚAS/CANTILEVER — puerto fiel ────────────────────────────────
  // 3–6 estructuras (poste + mástil + brazo angulado + riostra diagonal +
  // remates en la punta) pegadas al borde de una manzana que da a la
  // calle. Se arman con el box builder y se sombrean por vértice
  // (`finish(tint, false)`), igual que las grúas del bundle real.
  function Sn() {
    const count = 3 + ((rnd() * 3) | 0) // 3..6
    let built = 0, tries = 0
    while (built < count && tries++ < 90) {
      const block = blocks[(rnd() * blocks.length) | 0]
      const i = rnd() < 0.5 ? -1 : 1
      const a = rnd() < 0.5 ? -1 : 1
      let ox = block.cx + i * (block.hx - block.cr * 0.55)
      let oz = block.cz + a * (block.hz - block.cr * 0.55)
      if (nn(block, ox, oz) > -0.7) {
        ox = block.cx + i * (block.hx - block.cr * 0.9)
        oz = block.cz + a * (block.hz - block.cr * 0.9)
      }
      if (!xn(ox, oz) || un(ox, oz, 2.5)) continue
      const p = createBoxBuilder(rnd)
      const l = 13 + rnd() * 6      // altura total del poste
      const u = 8 + rnd() * 5       // alcance horizontal del brazo
      const d = 4.5 + rnd() * 2.5   // caída del brazo desde la punta del mástil
      p.box(0.8, l * 0.55, 0.8, 0, l * 0.275, 0)
      p.box(0.55, l * 0.5, 0.55, 0, l * 0.75, 0)
      const armLen = Math.hypot(u, d)
      const armAngle = Math.atan2(d, u)
      p.box(armLen, 0.32, 0.32, u * 0.5, l - d * 0.5, 0, -armAngle)
      const bm = u * 0.5, bh = l * 0.45 - d * 0.5
      p.box(Math.hypot(bm, bh), 0.22, 0.22, u * 0.25, (l * 0.55 + l - d * 0.5) / 2, 0, Math.atan2(bh, bm))
      p.box(0.9, 1.2, 0.9, u, l - d - 0.55, 0)
      p.box(0.16, 1.2, 0.16, u, l - d - 1.7, 0)
      const group = p.finish([0.93, 0.9, 0.84], false)
      group.rotation.y = Math.atan2(-a, i)
      group.position.set(ox, ln(ox, oz), oz)
      scene.add(group)
      dustAvoid.push({ x: ox, z: oz, r: 1.5 })
      built++
    }
  }
  Sn()

  // ─── Cn: FAROLAS — puerto fiel ─────────────────────────────────────────
  // 3–7 postes ('flat', un solo color) con uno o dos paneles rectangulares
  // de color (paleta exacta de 5) como MeshBasicMaterial plano, orientados
  // hacia afuera de la manzana con `on` (gradiente del SDF).
  function Cn() {
    const LAMP_COLORS = [
      [0.16, 0.30, 0.98],
      [1, 0.83, 0.20],
      [1, 0.35, 0.55],
      [0.35, 0.90, 0.85],
      [1, 0.48, 0.09],
    ]
    const grad = { x: 0, z: 0 }
    const count = 3 + ((rnd() * 4) | 0) // 3..7
    let built = 0, tries = 0
    while (built < count && tries++ < 110) {
      const block = blocks[(rnd() * blocks.length) | 0]
      const ang = rnd() * 6.2832
      const x = block.cx + Math.cos(ang) * (block.hx - 1.8)
      const z = block.cz + Math.sin(ang) * (block.hz - 1.8)
      const dSdf = nn(block, x, z)
      if (dSdf > -0.8 || dSdf < -3.6) continue
      if (!xn(x, z) || un(x, z, 1.8)) continue
      const p = createBoxBuilder(rnd)
      const postH = 6 + rnd() * 3
      p.box(0.3, postH, 0.3, 0, postH / 2, 0)
      const group = p.finish([0.94, 0.92, 0.88], 'flat')
      const pw = 2.6 + rnd() * 1.6, ph = 1.4 + rnd() * 0.8
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(pw, ph, 0.16, 3, 3, 1),
        new THREE.MeshBasicMaterial({ color: rgbToHex(pick(LAMP_COLORS)) }),
      )
      panel.position.set(0, postH - ph * 0.5 - 0.1, 0)
      group.add(panel)
      if (rnd() < 0.5) {
        const panel2 = new THREE.Mesh(
          new THREE.BoxGeometry(pw * 0.6, ph * 0.65, 0.16, 3, 3, 1),
          new THREE.MeshBasicMaterial({ color: rgbToHex(pick(LAMP_COLORS)) }),
        )
        panel2.position.set(0, postH - ph - 0.95, 0)
        panel2.rotation.y = Math.PI / 2
        group.add(panel2)
      }
      on(x, z, grad)
      group.rotation.y = Math.atan2(grad.x, grad.z)
      group.position.set(x, ln(x, z), z)
      scene.add(group)
      dustAvoid.push({ x, z, r: 1.35 })
      built++
    }
  }
  Cn()

  // ─── wn: BANCOS/QUIOSCOS — puerto fiel ─────────────────────────────────
  // 1–3 estructuras de asiento/quiosco ('flat', tono claro) con un techo
  // rectangular naranja aparte. Orientadas con `on`, igual que las farolas.
  function wn() {
    const grad = { x: 0, z: 0 }
    const count = 1 + ((rnd() * 2) | 0) // 1..3
    let built = 0, tries = 0
    while (built < count && tries++ < 90) {
      const block = blocks[(rnd() * blocks.length) | 0]
      const ang = rnd() * 6.2832
      const x = block.cx + Math.cos(ang) * (block.hx - 3.2)
      const z = block.cz + Math.sin(ang) * (block.hz - 3.2)
      const dSdf = nn(block, x, z)
      if (dSdf > -1.4 || dSdf < -4.2) continue
      if (!xn(x, z) || un(x, z, 3)) continue
      const p = createBoxBuilder(rnd)
      const u = 5.5 + rnd() * 1.5 // ancho
      const d = 3.4 + rnd() * 0.6 // profundidad
      const f = 2.2
      p.box(u, d * 0.82, 0.18, 0, d * 0.47, -f * 0.5)
      p.box(0.18, d * 0.82, f, -u / 2 + 0.09, d * 0.47, 0)
      p.box(0.18, d * 0.82, f, u / 2 - 0.09, d * 0.47, 0)
      p.box(0.22, d, 0.22, -u / 2 + 0.14, d / 2, f * 0.42)
      p.box(0.22, d, 0.22, u / 2 - 0.14, d / 2, f * 0.42)
      p.box(u * 0.62, 0.16, 0.62, 0, 1.05, -f * 0.16)
      const group = p.finish([0.86, 0.93, 0.96], 'flat')
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(u + 0.9, 0.24, f + 0.9, 4, 1, 3),
        new THREE.MeshBasicMaterial({ color: rgbToHex([1, 0.52, 0.1]) }),
      )
      roof.position.set(0, d + 0.12, 0)
      group.add(roof)
      on(x, z, grad)
      group.rotation.y = Math.atan2(grad.x, grad.z)
      group.position.set(x, ln(x, z), z)
      scene.add(group)
      dustAvoid.push({ x, z, r: 3.2 })
      built++
    }
  }
  wn()

  // ─── Tn: ESCOMBROS/ADOQUINES — puerto fiel ─────────────────────────────
  // 1–3 solidos grises por manzana (cilindro, caja, o par de icosaedros
  // apilados) pegados al borde interior, más 1–3 en el centro de calles.
  // Sombreados por vértice con `shadeGeometry` (extracción de `_n`) y
  // pintados con vertexColors — mismo mecanismo que las grúas (Sn).
  function Tn() {
    function place(geo, x, y, z, rotY) {
      shadeGeometry(geo, [0.72, 0.74, 0.79], rnd() * 50)
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }))
      mesh.position.set(x, y, z)
      if (rotY) mesh.rotation.y = rotY
      scene.add(mesh)
    }
    for (let t = 0; t < blocks.length; t++) {
      const block = blocks[t]
      const count = 1 + ((rnd() * 3) | 0) // 1..3
      for (let i = 0; i < count; i++) {
        const ang = rnd() * 6.2832
        const x = block.cx + Math.cos(ang) * (block.hx - 2.2)
        const z = block.cz + Math.sin(ang) * (block.hz - 2.2)
        if (nn(block, x, z) > -1.2) continue
        if (un(x, z, 1.2)) continue
        const gy = ln(x, z)
        const roll = rnd()
        if (roll < 0.4) {
          place(new THREE.CylinderGeometry(0.7, 0.85, 1.9, 9, 3), x, gy + 0.95, z, rnd() * 6.28)
        } else if (roll < 0.7) {
          place(new THREE.BoxGeometry(0.9, 2.3, 0.9, 2, 4, 2), x, gy + 1.15, z, rnd() * 6.28)
        } else {
          place(new THREE.IcosahedronGeometry(0.75, 1), x, gy + 0.8, z)
          place(new THREE.IcosahedronGeometry(0.45, 1), x, gy + 1.85, z)
        }
        dustAvoid.push({ x, z, r: 1.2 })
      }
    }
    const streetCount = 1 + ((rnd() * 3) | 0) // 1..3
    for (let i = 0; i < streetCount; i++) {
      const x = (rnd() * 2 - 1) * Wt * 0.8
      const z = (rnd() * 2 - 1) * Wt * 0.8
      const dSdf = an(x, z)
      if (dSdf < 1 || dSdf > 3.2) continue
      place(new THREE.CylinderGeometry(0.6, 0.7, 1.7, 9, 3), x, we + 0.85, z, rnd() * 6.28)
      dustAvoid.push({ x, z, r: 1.3 })
    }
  }
  Tn()

  // ─── Dn: PASTO — puerto fiel ────────────────────────────────────────────
  // `Math.floor(46000*grass)+Math.floor(700*grass)` hojas (grass=1 → 46700):
  // 46000 sobre manzanas + 700 en una franja rala de borde de calle. Cada
  // hoja es un LINE SEGMENT de 2 tramos (base→medio→punta) con degradado de
  // color vertical (oscuro abajo, brillante en la punta) — igual mecánica
  // que las hojas del bosque (`scene.js`), pero en MALLA PROPIA: el bundle
  // arma su propio BufferGeometry posición+color y lo agrega como
  // THREE.LineSegments con LineBasicMaterial({vertexColors:true}); NO pasa
  // por el sistema compartido `draw` (igual que hacen Sn/Cn/wn/Tn con sus
  // propias mallas).
  //
  // Siembra sobre manzana: posición al azar en una manzana ponderada por
  // área (`En`), descartada si cae en la calle (`nn>-1`) o sobre un
  // edificio (`un`), y luego con probabilidad `g` según fertilidad (`Fe`) y
  // brillo de cercanía a edificio (`fn`) — así el pasto se agolpa en zonas
  // fértiles y alrededor de las torres. La inclinación de cada hoja sigue
  // un campo de ruido coherente (`fbm`) — "el pasto se peina en corrientes".
  //
  // `ze(f,out)`: rampa de color pasto→amarillento. El bundle provisto solo
  // muestra la LLAMADA `ze(valor,s)`, no su cuerpo — se reconstruye aquí
  // siguiendo el mismo patrón que la rampa análoga del bosque
  // (`grassColor`/`GRASS_RAMP` de scene.js) pero más apagada, coherente con
  // "todo del lado oscuro" para que las torres dominen.
  const GRASS_RAMP_LO = [0.05, 0.09, 0.02]
  const GRASS_RAMP_HI = [0.30, 0.44, 0.11]
  function ze(f, out) {
    out[0] = GRASS_RAMP_LO[0] + (GRASS_RAMP_HI[0] - GRASS_RAMP_LO[0]) * f
    out[1] = GRASS_RAMP_LO[1] + (GRASS_RAMP_HI[1] - GRASS_RAMP_LO[1]) * f
    out[2] = GRASS_RAMP_LO[2] + (GRASS_RAMP_HI[2] - GRASS_RAMP_LO[2]) * f
  }
  function Dn() {
    const e = Math.floor(46000 * GRASS)
    const t = e * 2
    const n = Math.floor(700 * GRASS)
    const total = e + n
    const pos = new Float32Array(total * 12)
    const col = new Float32Array(total * 12)
    let o = 0
    const s = [0, 0, 0]
    let l
    for (let c = 0; c < t && o < e; c++) {
      const u = En()
      const d = u.cx + (rnd() * 2 - 1) * (u.hx - 0.8)
      const f = u.cz + (rnd() * 2 - 1) * (u.hz - 0.8)
      if (nn(u, d, f) > -1 || un(d, f, 0.35)) continue
      const m = fertility(d, f)
      const h = fn(d, f)
      const g = 0.14 + 0.86 * clamp(m * 1.05 + h * 0.9, 0, 1)
      if (rnd() > g) continue
      const gy = ln(d, f)
      const v = (1.6 + rnd() * 1.7) * (0.8 + 0.55 * Math.max(m, h * 0.8))
      const y = fbm(d * 0.02 + 51, f * 0.02 + 13, 2) * 12.566 + (rnd() - 0.5) * 1.4
      const b = 0.25 + rnd() * 0.7
      const x = Math.cos(y) * b
      const S = Math.sin(y) * b
      ze(clamp(Math.max(m, h * 0.7) + (rnd() - 0.5) * 0.2, 0, 1), s)
      const C = 0.45 + 0.55 * (1 - smoothstep(Wt * 0.58, Wt * 1.02, Math.hypot(d, f)))
      const w = s[0] * C, T = s[1] * C, E = s[2] * C
      l = o * 12
      pos[l] = d; pos[l + 1] = gy; pos[l + 2] = f
      pos[l + 3] = d + x * 0.35; pos[l + 4] = gy + v * 0.62; pos[l + 5] = f + S * 0.35
      pos[l + 6] = pos[l + 3]; pos[l + 7] = pos[l + 4]; pos[l + 8] = pos[l + 5]
      pos[l + 9] = d + x; pos[l + 10] = gy + v; pos[l + 11] = f + S
      col[l] = w * 0.35; col[l + 1] = T * 0.35; col[l + 2] = E * 0.35
      col[l + 3] = w * 0.85; col[l + 4] = T * 0.85; col[l + 5] = E * 0.85
      col[l + 6] = col[l + 3]; col[l + 7] = col[l + 4]; col[l + 8] = col[l + 5]
      col[l + 9] = Math.min(1, w * 1.15); col[l + 10] = Math.min(1, T * 1.15); col[l + 11] = Math.min(1, E * 1.15)
      o++
    }
    // Franja rala de pasto de borde de calle: entre 1 y `Gt` unidades del
    // borde de manzana (dentro de la calle, cerca del bordillo).
    let D = 0
    for (let c = 0; c < n * 4 && D < n; c++) {
      const O = (rnd() * 2 - 1) * Wt * 0.92
      const k = (rnd() * 2 - 1) * Wt * 0.92
      const A = an(O, k)
      if (A < 1 || A > Gt) continue
      const j = 0.6 + rnd() * 1
      const M = rnd() * 6.2832
      const N = 0.2 + rnd() * 0.4
      const P = Math.cos(M) * N
      const F = Math.sin(M) * N
      const I = 0.1 + rnd() * 0.16
      l = o * 12
      pos[l] = O; pos[l + 1] = we; pos[l + 2] = k
      pos[l + 3] = O + P * 0.4; pos[l + 4] = we + j * 0.6; pos[l + 5] = k + F * 0.4
      pos[l + 6] = pos[l + 3]; pos[l + 7] = pos[l + 4]; pos[l + 8] = pos[l + 5]
      pos[l + 9] = O + P; pos[l + 10] = we + j; pos[l + 11] = k + F
      col[l] = 0.02; col[l + 1] = 0.05; col[l + 2] = 0.012
      col[l + 3] = I * 0.35; col[l + 4] = I; col[l + 5] = I * 0.22
      col[l + 6] = col[l + 3]; col[l + 7] = col[l + 4]; col[l + 8] = col[l + 5]
      col[l + 9] = I * 0.45; col[l + 10] = Math.min(1, I * 1.2); col[l + 11] = I * 0.3
      o++; D++
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, o * 12), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col.slice(0, o * 12), 3))
    grassMat = new THREE.LineBasicMaterial({ vertexColors: true })
    scene.add(new THREE.LineSegments(geo, grassMat))
  }
  Dn()

  // ─── kn: FLORES — puerto fiel, helpers REALES ──────────────────────────
  // `.superpowers/port/flora-helpers-real.min.js` y `Be-colors-real.min.js`
  // extrajeron el símbolo equivocado (interno de THREE.WebGLRenderer, no la
  // ciudad). Los `tt`/`nt`/`rt`/`it`/`Be`/`Ve`/`We`/`Ue`/`He` reales están
  // en el propio bundle (`murmur-bundle.js`, offset ~593587 para `Be`, con
  // `tt`/`rt`/`it` a continuación inmediata en el MISMO closure de ciudad —
  // confirmado porque `Wt=62`, `Zt=[]`, `On`/`En`/`kn` viven en el mismo
  // tramo, offsets 605752–632019). Portados TEXTUAL (mismo orden de
  // `rnd()`, mismos parámetros):
  //   Be={orange,orange2,amber,yellow,salmon,pink,dusty,cream,red} (paleta
  //   de flor), Ve=lista ponderada de nombres de Be, We/Ue/He=degradado de
  //   tallo (marrón oscuro→tostado→crema — pasto seco urbano, NO el verde
  //   del bosque). `it(x,y,z,r,paleta,mul)` = tallo (2 líneas We→Ue→He) +
  //   cabeza (1 punto, 85% color de paleta / 15% Be al azar) o racimo
  //   (v=2..4, 80/20). `tt(x,y,z,color,size)` = punto suelto. `rt()` =
  //   paleta de 3 [color,color,color2] (2/3 un color, 1/3 acento), igual
  //   patrón que `patchPalette()` del bosque (scene.js). `Ft(x,z,size,y)`
  //   = arbusto de bayas blancas (idéntico a `berryBush`/`berry` de
  //   scene.js, con nombres propios de ciudad).
  const Be = {
    orange: [1, 0.52, 0.08],
    orange2: [0.94, 0.4, 0.04],
    amber: [1, 0.68, 0.2],
    yellow: [1, 0.83, 0.3],
    salmon: [1, 0.62, 0.44],
    pink: [0.96, 0.62, 0.66],
    dusty: [0.88, 0.5, 0.56],
    cream: [0.96, 0.92, 0.76],
    red: [0.93, 0.2, 0.12],
  }
  const Ve = ['orange', 'orange', 'orange2', 'amber', 'amber', 'yellow', 'salmon', 'pink', 'dusty', 'cream', 'cream']
  const We = [0.29, 0.26, 0.17]
  const Ue = [0.62, 0.55, 0.38]
  const He = [0.88, 0.8, 0.58]
  function rt() {
    const c1 = Be[Ve[(rnd() * Ve.length) | 0]]
    return [c1, c1, Be[Ve[(rnd() * Ve.length) | 0]]]
  }
  // Flor con tallo: 2 tramos de línea (base→medio→punta, degradado
  // We→Ue→He) + cabeza (punto único, 85/15) o racimo (v=2..4, 80/20).
  // `a` es el multiplicador de inclinación del tallo (no un flag de mecido).
  function it(x, y, z, r, i, a) {
    const o = (3 + rnd() * 3.6) * r
    const s0 = rnd() * 6.2832
    const c = (0.5 + rnd() * 1.3) * r * (a || 1)
    const lx = Math.cos(s0) * c, lz = Math.sin(s0) * c
    const mx = x + lx * 0.32, my = y + o * 0.55, mz = z + lz * 0.32
    const tx = x + lx, ty = y + o, tz = z + lz
    draw.pushLine(x, y, z, mx, my, mz, We, Ue)
    draw.pushLine(mx, my, mz, tx, ty, tz, Ue, He)
    const base = i[(rnd() * i.length) | 0]
    const v = rnd() < 0.42 ? 2 + ((rnd() * 3) | 0) : 1
    if (v === 1) {
      tt(tx, ty + 0.1 * r, tz, rnd() < 0.85 ? base : Be[Ve[(rnd() * Ve.length) | 0]], (0.45 + rnd() * 0.5) * r)
    } else {
      for (let k = 0; k < v; k++) {
        const b = rnd() * 6.2832
        const xr = (0.5 + rnd() * 1.2) * r
        const yr = (0.3 + rnd() * 1.0) * r
        const cx = tx + Math.cos(b) * xr, cy = ty + yr, cz = tz + Math.sin(b) * xr
        draw.pushLine(tx, ty, tz, cx, cy, cz, Ue, He)
        tt(cx, cy, cz, rnd() < 0.8 ? base : Be[Ve[(rnd() * Ve.length) | 0]], (0.35 + rnd() * 0.4) * r)
      }
    }
  }
  // Pétalo/flor suelta sin tallo: un único punto.
  function tt(x, y, z, color, size) {
    draw.pushPoint(x, y, z, color, size, 0)
  }
  // Arbusto interior de manzana: bayas blancas — idéntico a
  // `berryBush`/`berry` del bosque (scene.js), solo renombrado a `Ft`
  // (nombre del bundle) y enrutado por `draw` de ciudad.
  function Ft(x, z, n, r) {
    const y0 = r === undefined ? ln(x, z) - 0.9 : r
    const a = rnd() * 6.2832
    const o = 0.1 + rnd() * 0.4
    const s = Math.sin(o) * Math.cos(a)
    const c = Math.cos(o)
    const l = Math.sin(o) * Math.sin(a)
    const u = (2 + rnd() * 2.8) * n
    const px = x + s * u * 0.55 + (rnd() - 0.5) * 0.5
    const py = y0 + c * u * 0.55
    const pz = z + l * u * 0.55 + (rnd() - 0.5) * 0.5
    draw.pushLine(x, y0, z, px, py, pz, [1, 1, 1], [1, 1, 1])
    function g(gx, gy, gz) {
      const r2 = rnd()
      tt(gx, gy, gz, r2 < 0.72 ? [1, 0.13 + rnd() * 0.06, 0.08] : r2 < 0.9 ? [1, 0.45, 0.1] : [0.97, 0.97, 1], 0.24 + rnd() * 0.24)
    }
    const tx = x + s * u + (rnd() - 0.5) * 0.9
    const ty = y0 + c * u
    const tz = z + l * u + (rnd() - 0.5) * 0.9
    draw.pushLine(px, py, pz, tx, ty, tz, [1, 1, 1], [1, 1, 1])
    g(tx, ty, tz)
    const branches = 1 + ((rnd() * 3) | 0)
    for (let bIdx = 0; bIdx < branches; bIdx++) {
      const S = 0.45 + rnd() * 0.5
      const cx = x + (px - x) * S + (tx - px) * Math.max(0, S - 0.5)
      const cy = y0 + (py - y0) * S + (ty - py) * Math.max(0, S - 0.5)
      const cz = z + (pz - z) * S + (tz - pz) * Math.max(0, S - 0.5)
      const E = u * (0.22 + rnd() * 0.26)
      const D = rnd() * 6.2832
      const O = 0.5 + rnd() * 0.7
      const kx = cx + Math.sin(O) * Math.cos(D) * E
      const ky = cy + Math.cos(O) * E
      const kz = cz + Math.sin(O) * Math.sin(D) * E
      draw.pushLine(cx, cy, cz, kx, ky, kz, [1, 1, 1], [1, 1, 1])
      g(kx, ky, kz)
      if (rnd() < 0.35) g(cx, cy, cz)
    }
  }
  // Siembra `n` flores con tallo en un disco de radio `r` alrededor de
  // (cx,cz), evitando calle y edificios.
  function On(cx, cz, n, r, color) {
    for (let a = 0; a < n; a++) {
      const ang = rnd() * 6.2832
      const dist = r * Math.sqrt(rnd()) * (1 + rnd() * 0.5)
      const x = cx + Math.cos(ang) * dist
      const z = cz + Math.sin(ang) * dist
      if (an(x, z) > -1.1 || un(x, z, 0.4)) continue
      it(x, ln(x, z), z, 0.45 + rnd() * 0.6, color, 1)
    }
  }
  function kn() {
    const e = FLOWERS
    let t, n
    // Flores alrededor de cada edificio colocado.
    for (t = 0; t < placed.length; t++) {
      const r = placed[t]
      const i = 2 + ((rnd() * 2) | 0)
      for (n = 0; n < i; n++) {
        const a = rnd() * 6.2832
        On(
          r.cx + Math.cos(a) * (r.hx + 2.5 + rnd() * 3),
          r.cz + Math.sin(a) * (r.hz + 2.5 + rnd() * 3),
          Math.round((8 + rnd() * 14) * e),
          2.2 + rnd() * 2.2,
          rt(),
        )
      }
    }
    for (t = 0; t < blocks.length; t++) {
      const o = blocks[t]
      // Flores de borde de manzana.
      const s = 1 + ((rnd() * 3) | 0)
      for (n = 0; n < s; n++) {
        const c = rnd() * 6.2832
        On(
          o.cx + Math.cos(c) * (o.hx - 3.5),
          o.cz + Math.sin(c) * (o.hz - 3.5),
          Math.round((6 + rnd() * 12) * e),
          2.5 + rnd() * 2.5,
          rt(),
        )
      }
      // Arbustos en el interior de la manzana.
      let l = rnd() < 0.75 ? 3 + ((rnd() * 7) | 0) : 0
      let u = 0
      while (l > 0 && u++ < 60) {
        const d = rnd() * 6.2832
        const f = o.cx + Math.cos(d) * (o.hx - 2.5) * rnd()
        const m = o.cz + Math.sin(d) * (o.hz - 2.5) * rnd()
        if (nn(o, f, m) > -1.4 || un(f, m, 0.6)) continue
        Ft(f, m, 0.7 + rnd() * 0.6, ln(f, m) - 0.15)
        l--
      }
      // "Estallidos" de pétalos (racimo denso sin tallo).
      const h = 1 + ((rnd() * 3) | 0)
      for (n = 0; n < h; n++) {
        const g = rnd() * 6.2832
        const bx = o.cx + Math.cos(g) * (o.hx - 3) * rnd()
        const bz = o.cz + Math.sin(g) * (o.hz - 3) * rnd()
        if (nn(o, bx, bz) > -1.5) continue
        const y = pick([[0.16, 0.30, 0.98], [1, 0.22, 0.12], [1, 0.85, 0.22], [0.97, 0.97, 1], [1, 0.55, 0.10]])
        const b = Math.round((14 + rnd() * 22) * e)
        for (let x = 0; x < b; x++) {
          const S = rnd() * 6.2832
          const C = Math.pow(rnd(), 0.7) * (1.6 + rnd() * 1.6)
          const w = bx + Math.cos(S) * C
          const T = bz + Math.sin(S) * C
          if (an(w, T) > -0.8) continue
          tt(w, ln(w, T) + 0.25 + rnd() * 0.5, T, y, 0.1 + rnd() * 0.12)
        }
      }
      // Flores de bordillo (pegadas al borde exterior de la manzana).
      const E = Math.round((16 + rnd() * 20) * e)
      for (n = 0; n < E; n++) {
        const D = rnd() * 6.2832
        const O = o.cx + Math.cos(D) * (o.hx + 0.5)
        const k = o.cz + Math.sin(D) * (o.hz + 0.5)
        const A = an(O, k)
        if (A < 0.3 || A > 2.6) continue
        tt(O, we + 0.12 + rnd() * 0.3, k, rnd() < 0.6 ? Be.cream : Be.orange, 0.1 + rnd() * 0.12)
      }
    }
    // Flores con tallo esparcidas por manzanas al azar (ponderadas por área).
    const j = Math.round(130 * e)
    for (t = 0; t < j; t++) {
      const M = En()
      const N = M.cx + (rnd() * 2 - 1) * (M.hx - 2)
      const P = M.cz + (rnd() * 2 - 1) * (M.hz - 2)
      if (nn(M, N, P) > -1.2 || un(N, P, 0.4)) continue
      it(N, ln(N, P), P, 0.5 + rnd() * 0.7, rt(), 1)
    }
    // Flores sueltas (sin tallo) esparcidas por manzanas al azar.
    const F = Math.round(320 * e)
    for (t = 0; t < F; t++) {
      const I = En()
      const L = I.cx + (rnd() * 2 - 1) * (I.hx - 1.5)
      const R = I.cz + (rnd() * 2 - 1) * (I.hz - 1.5)
      if (nn(I, L, R) > -1 || un(L, R, 0.3)) continue
      const z = rnd() < 0.14 ? Be.red : rnd() < 0.5 ? Be.cream : Be.yellow
      tt(L, ln(L, R) + 0.9 + rnd() * 1.1, R, z, 0.12 + rnd() * 0.14)
    }
  }
  kn()

  // ─── SAKURA: copia mínima del sistema de árbol+follaje del bosque (Task S1)
  // ─────────────────────────────────────────────────────────────────────────
  // `src/render/scene.js` tiene un sistema completo de árbol (tubos ahusados
  // recursivos, `tube`/`branch`) + follaje estacional (hojas/flores como
  // PUNTOS que brotan/abren con `uSeason`/`uLeaf`/`uFlower`/`uAutumn`, mismo
  // shader) + lluvia de pétalos reciclable (`updateFallingLeaves`). Se copia
  // aquí el MÍNIMO necesario para plantar sakuras en la ciudad (sin la rama
  // de árboles "normales"/troncos caídos del bosque, que la ciudad no usa):
  // mismo look, mismo shader, sin reinventar nada.
  const TREE_FILL = 0x130d09, TREE_EDGE = 0xd9d9ba
  const treePos = [], treeIdx = []
  const folPos = [], folCol = [], folSize = [], folPhase = [], folKind = [], folBirth = []
  const folFall = [], folRot = []
  const petalAnchors = [] // posiciones+color de las flores → lluvia de pétalos
  const SAKURA_COL = [[1.0, 0.72, 0.82], [1.0, 0.80, 0.90], [1.0, 0.60, 0.74], [0.98, 0.90, 0.96]]
  const SAKURA_LEAF_LO = [0.09, 0.20, 0.05], SAKURA_LEAF_HI = [0.30, 0.52, 0.13]
  const SAKURA_AUTUMN = [[0.85, 0.20, 0.06], [0.92, 0.44, 0.05], [0.90, 0.66, 0.10], [0.60, 0.26, 0.08], [0.78, 0.33, 0.10]]
  const _fperp = new THREE.Vector3()
  function addSakuraLeaf(p, tan) {
    _fperp.set(-tan.z, (rnd() - 0.5) * 0.7, tan.x).normalize().multiplyScalar(0.3 + rnd() * 0.8)
    const g = rnd()
    folPos.push(p.x + _fperp.x + (rnd() - 0.5) * 0.5, p.y + _fperp.y + (rnd() - 0.5) * 0.5, p.z + _fperp.z + (rnd() - 0.5) * 0.5)
    folCol.push(
      SAKURA_LEAF_LO[0] + (SAKURA_LEAF_HI[0] - SAKURA_LEAF_LO[0]) * g,
      SAKURA_LEAF_LO[1] + (SAKURA_LEAF_HI[1] - SAKURA_LEAF_LO[1]) * g,
      SAKURA_LEAF_LO[2] + (SAKURA_LEAF_HI[2] - SAKURA_LEAF_LO[2]) * g,
    )
    const fc = SAKURA_AUTUMN[(rnd() * SAKURA_AUTUMN.length) | 0]
    folFall.push(fc[0], fc[1], fc[2]); folRot.push(rnd() * 6.2832)
    folSize.push(0.6 + rnd() * 0.7); folPhase.push(rnd()); folKind.push(0)
    folBirth.push(rnd() * 0.12) // brotan temprano en primavera, escalonados
  }
  function addSakuraBlossom(p) {
    const c = SAKURA_COL[(rnd() * SAKURA_COL.length) | 0]
    const x = p.x + (rnd() - 0.5) * 1.4, y = p.y + (rnd() - 0.5) * 1.4, z = p.z + (rnd() - 0.5) * 1.4
    folPos.push(x, y, z); folCol.push(c[0], c[1], c[2])
    folFall.push(c[0], c[1], c[2]); folRot.push(0)
    folSize.push(0.6 + rnd() * 0.7); folPhase.push(rnd()); folKind.push(1)
    folBirth.push(0.02 + rnd() * 0.12)
    petalAnchors.push(x, y, z, c[0], c[1], c[2])
  }
  /** Tubo alrededor de una espina, con ahusado y radio perturbado por ruido (puerto de `tube` del bosque). */
  function sakuraTube(spine, r0, r1, segs, seed) {
    const base = treePos.length / 3
    const nseg = spine.length
    const tan = new THREE.Vector3(), up = new THREE.Vector3()
    const bx = new THREE.Vector3(), by = new THREE.Vector3()
    for (let c = 0; c < nseg; c++) {
      tan.subVectors(spine[Math.min(nseg - 1, c + 1)], spine[Math.max(0, c - 1)]).normalize()
      up.set(0, 1, 0)
      if (Math.abs(tan.y) > 0.9) up.set(1, 0, 0)
      bx.crossVectors(tan, up).normalize()
      by.crossVectors(tan, bx)
      const h = c / (nseg - 1)
      const g = r0 + (r1 - r0) * Math.pow(h, 0.85)
      const p = spine[c]
      for (let l = 0; l < segs; l++) {
        const a = (l / segs) * 6.2832
        const cv = Math.cos(a), sv = Math.sin(a)
        const rad = g * (1 + (noise2(p.x * 1.4 + seed + l * 3.7, p.z * 1.4 + p.y * 0.9) - 0.5) * 0.34)
        treePos.push(
          p.x + (bx.x * cv + by.x * sv) * rad,
          p.y + (bx.y * cv + by.y * sv) * rad,
          p.z + (bx.z * cv + by.z * sv) * rad,
        )
      }
    }
    for (let c = 0; c < nseg - 1; c++) {
      for (let l = 0; l < segs; l++) {
        const x = base + c * segs + l
        const s2 = base + c * segs + ((l + 1) % segs)
        const C = x + segs, w = s2 + segs
        treeIdx.push(x, C, s2, s2, C, w)
      }
    }
  }
  /** Rama recursiva del sakura: siempre florece (sin la rama de árbol "normal"/tronco caído del bosque). */
  function sakuraBranch(start, dir, len, radius, depth, maxDepth, seed) {
    const SEG = 4
    const spine = [start.clone()]
    const cur = start.clone()
    const d = dir.clone()
    for (let p = 0; p < SEG; p++) {
      d.x += (rnd() - 0.5) * 0.55
      d.y += (rnd() - 0.5) * 0.38 + 0.16
      d.z += (rnd() - 0.5) * 0.55
      d.normalize()
      cur.addScaledVector(d, len / SEG)
      spine.push(cur.clone())
    }
    const tip = depth >= maxDepth
    const rEnd = tip ? 0.03 : radius * (0.52 + rnd() * 0.16)
    sakuraTube(spine, radius, rEnd, radius > 0.8 ? 9 : radius > 0.35 ? 7 : 5, seed)
    if (tip) {
      // Sakura: pocas hojas verdes, canopy DENSO de flores rosadas.
      const leafN = 2 + ((rnd() * 3) | 0)
      for (let k = 0; k < leafN; k++) addSakuraLeaf(spine[1 + ((rnd() * (spine.length - 1)) | 0)], d)
      const nb = 8 + ((rnd() * 10) | 0)
      for (let k = 0; k < nb; k++) addSakuraBlossom(spine[1 + ((rnd() * (spine.length - 1)) | 0)])
      return
    }
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
      const from = i === 0 ? spine[spine.length - 1] : spine[1 + ((rnd() * (spine.length - 1)) | 0)]
      sakuraBranch(from.clone(), v, len * (0.6 + rnd() * 0.22),
        rEnd * (0.85 + rnd() * 0.2), depth + 1, maxDepth, seed)
    }
  }

  // Siembra 1–3 sakuras en interiores de manzana: bien adentro (`nn`≤-6, lejos
  // de la calle) y lejos de cualquier edificio ya colocado (`un`), separadas
  // entre sí. `En()` (definido arriba) pondera por área, igual que el resto
  // de la vegetación de la ciudad (`kn`).
  const sakuraTrees = []
  {
    const want = 1 + ((rnd() * 3) | 0) // 1..3
    for (let guard = 0; sakuraTrees.length < want && guard < 200 && blocks.length; guard++) {
      const block = En()
      const tx = block.cx + (rnd() * 2 - 1) * Math.max(0, block.hx - 9)
      const tz = block.cz + (rnd() * 2 - 1) * Math.max(0, block.hz - 9)
      if (nn(block, tx, tz) > -6) continue
      if (un(tx, tz, 9)) continue
      if (sakuraTrees.some((s) => Math.hypot(tx - s.x, tz - s.z) < 16)) continue
      const treeLen = 9 + rnd() * 6
      const gy = ln(tx, tz)
      sakuraBranch(new THREE.Vector3(tx, gy - 0.6, tz),
        new THREE.Vector3((rnd() - 0.5) * 0.5, 1, (rnd() - 0.5) * 0.5).normalize(),
        treeLen, 0.9 + rnd() * 0.55, 0, 3, rnd() * 97)
      // Copa como posado (mismo formato que las cimas de edificio, línea ~444:
      // normalizado por R_CITY, `h` = altura absoluta sobre `we`) + nieve.
      poiPerch.push({ x: tx / R_CITY, z: tz / R_CITY, h: (gy + treeLen * 0.55) - we })
      sakuraTrees.push({ x: tx, z: tz })
    }
  }
  if (treeIdx.length) {
    for (let i = 0; i < treePos.length; i += 3 * 5) {
      capPos.push(treePos[i], treePos[i + 1] + 0.1, treePos[i + 2])
    }
    const tg = new THREE.BufferGeometry()
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(treePos), 3))
    tg.setIndex(treeIdx)
    scene.add(new THREE.Mesh(tg, new THREE.MeshBasicMaterial({
      color: TREE_FILL, side: THREE.DoubleSide, fog: true,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    })))
    scene.add(new THREE.LineSegments(
      new THREE.WireframeGeometry(tg),
      new THREE.LineBasicMaterial({ color: TREE_EDGE, transparent: true, opacity: 0.55, fog: true }),
    ))
  }

  // ─── FOLLAJE del sakura: hojas/flores que brotan y abren con la estación,
  // MISMO shader que el bosque (`scene.js`), compartiendo uProj/uT con `draw`.
  const foliageUniforms = {
    uProj: draw.uniforms.uProj, uT: draw.uniforms.uT,
    uSeason: { value: 0 }, uLeaf: { value: 0 }, uFlower: { value: 0 }, uAutumn: { value: 0 },
  }
  if (folPos.length) {
    const fg = new THREE.BufferGeometry()
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(folPos), 3))
    fg.setAttribute('hcol', new THREE.BufferAttribute(new Float32Array(folCol), 3))
    fg.setAttribute('hsize', new THREE.BufferAttribute(new Float32Array(folSize), 1))
    fg.setAttribute('hphs', new THREE.BufferAttribute(new Float32Array(folPhase), 1))
    fg.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(folKind), 1))
    fg.setAttribute('aBirth', new THREE.BufferAttribute(new Float32Array(folBirth), 1))
    fg.setAttribute('aFall', new THREE.BufferAttribute(new Float32Array(folFall), 3))
    fg.setAttribute('aRot', new THREE.BufferAttribute(new Float32Array(folRot), 1))
    const foliageMat = new THREE.ShaderMaterial({
      uniforms: foliageUniforms, transparent: true, depthWrite: false,
      vertexShader: `
        attribute vec3 hcol; attribute float hsize; attribute float hphs;
        attribute float aKind; attribute float aBirth; attribute vec3 aFall; attribute float aRot;
        uniform float uProj, uT, uSeason, uLeaf, uFlower, uAutumn;
        varying vec3 vC; varying float vKind; varying float vRot;
        void main() {
          vec3 p = position;
          float ph = hphs * 6.2831;
          p.x += sin(uT * 0.7 + ph) * 0.5;
          p.z += cos(uT * 0.6 + ph * 1.7) * 0.5;
          p.y += sin(uT * 1.1 + ph * 2.3) * 0.18;
          float grow = clamp((uSeason - aBirth) / 0.18, 0.0, 1.0);
          grow = grow * grow * (3.0 - 2.0 * grow);
          float amount = (aKind < 0.5) ? uLeaf : uFlower;
          float g = grow * amount;
          vec3 col = (aKind < 0.5) ? mix(hcol, aFall, uAutumn) : hcol;
          col *= 0.9 + 0.14 * sin(uT * 2.0 + ph * 5.0);
          vC = col; vKind = aKind; vRot = aRot + uT * 0.15;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float vd = max(-mv.z, 0.001);
          float sz = hsize * (0.12 + 0.88 * g);
          gl_PointSize = (g < 0.02) ? 0.0 : clamp(sz * uProj / vd, 1.0, 48.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        precision mediump float;
        varying vec3 vC; varying float vKind; varying float vRot;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          if (vKind > 0.5) {
            float d = length(uv) * 2.0;
            if (d > 1.0) discard;
            gl_FragColor = vec4(vC, 1.0 - smoothstep(0.6, 1.0, d));
            return;
          }
          float s = sin(vRot), c = cos(vRot);
          vec2 q = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
          float halfW = 0.34 * (1.0 - (2.0 * q.y) * (2.0 * q.y));
          if (q.y < -0.5 || q.y > 0.5 || abs(q.x) > halfW) discard;
          float a = 1.0 - smoothstep(0.55, 1.0, abs(q.x) / max(halfW, 1e-3));
          float rib = smoothstep(0.06, 0.0, abs(q.x));
          gl_FragColor = vec4(vC * (0.9 + 0.35 * rib), a);
        }`,
    })
    const fmesh = new THREE.Points(fg, foliageMat)
    fmesh.frustumCulled = false
    scene.add(fmesh)
  }

  // ─── PÉTALOS QUE CAEN: pool reciclable, mismo patrón que el bosque.
  const leafAnchors = []
  for (let i = 0; i < folKind.length; i++) {
    if (folKind[i] === 0) leafAnchors.push(
      folPos[i * 3], folPos[i * 3 + 1], folPos[i * 3 + 2],
      folCol[i * 3], folCol[i * 3 + 1], folCol[i * 3 + 2],
      folFall[i * 3], folFall[i * 3 + 1], folFall[i * 3 + 2])
  }
  const FALL_N = 220
  const fallPos = new Float32Array(FALL_N * 3).fill(-9999)
  const fallCol = new Float32Array(FALL_N * 3)
  const fallVy = new Float32Array(FALL_N)
  const fallPh = new Float32Array(FALL_N)
  const fallKind = new Float32Array(FALL_N)
  const fallRot = new Float32Array(FALL_N)
  const fallActive = new Uint8Array(FALL_N)
  let fallHead = 0, fallBudget = 0, petalBudget = 0
  const fallGeo = new THREE.BufferGeometry()
  fallGeo.setAttribute('position', new THREE.BufferAttribute(fallPos, 3))
  fallGeo.setAttribute('hcol', new THREE.BufferAttribute(fallCol, 3))
  fallGeo.setAttribute('aKind', new THREE.BufferAttribute(fallKind, 1))
  fallGeo.setAttribute('aRot', new THREE.BufferAttribute(fallRot, 1))
  const fallMesh = new THREE.Points(fallGeo, new THREE.ShaderMaterial({
    uniforms: { uProj: draw.uniforms.uProj, uT: draw.uniforms.uT },
    transparent: true, depthWrite: false,
    vertexShader: `
      attribute vec3 hcol; attribute float aKind; attribute float aRot;
      uniform float uProj, uT;
      varying vec3 vC; varying float vKind; varying float vRot;
      void main() {
        vC = hcol; vKind = aKind; vRot = aRot + uT * 2.0;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float vd = max(-mv.z, 0.001);
        gl_PointSize = clamp(0.85 * uProj / vd, 1.0, 48.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision mediump float;
      varying vec3 vC; varying float vKind; varying float vRot;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        if (vKind > 0.5) {
          float d = length(uv) * 2.0;
          if (d > 1.0) discard;
          gl_FragColor = vec4(vC, 1.0 - smoothstep(0.6, 1.0, d));
          return;
        }
        float s = sin(vRot), c = cos(vRot);
        vec2 q = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
        float halfW = 0.34 * (1.0 - (2.0 * q.y) * (2.0 * q.y));
        if (q.y < -0.5 || q.y > 0.5 || abs(q.x) > halfW) discard;
        float a = 1.0 - smoothstep(0.55, 1.0, abs(q.x) / max(halfW, 1e-3));
        float rib = smoothstep(0.06, 0.0, abs(q.x));
        gl_FragColor = vec4(vC * (0.9 + 0.35 * rib), a);
      }`,
  }))
  fallMesh.frustumCulled = false
  scene.add(fallMesh)
  function updateFallingLeaves(step, rate, autumn, petalRate) {
    if (leafAnchors.length && rate > 0) {
      fallBudget += rate * step
      while (fallBudget >= 1) {
        fallBudget -= 1
        const a = ((Math.random() * (leafAnchors.length / 9)) | 0) * 9
        const i = fallHead; fallHead = (fallHead + 1) % FALL_N
        fallPos[i * 3] = leafAnchors[a]; fallPos[i * 3 + 1] = leafAnchors[a + 1]; fallPos[i * 3 + 2] = leafAnchors[a + 2]
        fallCol[i * 3] = leafAnchors[a + 3] + (leafAnchors[a + 6] - leafAnchors[a + 3]) * autumn
        fallCol[i * 3 + 1] = leafAnchors[a + 4] + (leafAnchors[a + 7] - leafAnchors[a + 4]) * autumn
        fallCol[i * 3 + 2] = leafAnchors[a + 5] + (leafAnchors[a + 8] - leafAnchors[a + 5]) * autumn
        fallVy[i] = 1.4 + Math.random() * 1.6; fallPh[i] = Math.random() * 6.28
        fallKind[i] = 0; fallRot[i] = Math.random() * 6.28; fallActive[i] = 1
      }
    }
    if (petalAnchors.length && petalRate > 0) {
      petalBudget += petalRate * step
      while (petalBudget >= 1) {
        petalBudget -= 1
        const a = ((Math.random() * (petalAnchors.length / 6)) | 0) * 6
        const i = fallHead; fallHead = (fallHead + 1) % FALL_N
        fallPos[i * 3] = petalAnchors[a]; fallPos[i * 3 + 1] = petalAnchors[a + 1]; fallPos[i * 3 + 2] = petalAnchors[a + 2]
        fallCol[i * 3] = petalAnchors[a + 3]; fallCol[i * 3 + 1] = petalAnchors[a + 4]; fallCol[i * 3 + 2] = petalAnchors[a + 5]
        fallVy[i] = 0.6 + Math.random() * 0.8; fallPh[i] = Math.random() * 6.28
        fallKind[i] = 1; fallRot[i] = 0; fallActive[i] = 1
      }
    }
    for (let i = 0; i < FALL_N; i++) {
      if (!fallActive[i]) continue
      fallPos[i * 3 + 1] -= fallVy[i] * step
      fallPos[i * 3] += Math.sin(clock * 2.0 + fallPh[i]) * 1.5 * step
      fallPos[i * 3 + 2] += Math.cos(clock * 1.7 + fallPh[i] * 1.3) * 1.5 * step
      if (fallPos[i * 3 + 1] < we - 0.5) { fallActive[i] = 0; fallPos[i * 3 + 1] = -9999 }
    }
    fallGeo.attributes.position.needsUpdate = true
    fallGeo.attributes.hcol.needsUpdate = true
    fallGeo.attributes.aKind.needsUpdate = true
    fallGeo.attributes.aRot.needsUpdate = true
  }

  // ─── An: POLVO/BRUMA — puerto fiel ──────────────────────────────────────
  // 2400 puntos naranjas, más densos cerca del borde de manzana (`an` =
  // distancia con signo a la manzana más cercana; `rnd() > exp(-s/3)`
  // descarta a medida que uno se aleja de las 7 unidades de rango). Mesh y
  // shader PROPIOS (no pasa por `draw`): ShaderMaterial con tamaño de punto
  // en unidades de mundo (clamp 1..96px, tamaño base 2.6-7.8) y color fijo
  // naranja `(1,.52,.15)` con blending aditivo — mismo patrón que el shader
  // de puntos de `draw`, pero el bundle real lo arma aparte para este
  // efecto puntual. Se reusa el MISMO objeto `draw.uniforms.uProj` para que
  // el resize hook existente también actualice esta malla sin duplicar
  // wiring.
  function An() {
    const target = 2400
    const pos = []
    const size = []
    let r = 0
    for (let i = target * 8; r < target && i-- > 0;) {
      const a = (rnd() * 2 - 1) * Wt
      const o = (rnd() * 2 - 1) * Wt
      const s = an(a, o)
      if (s < 0.1 || s > 7 || rnd() > Math.exp(-s / 3)) continue
      pos.push(a, we + 0.25 + rnd() * 2.4, o)
      size.push(2.6 + rnd() * 5.2)
      r++
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('hsize', new THREE.BufferAttribute(new Float32Array(size), 1))
    const dustMaterial = new THREE.ShaderMaterial({
      uniforms: { uProj: draw.uniforms.uProj },
      vertexShader: [
        'attribute float hsize; uniform float uProj;',
        'void main(){',
        '  vec4 mv=modelViewMatrix*vec4(position,1.0);',
        '  gl_PointSize=clamp(hsize*uProj/max(-mv.z,0.001),1.0,96.0);',
        '  gl_Position=projectionMatrix*mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'precision mediump float;',
        'void main(){',
        '  vec2 uv=gl_PointCoord-0.5; float d2=dot(uv,uv);',
        '  if(d2>0.25) discard;',
        '  float a=1.0-sqrt(d2)*2.0; a=a*a*0.13;',
        '  gl_FragColor=vec4(1.0,0.52,0.15,1.0)*a;',
        '}',
      ].join('\n'),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    })
    const pts = new THREE.Points(geo, dustMaterial)
    pts.frustumCulled = false
    scene.add(pts)
  }
  An()

  // IMPORTANTE: finalizePoints/finalizeLines suben los buffers de `draw` a
  // la GPU una sola vez. Todo `draw.pushPoint`/`draw.pushLine` (los tallos y
  // cabezas de flor de `kn`) debe empujarse ANTES de esta llamada — no
  // después de ella. `Dn` (pasto) y `An` (polvo) NO pasan por `draw`: arman
  // su propia malla, como el bundle real.
  floraMat = new THREE.LineBasicMaterial({ vertexColors: true })
  draw.finalizeLines(scene, floraMat)
  draw.finalizePoints(scene)

  // ─── NEBLINA aditiva (halo naranja, acento de la ciudad) ─────────────────
  const haze = createHaze(scene, {
    R: R_CITY, G: we, count: rc.hazeCount, color: CITY_HAZE_COLOR, alpha: rc.hazeAlpha,
    heightFn: (x, z) => ln(x, z),
  })

  // ─── AGENTES DE CIUDAD: roster (`Pn`), init (`In`) y física (`Rn`) ────────
  // Puerto fiel de la rama CIUDAD del bundle real
  // (`.superpowers/port/city-agents-real.min.js`): mismo kit de geometría
  // que el bosque (`createAgentKit`/`scene.js`), pero con reparto de
  // especies, escala, asignación dweller/tráfico y física de movimiento
  // propias de la ciudad. Todo está gobernado por FLAGS del agente
  // (`dweller`, `offroad`, `kind`), nunca por nombre.
  const TRAF_H = { whiteC: 3.2, cyanC: 3.2, eye: 3, flag: 2.72, dbl: 1.5 }
  const kit = createAgentKit(rc)
  const { fatLine, edgesOf, ringLoop, creature, wedge } = kit

  // `Pn` (rama ciudad): pool ponderado, reparto proporcional, shuffle y
  // relleno de faltantes desde un subconjunto reducido.
  function buildRoster(count) {
    const pool = [['whiteC', 3], ['cyanC', 4], ['flag', 4], ['dbl', 3], ['eye', 2]]
    let total = 0
    for (const [, w] of pool) total += w
    const out = []
    for (const [kind, w] of pool) {
      const share = Math.max(1, Math.round(w / total * count))
      for (let c = 0; c < share; c++) out.push(kind)
    }
    for (let a = out.length - 1; a > 0; a--) {
      const l = (rnd() * (a + 1)) | 0
      const tmp = out[a]; out[a] = out[l]; out[l] = tmp
    }
    while (out.length < count) out.push(pick(['cyanC', 'flag', 'dbl', 'whiteC']))
    out.length = count
    return out
  }

  // Geometría por especie: idéntica a la del bosque (`scene.js`); `whiteC`
  // es la única variante nueva (misma jaula cúbica que `cyanC`, en blanco).
  function buildAgentVisual(kind) {
    const group = new THREE.Group()
    let cage = null
    let effR = 3.3, rollMul = 0, glide = false, spinY = 0
    if (kind === 'cyanC' || kind === 'whiteC') {
      cage = new THREE.Group()
      cage.add(edgesOf(new THREE.BoxGeometry(6, 6, 6), kind === 'cyanC' ? PALETTE.cyan : PALETTE.white))
      cage.add(creature(1.15))
      group.add(cage)
      rollMul = 1; effR = 3.3
    } else if (kind === 'eye') {
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
      glide = rnd() < 0.55
      rollMul = glide ? 0 : 0.3
      effR = 6
    } else if (kind === 'flag') {
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
      spinY = 0.5
    } else {
      // 'dbl': dos anillos amarillos y un núcleo naranja.
      const a = ringLoop(1.15, 34, PALETTE.yellow); a.position.y = 0.5
      const b = ringLoop(0.75, 30, PALETTE.yellow); b.position.y = -0.5
      group.add(a); group.add(b)
      group.add(new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10),
        new THREE.MeshBasicMaterial({ color: PALETTE.orange })))
      spinY = 0.7
    }
    return { group, cage, effR, rollMul, glide, spinY }
  }

  // `In` (rama ciudad): escala compacta, altura de tráfico por especie y
  // asignación dweller (vive dentro de una manzana) vs. tráfico (sigue calle).
  const density = cfg.wander.density
  const n = cfg.fireflies.count
  const roster = buildRoster(n)

  // AVES (Task S1): contrato con `worlds/registry.js` — `aerial(i,cfg)` marca
  // aéreos los primeros `round(count*ratio)` slots, `ratio` = proporción de
  // `flying_animal` sobre los agentes MÓVILES de CITY_CENSUS (sin
  // static_object). Se replica el MISMO cálculo acá para que sean EXACTAMENTE
  // los mismos índices los que reciben nombre de ave y los que vuelan de
  // verdad — si algún día ambos cálculos divergen, un pájaro con nombre
  // dejaría de volar (o viceversa), así que cualquier cambio a este bloque
  // debe reflejarse también en `CITY_FLIER_RATIO` de registry.js.
  const CITY_MOVERS = CITY_CENSUS.filter((c) => c.type !== 'static_object')
  const CITY_FLIER_RATIO = CITY_MOVERS.length
    ? CITY_MOVERS.filter((c) => c.type === 'flying_animal').length / CITY_MOVERS.length
    : 0
  const birdCount = Math.min(n, Math.round(n * CITY_FLIER_RATIO))
  // OJO: `src/sim/perch.js` resta un 3.1 fijo (no parametrizable) al calcular
  // `yOff` de un posado (`t.h - 3.1`, ver `updatePerchers`). Para que ese 3.1
  // se cancele exactamente y un ave posada quede a `we + h` (la altura
  // absoluta con la que se registró su `poiPerch`, ni más arriba ni más
  // abajo), la altura base tiene que ser ESE MISMO 3.1 — igual que el bosque,
  // que usa `G + terreno + 3.1 + yOff`. Si perch.js cambia esa constante,
  // hay que actualizar también este valor.
  const BIRD_H0 = 3.1

  const agents = []
  for (let i = 0; i < n; i++) {
    const kind = roster[i]
    const visual = buildAgentVisual(kind)
    const a = {
      group: visual.group, cage: visual.cage, kind,
      effR: visual.effR, colR: 2, rollMul: visual.rollMul, glide: visual.glide, spinY: visual.spinY,
      vel: new THREE.Vector3((rnd() - 0.5) * 2, 0, (rnd() - 0.5) * 2),
      speedScale: 0.6 + rnd() * 0.85,
      wanderAng: rnd() * 6.2832,
      state: 'move', stateT: 1 + rnd() * 4,
      isBird: i < birdCount,
    }
    const c = (0.9 + rnd() * 0.55) * 0.67
    a.group.scale.setScalar(c)
    a.baseScale = c
    a.effR *= c
    a.colR *= c
    a.trafH = (TRAF_H[kind] || 2.4) * c + 0.18

    if (a.isBird) {
      // Ave: no vive en manzana ni sigue calzada — su posición y altura las
      // gobierna el sistema de percha (`updateBirds`, más abajo). Posición
      // inicial provisoria; el primer frame ya la reubica.
      a.dweller = false
      a.offroad = false
      a.group.position.set(0, we + BIRD_H0, 0)
    } else {
      a.dweller = (kind === 'flag' || kind === 'dbl') && rnd() < 0.45 && blocks.length > 0
      if (a.dweller) {
        let found = -1, bx = 0, bz = 0
        for (let tries = 0; tries < 40 && found < 0; tries++) {
          const bi = (rnd() * blocks.length) | 0
          const block = blocks[bi]
          const x = block.cx + (rnd() * 2 - 1) * (block.hx - 3)
          const z = block.cz + (rnd() * 2 - 1) * (block.hz - 3)
          if (nn(block, x, z) < -3 && !un(x, z, 1.5)) { found = bi; bx = x; bz = z }
        }
        if (found >= 0) {
          a.dwB = found
          a.group.position.set(bx, ln(bx, bz) + a.trafH, bz)
          a.speedScale *= 0.4
        } else {
          a.dweller = false
        }
      }
      if (!a.dweller) {
        a.tAxis = rnd() < 0.5 ? 0 : 1
        const roadArr = a.tAxis === 0 ? cutsZ : cutsX
        a.tRoad = (rnd() * roadArr.length) | 0
        a.tDir = rnd() < 0.5 ? -1 : 1
        a.tLane = a.tDir * (0.12 + rnd() * 0.12) * Gt
        a.tCool = 1 + rnd() * 2
        a.offroad = false
        a.offT = 0
        let along = (rnd() * 2 - 1) * qt * 0.85
        const cross = roadArr[a.tRoad] + a.tLane
        for (let tries = 0; tries < 30 && !(an(a.tAxis === 0 ? along : cross, a.tAxis === 0 ? cross : along) > 2); tries++) {
          along = (rnd() * 2 - 1) * qt * 0.85
        }
        if (a.tAxis === 0) a.group.position.set(along, we + a.trafH, cross)
        else a.group.position.set(cross, we + a.trafH, along)
        a.vel.set(a.tAxis === 0 ? a.tDir * 3 : 0, 0, a.tAxis === 1 ? a.tDir * 3 : 0)
      }
    }
    scene.add(a.group)
    agents.push(a)
  }

  // Vuelo/percha de las aves: reusa `src/sim/perch.js` (mismo sistema que el
  // bosque) sobre "roamers" propios normalizados por R_CITY, igual convención
  // que `poiPerch`. El reparto percher/sky es proporcional al del bosque
  // (5:2) pero escalado a `birdCount`, para que NINGÚN pájaro se quede en
  // modo "roam" para siempre sin nunca volar a posarse ni cruzar el cielo.
  const birdPerchers = Math.min(birdCount, Math.round(birdCount * (5 / 7)))
  const birdSky = birdCount - birdPerchers
  const birdBehaviors = { ...cfg.behaviors, perchers: birdPerchers, sky: birdSky }
  const birdRoamers = createRoamers(cfg.wander, birdCount, rnd)
  const perchAgents = createPerchers(birdCount, { startIndex: 0, perchers: birdPerchers, sky: birdSky }, rnd)

  // `Rn` (rama ciudad): separación mutua, deambular por curl-noise (atenuado
  // a 0.3× en tráfico que sigue calzada), contención por SDF de dwellers
  // dentro de su manzana, seguimiento de carril y reincorporación tras
  // salirse de la calzada ("offroad"). Puerto verbatim de la fórmula; ver
  // nota de aproximación en la integración final, donde la fuente se corta.
  const agentGrad = { x: 0, z: 0 }
  const motionTmp = {
    up: new THREE.Vector3(0, 1, 0), dir: new THREE.Vector3(),
    axis: new THREE.Vector3(), q: new THREE.Quaternion(),
  }
  function curl(p, t, out) {
    const r = 0.06, ii = t * 0.18
    out.x = Math.sin(p.z * r + ii) - Math.cos(p.y * r * 1.3 - ii * 0.8)
    out.z = Math.sin(p.x * r * 1.1 + ii * 0.9) - Math.cos(p.z * r + ii * 1.1)
  }
  function separate(step) {
    // Las aves no pisan calle/manzana: se excluyen para que no empujen (ni
    // sean empujadas) por el tráfico de a ras de suelo con su sombra 2D.
    const rad = 24
    for (let s = 0; s < agents.length; s++) {
      if (agents[s].isBird) continue
      const pA = agents[s].group.position
      for (let c = s + 1; c < agents.length; c++) {
        if (agents[c].isBird) continue
        const pB = agents[c].group.position
        const dx = pA.x - pB.x, dz = pA.z - pB.z
        const distSq = dx * dx + dz * dz
        if (distSq < rad * rad && distSq > 0.001) {
          const dist = Math.sqrt(distSq)
          const kf = 13 * (1 - dist / rad) / dist * step
          agents[s].vel.x += dx * kf; agents[s].vel.z += dz * kf
          agents[c].vel.x -= dx * kf; agents[c].vel.z -= dz * kf
        }
      }
    }
  }
  // Orientación: mismo patrón que `updateAgentMotion` del bosque
  // (agents3d.js), adaptado a velocidad directa en unidades de mundo (los
  // agentes de ciudad no usan roamers normalizados). Se comparte entre el
  // tráfico/dwellers (`moveAgents`) y las aves (`updateBirds`).
  function orientAgent(a, step) {
    const wspeed = Math.hypot(a.vel.x, a.vel.z)
    if (a.glide) {
      if (wspeed > 0.05) a.group.rotation.y = Math.atan2(a.vel.x, a.vel.z)
    } else if (a.rollMul > 0 && a.cage && wspeed > 1e-4) {
      motionTmp.dir.set(a.vel.x, 0, a.vel.z).normalize()
      motionTmp.axis.crossVectors(motionTmp.up, motionTmp.dir)
      if (motionTmp.axis.lengthSq() < 1e-5) motionTmp.axis.set(1, 0, 0)
      motionTmp.axis.normalize()
      motionTmp.q.setFromAxisAngle(motionTmp.axis, (wspeed * step) / a.effR * a.rollMul)
      a.cage.quaternion.premultiply(motionTmp.q)
    } else if (a.spinY) {
      a.group.rotation.y += a.spinY * step
    }
  }
  // Vuelo de las aves: roamers normalizados propios (`birdRoamers`) + el
  // sistema de percha del bosque (`src/sim/perch.js`), sobre `poiPerch`
  // (copas de sakura + techos de edificio). `we + BIRD_H0 + yOff` replica
  // la fórmula del bosque (`G + terreno + 3.1 + yOff`): al posarse, `yOff`
  // vale `h - BIRD_H0`, y el `BIRD_H0` se cancela → altura final = `we + h`,
  // exactamente la altura absoluta con la que se registró cada `poiPerch`.
  function updateBirds(step, time) {
    if (!birdCount) return
    updateRoamers(birdRoamers, cfg.wander, step, rnd, time, null, null, null)
    updatePerchers(perchAgents, birdRoamers, poiPerch, birdBehaviors, step, rnd)
    for (let i = 0; i < birdCount; i++) {
      const a = agents[i]
      const r = birdRoamers[i]
      const wx = r.x * R_CITY, wz = r.z * R_CITY
      a.group.position.set(wx, we + BIRD_H0 + perchAgents[i].yOff, wz)
      a.vel.x = r.vx * R_CITY
      a.vel.z = r.vz * R_CITY
      orientAgent(a, step)
    }
  }
  function moveAgents(step, time) {
    separate(step)
    for (let idx = 0; idx < agents.length; idx++) {
      const a = agents[idx]
      if (a.isBird) continue // las aves las mueve `updateBirds`
      const pos = a.group.position

      a.stateT -= step
      if (a.stateT <= 0) {
        if (a.state === 'move') {
          a.state = 'rest'
          a.stateT = (1.2 + rnd() * 3.5) / density
        } else {
          a.state = 'move'
          a.stateT = (2.5 + rnd() * 5) / density
          const kickV = 7 + rnd() * 7
          a.vel.x += Math.cos(a.wanderAng) * kickV
          a.vel.z += Math.sin(a.wanderAng) * kickV
        }
      }
      const T = a.state === 'move' ? 1 : 0.05
      // Tráfico que sigue calzada deambula MUCHO menos que el resto.
      const E = (!a.dweller && !a.offroad) ? 0.3 : 1

      curl(pos, time, agentGrad)
      a.vel.x += agentGrad.x * 3.5 * step * T * E
      a.vel.z += agentGrad.z * 3.5 * step * T * E
      a.wanderAng += (rnd() - 0.5) * 2.2 * step
      a.vel.x += Math.cos(a.wanderAng) * 4.5 * step * T * E
      a.vel.z += Math.sin(a.wanderAng) * 4.5 * step * T * E

      const k = 5.2
      const boundR = Wt * 1.7 // `A` real (city-agents-real.min.js, rama `p.world==='city'`): contención radial de la cola de `Rn`
      let targetY

      if (a.dweller) {
        targetY = ln(pos.x, pos.z) + a.trafH
        if (a.dwB >= blocks.length) a.dwB = 0
        const block = blocks[a.dwB]
        const depth = nn(block, pos.x, pos.z)
        if (depth > -3) {
          // Gradiente de `nn` por diferencias finitas → empuja de vuelta
          // hacia el interior de la manzana, proporcional a cuánto se sale.
          let gx = nn(block, pos.x + 0.6, pos.z) - nn(block, pos.x - 0.6, pos.z)
          let gz = nn(block, pos.x, pos.z + 0.6) - nn(block, pos.x, pos.z - 0.6)
          const glen = Math.hypot(gx, gz) || 1
          gx /= glen; gz /= glen
          const push = (depth + 3) * 5.5 * step
          a.vel.x -= gx * push
          a.vel.z -= gz * push
          if (depth > -1.2) {
            const along = a.vel.x * gx + a.vel.z * gz
            if (along > 0) { a.vel.x -= gx * along; a.vel.z -= gz * along }
          }
        }
      } else if (a.offroad) {
        targetY = ln(pos.x, pos.z) + a.trafH
        a.offT -= step
        const dCenter = Math.hypot(pos.x, pos.z)
        if (dCenter > Wt * 0.9) {
          a.vel.x -= pos.x / dCenter * 6 * step
          a.vel.z -= pos.z / dCenter * 6 * step
        }
        if (a.offT <= 0) {
          a.offroad = false
          let best = 1e9, bestAxis = 0, bestRoad = 0
          for (let ri = 0; ri < cutsZ.length; ri++) {
            const dz2 = Math.abs(pos.z - cutsZ[ri])
            if (dz2 < best) { best = dz2; bestAxis = 0; bestRoad = ri }
          }
          for (let ri = 0; ri < cutsX.length; ri++) {
            const dx2 = Math.abs(pos.x - cutsX[ri])
            if (dx2 < best) { best = dx2; bestAxis = 1; bestRoad = ri }
          }
          a.tAxis = bestAxis
          a.tRoad = bestRoad
          a.tDir = rnd() < 0.5 ? -1 : 1
          a.tLane = a.tDir * (0.12 + rnd() * 0.12) * Gt
          a.tCool = 2
        }
      } else {
        targetY = ln(pos.x, pos.z) + a.trafH
        const roadArr = a.tAxis === 0 ? cutsZ : cutsX
        if (a.tRoad >= roadArr.length) a.tRoad = roadArr.length - 1
        const laneCenter = roadArr[a.tRoad] + a.tLane
        if (a.tAxis === 0) {
          a.vel.z += (laneCenter - pos.z) * 4.8 * step
          a.vel.z *= 1 - 2.6 * step
          a.vel.x += a.tDir * 9 * step * T
        } else {
          a.vel.x += (laneCenter - pos.x) * 4.8 * step
          a.vel.x *= 1 - 2.6 * step
          a.vel.z += a.tDir * 9 * step * T
        }
        a.tCool -= step

        const sdf = an(pos.x, pos.z)
        if (sdf > 0.5 && rnd() < 0.016 * step) {
          a.offroad = true
          a.offT = 5 + rnd() * 8
          on(pos.x, pos.z, agentGrad)
          a.vel.x -= agentGrad.x * 5
          a.vel.z -= agentGrad.z * 5
        }
        if (!a.offroad && sdf > -0.5) {
          const lookAhead = Gt * 0.95 + a.colR
          const aheadBlocked = an(
            pos.x + (a.tAxis === 0 ? a.tDir * lookAhead : 0),
            pos.z + (a.tAxis === 1 ? a.tDir * lookAhead : 0),
          ) < 2
          if (a.tCool <= 0 || aheadBlocked) {
            const crossArr = a.tAxis === 0 ? cutsX : cutsZ
            const along = a.tAxis === 0 ? pos.x : pos.z
            for (let ci = 0; ci < crossArr.length; ci++) {
              if (Math.abs(along - crossArr[ci]) < Gt * 0.5) {
                if (rnd() < 0.55 || aheadBlocked) {
                  a.tAxis = 1 - a.tAxis
                  a.tRoad = ci
                  const newAlong = a.tAxis === 0 ? pos.x : pos.z
                  a.tDir = Math.abs(newAlong) > qt * 0.4 ? (newAlong > 0 ? -1 : 1) : (rnd() < 0.5 ? -1 : 1)
                  if (an(
                    a.tAxis === 0 ? pos.x + a.tDir * Gt * 0.9 : pos.x,
                    a.tAxis === 1 ? pos.z + a.tDir * Gt * 0.9 : pos.z,
                  ) < 2) a.tDir *= -1
                  a.tLane = a.tDir * (0.12 + rnd() * 0.12) * Gt
                  a.tCool = 2.4 + rnd()
                } else {
                  a.tCool = 1.3
                }
                break
              }
            }
          }
          if (aheadBlocked && an(
            pos.x + (a.tAxis === 0 ? a.tDir * Gt * 0.5 : 0),
            pos.z + (a.tAxis === 1 ? a.tDir * Gt * 0.5 : 0),
          ) < 2) {
            a.tDir *= -1
            a.tLane = a.tDir * (0.12 + rnd() * 0.12) * Gt
            a.tCool = 1
          }
          const alongNow = a.tAxis === 0 ? pos.x : pos.z
          if (alongNow * a.tDir > qt) {
            a.tDir *= -1
            a.tLane = a.tDir * (0.12 + rnd() * 0.12) * Gt
            a.tCool = 1.2
          }
          if (Math.abs(alongNow) > Wt * 0.96) {
            if (a.tAxis === 0) { pos.x = (pos.x > 0 ? 1 : -1) * Wt * 0.96; a.vel.x *= -0.3 }
            else { pos.z = (pos.z > 0 ? 1 : -1) * Wt * 0.96; a.vel.z *= -0.3 }
          }
        }
        if (!a.offroad) {
          const clearance = 0.7 + a.colR * 0.35
          if (sdf < clearance) {
            on(pos.x, pos.z, agentGrad)
            pos.x += agentGrad.x * (clearance - sdf) * 0.55
            pos.z += agentGrad.z * (clearance - sdf) * 0.55
            const inward = a.vel.x * agentGrad.x + a.vel.z * agentGrad.z
            if (inward < 0) { a.vel.x -= agentGrad.x * inward * 1.5; a.vel.z -= agentGrad.z * inward * 1.5 }
          }
        }
      }

      a.vel.y += (targetY - pos.y) * k * step
      a.vel.y *= 1 - 2.2 * step
      if (a.state === 'rest') { a.vel.x *= 1 - 1.8 * step; a.vel.z *= 1 - 1.8 * step }

      // Cola real de `Rn` (murmur-bundle.js, offset ~643798, justo después de
      // las ramas por mundo): contención radial contra `boundR` (=`A`, el
      // límite propio de ciudad `Wt*1.7` fijado junto a `k=5.2`), arrastre
      // GENERAL 1-0.6*step (se suma al arrastre de "rest" de arriba, y pega
      // a los TRES ejes vía `vel.multiplyScalar`, no solo x/z), tope de
      // velocidad `7*p.speed*speedScale` (`p.speed=1.8` es una constante fija
      // del bundle — no hay control de UI que la reasigne — así que el tope
      // real es `12.6*speedScale`, sobre el largo 3D del vector) e
      // integración por `addScaledVector`. Reemplaza la aproximación previa
      // (arrastre 1-2*step solo horizontal + tope 9*speedScale en 2D).
      const distC = Math.hypot(pos.x, pos.z)
      if (distC > boundR) {
        const pull = (distC - boundR) * 0.6 * step / distC
        a.vel.x -= pos.x * pull
        a.vel.z -= pos.z * pull
      }
      const genDrag = 1 - 0.6 * step
      a.vel.x *= genDrag
      a.vel.y *= genDrag
      a.vel.z *= genDrag
      const maxSp = 7 * 1.8 * a.speedScale
      const sp = Math.hypot(a.vel.x, a.vel.y, a.vel.z)
      if (sp > maxSp) { const f = maxSp / sp; a.vel.x *= f; a.vel.y *= f; a.vel.z *= f }

      pos.x += a.vel.x * step
      pos.y += a.vel.y * step
      pos.z += a.vel.z * step

      orientAgent(a, step)
    }
  }

  // Precalentamiento (como `In`): 320 pasos de 1/60s antes del primer
  // frame, para que el tráfico, los dwellers y las aves no arranquen
  // "congelados" (las aves ya alcanzan a despegar y posarse una vez).
  let clock = 0
  for (let f = 0; f < 320; f++) { clock += 1 / 60; moveAgents(1 / 60, clock); updateBirds(1 / 60, clock) }

  // Estelas: un único tono rojo/rosa (`en` = #FF3B59), igual para todas las
  // especies — a diferencia del bosque, la ciudad no varía el color de
  // estela por especie.
  const worldPos = new Float32Array(n * 3)
  const trails = createTrails(scene, n, [0xff3b59], rc, draw.pointMaterial)
  const _proj = new THREE.Vector3()
  let _lx = 0, _ly = 0
  let ptrX = null, ptrY = null // posición del mouse en NDC (null = fuera del canvas)
  function setPointer(x, y) { ptrX = x; ptrY = y }
  // El lente fisheye del post-proceso desplaza la posición VISUAL del agente
  // respecto a su NDC lógico (nulo al centro, fuerte al borde). Para que el hover
  // matchee lo que se ve, distorsiono la proyección igual que el shader del lente
  // (mismo puerto que el bosque/estanque/célula, ver `scene.js`).
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

  // ─── CLIMA: lluvia, nieve y nieve acumulada en techos (`capPos`, llenado
  // por `spawnTower` con la cima de cada edificio colocado) ─────────────────
  const rain = createRain(scene, R_CITY, we)
  const snow = createSnow(scene, R_CITY, we, draw.uniforms.uProj)
  const caps = createSnowCaps(scene, capPos, draw.uniforms.uProj)

  stage.setResizeHook((m) => {
    draw.uniforms.uProj.value = m.proj
    haze.uniforms.uProj.value = m.proj
    kit.setResolution(m.w * m.dpr, m.h * m.dpr)
  })

  const tintC = new THREE.Color()
  let snowCover = 0, moveScale = 1
  function update(swarm, dt, eco) {
    const step = dt || 0.016
    clock += step
    draw.uniforms.uT.value = clock

    // El ecosistema pinta la ciudad: tinte de la hora, niebla y neblina del
    // clima — mismo tratamiento que el bosque (`scene.js`), sin manto de
    // nieve en el suelo ni charcos (la ciudad no tiene esos sistemas): acá
    // la nieve solo se acumula como puntos sobre los techos (`caps`).
    if (eco) {
      const L = eco.light, g = eco.gain
      const k = rc.tintStrength
      tintC.setRGB(
        (1 - k + k * L[0]) * g,
        (1 - k + k * L[1]) * g,
        (1 - k + k * L[2]) * g,
      )
      scene.fog.density = 0.0009 + eco.fog * 0.0028
      haze.uniforms.uColor.value.set(
        CITY_HAZE_COLOR[0] * 0.4 + L[0] * 0.6,
        CITY_HAZE_COLOR[1] * 0.4 + L[1] * 0.6,
        CITY_HAZE_COLOR[2] * 0.6 + L[2] * 0.4,
      )
      haze.uniforms.uAlpha.value = rc.hazeAlpha * Math.max(0, eco.fog - 0.12) * 2.4 * (0.5 + g * 0.6)

      // Nieve: solo con frío marcado y algo de lluvia (igual que el bosque).
      const snowing = eco.temperature <= -3 && eco.rain > 0.1
      const snowfall = snowing ? Math.max(0.5, eco.rain) : 0
      snowCover += snowfall * 0.09 * step
      if (eco.temperature > 0 && snowCover > 0) snowCover -= eco.temperature * 0.03 * step
      snowCover = Math.max(0, Math.min(1, snowCover))
      caps.setCover(snowCover)

      // Suelo, pasto y flores viran con el tinte de la hora.
      if (groundMat) groundMat.color.copy(tintC)
      if (grassMat) grassMat.color.copy(tintC)
      if (floraMat) floraMat.color.copy(tintC)

      rain.update(step, snowing ? 0 : eco.rain)
      snow.update(step, clock, snowfall)

      // Con lluvia/nieve el tráfico y los peatones se calman.
      moveScale = snowing ? 0.4 : (1 - eco.rain * 0.45) * (eco.temperature <= 1 ? 0.85 : 1)

      // Estaciones del sakura: mismo reloj que el resto del mundo (`eco.seasonT`,
      // con el mismo fallback local que usa el bosque) → brote → hoja plena →
      // caída, y una ventana de flor donde el canopy se pone rosado. Mismo
      // sistema de follaje/pétalos que `scene.js` (ver bloque "SAKURA" arriba).
      const seasonT = eco.seasonT != null ? eco.seasonT : (clock / 210 + 0.35) % 1
      const leafAmt = seasonT < 0.5 ? smoothstep(0, 0.2, seasonT) : 1 - smoothstep(0.62, 0.8, seasonT)
      const flowerAmt = smoothstep(0.02, 0.1, seasonT) * (1 - smoothstep(0.2, 0.32, seasonT))
      foliageUniforms.uSeason.value = seasonT
      foliageUniforms.uLeaf.value = leafAmt * (1 - eco.rain * 0.3)
      foliageUniforms.uFlower.value = flowerAmt * (1 - eco.rain * 0.7)
      const autumn = smoothstep(0.5, 0.7, seasonT) * (1 - smoothstep(0.8, 0.92, seasonT))
      foliageUniforms.uAutumn.value = autumn
      const gust = eco.rain + (eco.wind || 0) * 0.7
      const shedRate = leafAmt > 0.05 ? (autumn * 34 + gust * 46 * leafAmt) : 0
      const petalRate = foliageUniforms.uFlower.value * (16 + eco.rain * 40 + (eco.wind || 0) * 34)
      updateFallingLeaves(step, shedRate, autumn, petalRate)
    }

    moveAgents(step * moveScale, clock)
    updateBirds(step * moveScale, clock)

    for (let i = 0; i < n; i++) {
      const p = agents[i].group.position
      worldPos[i * 3] = p.x; worldPos[i * 3 + 1] = p.y; worldPos[i * 3 + 2] = p.z
    }

    // Destello: mismo pulso que el bosque (jaula si existe, si no el grupo).
    for (let i = 0; i < n; i++) {
      const a = agents[i]
      const pulse = 1 + swarm.flash[i] * 0.35
      if (a.cage) a.cage.scale.setScalar(pulse)
      else a.group.scale.setScalar(a.baseScale * pulse)
    }

    // Etiqueta: SOLO al pasar el mouse por encima de un agente (no en el centro).
    let bestI = -1
    if (ptrX !== null) {
      let bestD = 0.14 // umbral de "encima" en NDC (agentes chicos y en movimiento)
      for (let i = 0; i < n; i++) {
        _proj.set(worldPos[i * 3], worldPos[i * 3 + 1] + 4, worldPos[i * 3 + 2]).project(camera)
        if (_proj.z > 1) continue // detrás de la cámara
        const [vx, vy] = lensNDC(_proj.x, _proj.y) // NDC VISUAL (con el lente)
        const d = Math.hypot(vx - ptrX, vy - ptrY)
        if (d < bestD) { bestD = d; bestI = i; _lx = vx; _ly = vy }
      }
    }
    if (bestI >= 0 && agentNames[bestI]) {
      const { w, h, ox, oy } = stage.metrics
      labelEl.style.left = ox + (_lx * 0.5 + 0.5) * w + 'px'
      labelEl.style.top = oy + (-_ly * 0.5 + 0.5) * h + 'px'
      labelEl.textContent = agentNames[bestI]
      labelEl.style.opacity = '1'
    } else {
      labelEl.style.opacity = '0'
    }

    trails.update(worldPos)

    stage.render(step)
    return []
  }

  // "Sacudir" la ciudad: empujón radial hacia afuera para cada agente,
  // como el `scare` del bosque pero sobre el arreglo propio de agentes de
  // ciudad (magnitud ajustada a las unidades de mundo del tráfico/curl-
  // noise, no a las unidades normalizadas de los roamers del bosque).
  function scare(strength = 1) {
    for (const a of agents) {
      if (a.isBird) continue
      const pos = a.group.position
      const m = Math.hypot(pos.x, pos.z) || 1e-3
      const kf = (6 + rnd() * 10) * strength
      a.vel.x += (pos.x / m) * kf + (rnd() - 0.5) * kf * 1.5
      a.vel.z += (pos.z / m) * kf + (rnd() - 0.5) * kf * 1.5
      a.state = 'move'
      a.stateT = 1.2 + rnd() * 1.5
    }
    // Las aves reaccionan en su propio sistema de roamers (igual que el
    // bosque, donde `scare` también sacude a los roamers de percher/sky).
    for (const r of birdRoamers) {
      const m = Math.hypot(r.x, r.z) || 1e-3
      const kf = (0.7 + rnd() * 1.1) * strength
      r.vx += (r.x / m) * kf + (rnd() - 0.5) * kf * 1.5
      r.vz += (r.z / m) * kf + (rnd() - 0.5) * kf * 1.5
    }
  }

  return {
    update,
    resize: stage.resize,
    flash: stage.flash,
    scare,
    setPointer,
    dispose: stage.dispose,
  }
}
