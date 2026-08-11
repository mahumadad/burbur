import * as THREE from 'three'
import { createStage } from './stage.js'
import { createDraw } from './engine/points.js'
import { cityGrid } from './cityGrid.js'
import { fbm } from './noise.js'
import { createBoxBuilder, rgbToHex, shadeGeometry } from './boxbuilder.js'

const rnd = Math.random
// Selección aleatoria uniforme de un elemento de un arreglo (paletas, colores).
function pick(arr) { return arr[(rnd() * arr.length) | 0] }

// Constantes de paridad (reversed del bundle original, tabla `hg`/geometría de ciudad):
//   Wt = medio-lado de la cuadrícula, Gt = ancho de calle, Kt = altura de bordillo,
//   we = nivel de suelo de la calle. R_CITY = radio aproximado del bloque.
const Wt = 62, Gt = 13, Kt = 2.4, we = -4
const R_CITY = Wt * 1.18
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
// `p.towers` del original: multiplicador global de la probabilidad de torre
// por bloque. Valor de paridad = 1 (no expuesto como opción todavía).
const TOWERS = 1

// Mundo CIUDAD ("Block ecosystem"). Usa el stage compartido; el suelo es el
// puerto fiel de `pn`/`mn`/`ln` del bundle original: retícula 150×150 con
// altura y color por SDF a manzana redondeada, más "polvo" suelto (sin
// wireframe: el original no le pone uno). Edificios, agentes y clima
// llegan en tareas posteriores.
export function createCityScene(container, cfg, agentNames = []) {
  const rc = cfg.render
  const stage = createStage(container, cfg)
  const { scene } = stage
  const draw = createDraw(rc)

  // Puntos de interés registrados para tareas siguientes (coordenadas
  // normalizadas por R_CITY, igual que el bosque normaliza por su radio):
  // cima de cada torre para que los agentes se posen ahí (Task 13/B8) y
  // posiciones de techo para que la nieve los cubra (Task 14/B9).
  const poiPerch = []
  const capPos = []

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
    scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true })))

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

  stage.setResizeHook((m) => { draw.uniforms.uProj.value = m.proj })

  // IMPORTANTE: finalizePoints sube el buffer de puntos a la GPU una sola vez.
  // Las tareas siguientes (edificios, pasto, polvo, agentes) deben empujar
  // sus puntos con draw.pushPoint ANTES de esta llamada — no después de ella.
  draw.finalizePoints(scene)

  function update(swarm, dt, eco) {
    stage.render(dt || 0.016)
    return []
  }

  // Temporal: la sacudida no tiene efecto aún hasta que haya agentes/mundo real.
  function scare(strength) {}

  return {
    update,
    resize: stage.resize,
    flash: stage.flash,
    scare,
    dispose: stage.dispose,
  }
}
