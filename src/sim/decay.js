// El sustrato: el tronco podrido y su despensa. La idea central de este mundo
// es que el terreno ES la comida y SE ACABA — se degrada por consumo, no por
// temporizador. `updateDecay` solo mueve efectos cosméticos lentos (la
// corteza que se despega); la clase de descomposición nunca avanza sola.
//
// El tronco es una cápsula alargada (eje con `logAngle`, semilargo
// `logHalfLength`, radio `logRadius`) con tres capas concéntricas según la
// distancia radial AL EJE: duramen (núcleo, durísimo, mucho carbono),
// albura (intermedia, blanda, carbono alto — se agota primero) y corteza
// (borde, media dureza, casi sin carbono). Fuera del tronco hay hojarasca
// (carbono bajo y fácil) y, más lejos, nada.
//
// Los cadáveres son la única fuente real de nitrógeno — la madera casi no
// tiene, y por eso el hongo caza (§4, §6 del spec).
//
// El agotamiento se rastrea en una grilla aparte (una celda = una fracción
// 0..1 ya extraída). Los valores base de recurso se calculan analíticamente
// por posición, así que la grilla solo necesita guardar "cuánto de esta
// celda ya se sacó" — no la composición completa.
// Puro: coordenadas (x,z) normalizadas en [-1,1]. Sin three/DOM.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

// Densidades base por capa (unidades arbitrarias, solo importan entre sí).
const CARBON_BARK = 0.05 // casi nada: la corteza es autopista, no comida
const CARBON_SAPWOOD = 1.0 // alto: se agota primero
const CARBON_HEARTWOOD = 1.6 // muy alto, pero durísimo de extraer
const NITROGEN_WOOD = 0.01 // la madera casi no tiene nitrógeno (por eso se caza)
const CARBON_LITTER = 0.3
const NITROGEN_LITTER = 0.02
const HARDNESS_LITTER = 0.1 // fácil de forrajear

const LITTER_BAND = 0.3 // ancho de la hojarasca más allá del radio del tronco
const CARCASS_RADIUS = 0.05 // radio chico: el nitrógeno es puntual y decisivo
const CARCASS_NITROGEN = 3.0 // muy por encima de lo que da la madera
const HARDNESS_RESISTANCE = 0.7 // cuánto castiga la dureza al rendimiento de `consume`

/** Capa y valores base (sin cadáveres, sin agotamiento) en (x,z). */
function layerAt(cfg, x, z) {
  const ax = Math.cos(cfg.logAngle), az = Math.sin(cfg.logAngle)
  // Proyección sobre el eje del tronco, recortada al semilargo: distancia
  // radial real a la cápsula, no al eje infinito.
  const t = clamp(x * ax + z * az, -cfg.logHalfLength, cfg.logHalfLength)
  const cx = ax * t, cz = az * t
  const radial = Math.hypot(x - cx, z - cz)
  const R = cfg.logRadius

  if (radial <= R) {
    const barkStart = R * (1 - cfg.barkFrac)
    const sapStart = R * (1 - cfg.barkFrac - cfg.sapwoodFrac)
    if (radial >= barkStart) {
      return { layer: 'bark', hardness: cfg.hardness.bark, carbon: CARBON_BARK, nitrogen: NITROGEN_WOOD }
    }
    if (radial >= sapStart) {
      return { layer: 'sapwood', hardness: cfg.hardness.sapwood, carbon: CARBON_SAPWOOD, nitrogen: NITROGEN_WOOD }
    }
    return { layer: 'heartwood', hardness: cfg.hardness.heartwood, carbon: CARBON_HEARTWOOD, nitrogen: NITROGEN_WOOD }
  }

  if (radial <= R + LITTER_BAND) {
    return { layer: 'litter', hardness: HARDNESS_LITTER, carbon: CARBON_LITTER * (cfg.litterDensity ?? 1), nitrogen: NITROGEN_LITTER }
  }
  return { layer: 'none', hardness: 0, carbon: 0, nitrogen: 0 }
}

/** Capa + el nitrógeno extra de los cadáveres que estén cerca de (x,z). */
function sampleBase(cfg, x, z) {
  const base = layerAt(cfg, x, z)
  let nitrogen = base.nitrogen
  for (const c of cfg.carcasses) {
    const d = Math.hypot(x - c.x, z - c.z)
    if (d < c.radius) {
      // Decae del centro al borde para no dejar un escalón visible.
      nitrogen += CARCASS_NITROGEN * (1 - d / c.radius)
    }
  }
  return { layer: base.layer, hardness: base.hardness, carbon: base.carbon, nitrogen }
}

