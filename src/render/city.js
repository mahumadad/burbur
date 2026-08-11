import * as THREE from 'three'
import { createStage } from './stage.js'
import { createDraw } from './engine/points.js'
import { cityGrid } from './cityGrid.js'
import { fbm } from './noise.js'

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

  // ─── EDIFICIOS: torres translúcidas en capas ("matrix") ────────────────
  // Cada torre es una pila de losas finas (pisos), no una caja sólida.
  // El glow no usa luces ni post-proceso: es la superposición de losas
  // semitransparentes con blending aditivo (igual que el resto del proyecto),
  // más el wireframe + nube de puntos por vértice que funde la silueta con
  // el punteado del suelo, tal como hacen las rocas del bosque (scene.js).
  {
    // Cachés por tinte: la paleta tiene solo 6 colores, así que se reusa un
    // material de losa y uno de wireframe por tinte en vez de crear uno por
    // losa/torre (con ~12 bloques × hasta 2 torres × varios pisos, crear un
    // material por losa dispararía el conteo sin cambiar el look).
    const slabMatCache = new Map()
    const wireMatCache = new Map()
    function slabMaterial(tint) {
      let m = slabMatCache.get(tint)
      if (!m) {
        m = new THREE.MeshBasicMaterial({
          color: new THREE.Color(tint[0], tint[1], tint[2]),
          transparent: true, opacity: 0.13,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
        })
        slabMatCache.set(tint, m)
      }
      return m
    }
    function wireMaterial(tint) {
      let m = wireMatCache.get(tint)
      if (!m) {
        m = new THREE.LineBasicMaterial({
          color: new THREE.Color(tint[0] * 0.6, tint[1] * 0.6, tint[2] * 0.6),
          transparent: true, opacity: 0.2, fog: true,
        })
        wireMatCache.set(tint, m)
      }
      return m
    }

    // Geometría de losa compartida: un cubo unitario escalado por instancia
    // (mesh.scale) en vez de una BoxGeometry nueva por losa — mismo look,
    // muchas menos geometrías en memoria. El wireframe se deriva del mismo
    // cubo y se escala igual; sus 8 vértices (esquinas del cubo unitario)
    // son la base de los puntos "matrix" por losa.
    const unitBox = new THREE.BoxGeometry(1, 1, 1)
    const unitWire = new THREE.WireframeGeometry(unitBox)
    const UNIT_CORNERS = [
      [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
      [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
    ]

    const TOWER_INSET = 4.5   // margen desde el borde de la manzana (pasto/flores de B7)
    const FLOOR_GAP = 3.2     // separación vertical entre pisos (centro a centro)
    const SLAB_THICK = 1.0    // grosor de cada losa
    const TAPER_MIN = 0.55    // angostamiento del piso más alto vs. la base (setback)

    // Apila `floors` losas desde `baseY`, todas del mismo tinte, reusando la
    // caché de materiales y el cubo unitario compartido. Devuelve la altura
    // del techo (Y del borde superior de la última losa). Factor común entre
    // las torres (bn/yn) y la estructura secundaria baja (Sn edificios bajos,
    // wn mobiliario): ninguna de las dos duplica la maquinaria de materiales
    // ni geometría, solo varían footprint, cantidad de pisos y tinte.
    function stackSlabs(cx, cz, w, d, floors, baseY, tint, taperMin = TAPER_MIN) {
      const mat = slabMaterial(tint)
      const wmat = wireMaterial(tint)
      let roofY = baseY
      for (let i = 0; i < floors; i++) {
        const tFloor = floors > 1 ? i / (floors - 1) : 0
        const taper = 1 - (1 - taperMin) * tFloor
        const sw = w * taper
        const sd = d * taper
        const y = baseY + SLAB_THICK / 2 + i * FLOOR_GAP
        // Jitter leve por piso: rompe el aspecto de bloque perfecto, ayuda a
        // que el volumen se lea orgánico y se "derrita" hacia el suelo.
        const px = cx + (rnd() * 2 - 1) * 0.3
        const pz = cz + (rnd() * 2 - 1) * 0.3

        const mesh = new THREE.Mesh(unitBox, mat)
        mesh.position.set(px, y, pz)
        mesh.scale.set(sw, SLAB_THICK, sd)
        scene.add(mesh)

        const wf = new THREE.LineSegments(unitWire, wmat)
        wf.position.copy(mesh.position)
        wf.scale.copy(mesh.scale)
        scene.add(wf)

        for (const [ux, uy, uz] of UNIT_CORNERS) {
          draw.pushPoint(px + ux * sw, y + uy * SLAB_THICK, pz + uz * sd, tint, 0.28, 0)
        }
        roofY = y + SLAB_THICK / 2
      }
      return roofY
    }

    function buildTower(block, blockTint) {
      const r = Math.min(block.hx, block.hz) * 2
      // Footprint: proporcional a r, con jitter, inscripto con margen dentro
      // del bloque para dejar sitio al borde (pasto/flores, tarea B7).
      const maxHalfX = Math.max(2, block.hx - TOWER_INSET)
      const maxHalfZ = Math.max(2, block.hz - TOWER_INSET)
      const w = Math.min(maxHalfX * 2, r * (0.35 + rnd() * 0.3))
      const d = Math.min(maxHalfZ * 2, r * (0.35 + rnd() * 0.3))
      // Offset dentro del bloque (no siempre centrada).
      const freeX = Math.max(0, maxHalfX - w / 2)
      const freeZ = Math.max(0, maxHalfZ - d / 2)
      const cx = block.cx + (rnd() * 2 - 1) * freeX
      const cz = block.cz + (rnd() * 2 - 1) * freeZ
      // Altura: mayor en bloques grandes, con jitter para variar la silueta.
      const H = (12 + r * 0.85) * (0.65 + rnd() * 0.7)
      const floors = Math.max(3, Math.min(20, Math.round(H / FLOOR_GAP)))
      const baseY = we + Kt
      const tint = rnd() < 0.66 ? blockTint : BUILDING_PALETTE[(rnd() * BUILDING_PALETTE.length) | 0]
      const roofY = stackSlabs(cx, cz, w, d, floors, baseY, tint)
      poiPerch.push({ x: cx / R_CITY, z: cz / R_CITY, h: roofY - we })
      capPos.push(cx, roofY, cz)
    }

    // `bn` del original: por bloque, probabilidad de torre según su tamaño;
    // los bloques grandes pueden recibir una 2ª torre desplazada.
    function placeBuildings() {
      for (const block of blocks) {
        const r = Math.min(block.hx, block.hz) * 2
        const prob = (r >= 20 ? 0.85 : r >= 14 ? 0.5 : 0.2) * TOWERS
        const blockTint = BUILDING_PALETTE[(rnd() * BUILDING_PALETTE.length) | 0]
        if (rnd() < prob) buildTower(block, blockTint)
        if (r >= 40 && rnd() < 0.6 * Math.min(TOWERS, 1.5)) buildTower(block, blockTint)
      }
    }
    placeBuildings()

    // `Sn` del original: 3–6 volúmenes bajos (1–2 pisos), offset aleatorio
    // dentro de un bloque al azar. Mismo look de losa/matrix que las torres
    // pero chicos; no se registran como percha (son mobiliario, no hito).
    function buildLowBuilding() {
      const block = pick(blocks)
      const r = Math.min(block.hx, block.hz) * 2
      const maxHalfX = Math.max(2, block.hx - TOWER_INSET)
      const maxHalfZ = Math.max(2, block.hz - TOWER_INSET)
      const w = Math.min(maxHalfX * 2, r * (0.2 + rnd() * 0.25))
      const d = Math.min(maxHalfZ * 2, r * (0.2 + rnd() * 0.25))
      const freeX = Math.max(0, maxHalfX - w / 2)
      const freeZ = Math.max(0, maxHalfZ - d / 2)
      const cx = block.cx + (rnd() * 2 - 1) * freeX
      const cz = block.cz + (rnd() * 2 - 1) * freeZ
      const floors = 1 + ((rnd() * 2) | 0) // 1–2 pisos
      const blockTint = pick(BUILDING_PALETTE)
      const tint = rnd() < 0.66 ? blockTint : pick(BUILDING_PALETTE)
      stackSlabs(cx, cz, w, d, floors, we + Kt, tint)
    }
    function placeLowBuildings() {
      const n = 3 + ((rnd() * 4) | 0) // 3..6
      for (let i = 0; i < n; i++) buildLowBuilding()
    }
    placeLowBuildings()

    // `wn` del original: 1–3 muebles urbanos, cajas bajas de un solo piso
    // (sin taper) en tinte apagado — no deben competir en brillo con las
    // torres, así que usan un gris neutro fijo en vez de la paleta viva.
    const FURNITURE_TINT = [0.5, 0.52, 0.55]
    function buildFurniture() {
      const block = pick(blocks)
      const w = 5.5 + rnd() * 1.5
      const d = 3.4 + rnd() * 0.6
      const maxHalfX = Math.max(2, block.hx - 2)
      const maxHalfZ = Math.max(2, block.hz - 2)
      const freeX = Math.max(0, maxHalfX - w / 2)
      const freeZ = Math.max(0, maxHalfZ - d / 2)
      const cx = block.cx + (rnd() * 2 - 1) * freeX
      const cz = block.cz + (rnd() * 2 - 1) * freeZ
      stackSlabs(cx, cz, w, d, 1, we + Kt, FURNITURE_TINT, 1)
    }
    function placeFurniture() {
      const n = 1 + ((rnd() * 3) | 0) // 1..3
      for (let i = 0; i < n; i++) buildFurniture()
    }
    placeFurniture()
  }

  // ─── FAROLAS: postes con foco de color cerca del bordillo ─────────────
  // `Cn` del original: 3–7 por mundo, paleta exacta de 5 colores (§B.2 de
  // la spec). El poste es una línea (oscura en la base, con el color de la
  // luz arriba) y el foco es un punto más grande que los de las torres —
  // visible pero secundario frente al glow apilado de los edificios.
  {
    const LAMP_COLORS = [
      [0.16, 0.30, 0.98], // #294CFA
      [1, 0.83, 0.20],    // #FFD433
      [1, 0.35, 0.55],    // #FF598C
      [0.35, 0.90, 0.85], // #59E6D9
      [1, 0.48, 0.09],    // #FF7A17
    ]
    const POST_H_MIN = 5, POST_H_RANGE = 2
    const lampMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, fog: true })
    const n = 3 + ((rnd() * 5) | 0) // 3..7
    for (let i = 0; i < n; i++) {
      // Ubicación sobre el borde (bordillo) de un bloque al azar: un lado
      // elegido al azar, punto a lo largo de ese lado también al azar.
      const block = pick(blocks)
      const edge = (rnd() * 4) | 0
      let x, z
      if (edge === 0) { x = block.cx + block.hx; z = block.cz + (rnd() * 2 - 1) * block.hz }
      else if (edge === 1) { x = block.cx - block.hx; z = block.cz + (rnd() * 2 - 1) * block.hz }
      else if (edge === 2) { z = block.cz + block.hz; x = block.cx + (rnd() * 2 - 1) * block.hx }
      else { z = block.cz - block.hz; x = block.cx + (rnd() * 2 - 1) * block.hx }
      const gy = ln(x, z) // exactamente en el borde ⇒ nivel de calle (we)
      const postH = POST_H_MIN + rnd() * POST_H_RANGE
      const col = pick(LAMP_COLORS)
      const dim = [col[0] * 0.35, col[1] * 0.35, col[2] * 0.35]
      draw.pushLine(x, gy, z, x, gy + postH, z, dim, col)
      draw.pushPoint(x, gy + postH, z, col, 1.0, 0)
    }
    draw.finalizeLines(scene, lampMat)
  }

  // ─── CHARCOS: parches grises reflectantes en bordes de manzana ────────
  // `Tn` del original: color exacto #B8BDC9 con vertexColors, apenas sobre
  // el nivel de calle (`we`). El bundle no reveló una cantidad exacta para
  // esta función (sin confirmar en la spec) — se eligió un puñado acorde
  // al resto del mobiliario, no es un número de paridad.
  {
    const PUDDLE_COL = [0.72, 0.74, 0.79]
    const puddleMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.3, side: THREE.DoubleSide, fog: true,
    })
    const n = 4 + ((rnd() * 5) | 0) // 4..8, elección propia (ver comentario arriba)
    for (let i = 0; i < n; i++) {
      const block = pick(blocks)
      const edge = (rnd() * 4) | 0
      let cx, cz, alongX
      if (edge === 0) { cx = block.cx + block.hx; cz = block.cz + (rnd() * 2 - 1) * block.hz * 0.6; alongX = false }
      else if (edge === 1) { cx = block.cx - block.hx; cz = block.cz + (rnd() * 2 - 1) * block.hz * 0.6; alongX = false }
      else if (edge === 2) { cz = block.cz + block.hz; cx = block.cx + (rnd() * 2 - 1) * block.hx * 0.6; alongX = true }
      else { cz = block.cz - block.hz; cx = block.cx + (rnd() * 2 - 1) * block.hx * 0.6; alongX = true }
      const pw = alongX ? 3 + rnd() * 2 : 1.6 + rnd()
      const pd = alongX ? 1.6 + rnd() : 3 + rnd() * 2
      const geo = new THREE.PlaneGeometry(pw, pd)
      geo.rotateX(-Math.PI / 2)
      const count = geo.attributes.position.count
      const cols = new Float32Array(count * 3)
      for (let v = 0; v < count; v++) {
        cols[v * 3] = PUDDLE_COL[0]; cols[v * 3 + 1] = PUDDLE_COL[1]; cols[v * 3 + 2] = PUDDLE_COL[2]
      }
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
      const mesh = new THREE.Mesh(geo, puddleMat)
      mesh.position.set(cx, we + 0.05, cz)
      scene.add(mesh)
    }
  }

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