function cellIndex(gridSize, x, z) {
  let ix = Math.floor(((x + 1) / 2) * gridSize)
  let iz = Math.floor(((z + 1) / 2) * gridSize)
  ix = clamp(ix, 0, gridSize - 1)
  iz = clamp(iz, 0, gridSize - 1)
  return iz * gridSize + ix
}

/**
 * @param {object} cfg  { logAngle, logHalfLength, logRadius, barkFrac,
 *                         sapwoodFrac, carcasses, litterDensity, gridSize,
 *                         hardness: {bark, sapwood, heartwood} }
 */
export function createSubstrate(cfg, rand = Math.random) {
  const gridSize = cfg.gridSize
  const count = cfg.carcasses ?? 0
  const carcasses = []
  for (let i = 0; i < count; i++) {
    // Dispersos: no hay una zona preferida, son un hallazgo.
    carcasses.push({ x: rand() * 2 - 1, z: rand() * 2 - 1, radius: CARCASS_RADIUS })
  }
  return {
    cfg: { ...cfg, carcasses },
    grid: new Float32Array(gridSize * gridSize), // 0 = nada consumido todavía
    barkPeel: 0, // efecto cosmético lento, ver updateDecay
  }
}

/** Recurso disponible AHORA en (x,z): base de la capa menos lo ya consumido. */
export function resourceAt(sub, x, z) {
  const remaining = 1 - sub.grid[cellIndex(sub.cfg.gridSize, x, z)]
  const base = sampleBase(sub.cfg, x, z)
  return {
    carbon: base.carbon * remaining,
    nitrogen: base.nitrogen * remaining,
    hardness: base.hardness,
    layer: base.layer,
  }
}

/**
 * Extrae de (x,z) hasta `amount` de esfuerzo. La dureza castiga el
 * rendimiento por unidad de esfuerzo, y la extracción es siempre una
 * FRACCIÓN de lo que queda — nunca un monto fijo — así que agotar la misma
 * celda una y otra vez rinde cada vez menos, sin necesidad de casos
 * especiales cerca del final.
 * @returns {{carbon:number, nitrogen:number}} lo realmente extraído
 */
export function consume(sub, x, z, amount) {
  if (!(amount > 0)) return { carbon: 0, nitrogen: 0 }
  const idx = cellIndex(sub.cfg.gridSize, x, z)
  const remaining = 1 - sub.grid[idx]
  if (remaining <= 0) return { carbon: 0, nitrogen: 0 }

  const base = sampleBase(sub.cfg, x, z)
  const totalBase = base.carbon + base.nitrogen
  if (totalBase <= 0) return { carbon: 0, nitrogen: 0 }

  const remainingMass = remaining * totalBase
  const efficiency = Math.max(0, 1 - base.hardness * HARDNESS_RESISTANCE)
  const extractedMass = remainingMass * (1 - Math.exp(-amount * efficiency))
  if (extractedMass <= 0) return { carbon: 0, nitrogen: 0 }

  sub.grid[idx] = Math.min(1, sub.grid[idx] + extractedMass / totalBase)
  return {
    carbon: extractedMass * (base.carbon / totalBase),
    nitrogen: extractedMass * (base.nitrogen / totalBase),
  }
}

/**
 * Avanza efectos lentos y puramente cosméticos (la corteza se despega con
 * la clase de descomposición). NO toca la grilla de agotamiento: la clase
 * misma solo cambia por `consume`, nunca por el paso del tiempo.
 */
export function updateDecay(sub, cfg, dt) {
  const target = (decayClass(sub) - 1) / 4
  const peelRate = 0.08 // por segundo — se desprende de a poco, no de golpe
  sub.barkPeel += (target - sub.barkPeel) * Math.min(1, peelRate * dt)
  return sub
}

/**
 * 1..5, derivado de la FRACCIÓN de carbono del TRONCO (bark+sapwood+
 * heartwood, no la hojarasca) ya consumida. 1 = entero y duro,
 * 5 = montículo con la silueta apenas.
 */
export function decayClass(sub) {
  const gridSize = sub.cfg.gridSize
  let totalCarbon = 0
  let consumedCarbon = 0
  for (let iz = 0; iz < gridSize; iz++) {
    const z = ((iz + 0.5) / gridSize) * 2 - 1
    for (let ix = 0; ix < gridSize; ix++) {
      const x = ((ix + 0.5) / gridSize) * 2 - 1
      const L = layerAt(sub.cfg, x, z)
      if (L.layer === 'bark' || L.layer === 'sapwood' || L.layer === 'heartwood') {
        totalCarbon += L.carbon
        consumedCarbon += L.carbon * sub.grid[iz * gridSize + ix]
      }
    }
  }
  if (totalCarbon <= 0) return 1
  const frac = consumedCarbon / totalCarbon
  return clamp(1 + Math.floor(frac * 5), 1, 5)
}
