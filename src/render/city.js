import * as THREE from 'three'
import { createStage } from './stage.js'
import { createDraw } from './engine/points.js'
import { cityLayout } from './cityLayout.js'
import { noise2, fbm } from './noise.js'

const rnd = Math.random

// Constantes de paridad (reversed del bundle original, tabla `hg`/geometría de ciudad):
//   Wt = medio-lado de la cuadrícula, Gt = ancho de calle, Kt = altura de bordillo,
//   we = nivel de suelo de la calle. R_CITY = radio aproximado del bloque.
const Wt = 62, Gt = 13, Kt = 2.4, we = -4
const R_CITY = Wt * 1.18
// `p.streets` en el bundle original vale 2 (no está en CONFIG del proyecto):
// valor de paridad fijo, no expuesto todavía como opción.
const STREETS = 2

// Mundo CIUDAD ("Block ecosystem"). Usa el stage compartido; el terreno es la
// retícula real de calles/manzanas con look "matrix" (malla + wireframe +
// nube de puntos mate), igual que el suelo del bosque en scene.js. Edificios,
// agentes y clima llegan en tareas posteriores.
export function createCityScene(container, cfg, agentNames = []) {
  const rc = cfg.render
  const stage = createStage(container, cfg)
  const { scene } = stage
  const draw = createDraw(rc)

  // Retícula de calles → manzanas. Se mantiene en el scope de la factory:
  // las tareas siguientes (edificios, pasto, polvo, rutas de agentes) la
  // necesitan para saber qué es calle y qué es manzana.
  const layout = cityLayout({ Wt, Gt, streets: STREETS }, rnd)

  // Distancia (en unidades de mundo) desde (x,z) a la línea de calle más cercana.
  function streetDist(x, z) {
    let d = Infinity
    for (const line of layout.streetLines) {
      const v = line.axis === 'x' ? Math.abs(x - line.at) : Math.abs(z - line.at)
      if (v < d) d = v
    }
    return d
  }

  // Ancho de la transición calle→bordillo: entre el espaciado de vértice
  // (side/150 ≈ 0.97) y un par de unidades, para que el borde no aliasee.
  const EDGE_SMOOTH = 1.5
  // 1 sobre manzana, 0 sobre calle (mitad de ancho Gt/2), con rampa suave
  // (smoothstep) entre medias — evita el escalón duro que aliasea en la grilla.
  function onBlock(x, z) {
    const t = Math.max(0, Math.min(1, (streetDist(x, z) - Gt / 2) / EDGE_SMOOTH))
    return t * t * (3 - 2 * t)
  }

  // Ruido de bordillo: textura fina de la superficie de la manzana. `fbm` no
  // está normalizado (media ≈ 0.4375 con 3 octavas, ver noise.js) — se resta
  // esa media para centrar el ruido en 0 antes de escalar a una amplitud chica.
  function kerbNoise(x, z) {
    return (fbm(x * 0.18 + 11.3, z * 0.18 - 6.4, 3) - 0.4375) * 0.6
  }

  // Altura del terreno: we (nivel de calle) en la calle, we+Kt+ruido en la
  // manzana (bordillo elevado), con la transición de onBlock entre medias.
  function terrainHeight(x, z) {
    return we + (Kt + kerbNoise(x, z)) * onBlock(x, z)
  }

  // Paleta urbana: asfalto gris-azulado desaturado en calle, tono más cálido
  // y algo más claro en la superficie de manzana. Todo oscuro a propósito:
  // el mundo se renderiza sobre negro y el brillo aditivo de los edificios
  // (tareas siguientes) tiene que dominar sobre el suelo.
  const STREET_COL = [0.085, 0.095, 0.115]
  const BLOCK_COL = [0.150, 0.130, 0.105]

  // ─── SUELO: cuadrícula 150×150 con calles hundidas y manzanas en bordillo ──
  {
    const SEGS = 150
    const side = Wt * 2.35
    const geo = new THREE.PlaneGeometry(side, side, SEGS, SEGS)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    const cols = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      const m = onBlock(x, z)
      pos.setY(i, terrainHeight(x, z))
      // Leve variación de tono ligada al mismo ruido que da la altura, para
      // que la manzana no se lea como un color plano.
      const shade = 1 + kerbNoise(x, z) * 0.2
      cols[i * 3] = STREET_COL[0] + (BLOCK_COL[0] * shade - STREET_COL[0]) * m
      cols[i * 3 + 1] = STREET_COL[1] + (BLOCK_COL[1] * shade - STREET_COL[1]) * m
      cols[i * 3 + 2] = STREET_COL[2] + (BLOCK_COL[2] * shade - STREET_COL[2]) * m
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    const groundMat = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: true,
    })
    scene.add(new THREE.Mesh(geo, groundMat))

    // "Matrix": la malla triangulada del suelo, visible como wireframe tenue.
    scene.add(new THREE.LineSegments(
      new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x3a4a5c, transparent: true, opacity: 0.12, fog: true }),
    ))

    // Punteado del suelo: nube de puntos mate sembrada sobre el terreno.
    // Densidad menor que el suelo del bosque (42000 pts sobre un disco de
    // radio 85): la ciudad tiene una extensión más chica y, sobre todo, la
    // mayor parte del detalle fino lo van a aportar los edificios en tareas
    // siguientes — no conviene saturar el suelo de antemano. Se sesga el
    // muestreo hacia las manzanas (más puntos que en la calle, como el
    // grano del asfalto vs. la superficie de la vereda/manzana).
    const PT_COUNT = 9000
    const spos = new Float32Array(PT_COUNT * 3)
    const scol = new Float32Array(PT_COUNT * 3)
    let sn = 0
    for (let i = 0; i < PT_COUNT * 2.2 && sn < PT_COUNT; i++) {
      const x = (rnd() - 0.5) * side
      const z = (rnd() - 0.5) * side
      const m = onBlock(x, z)
      if (rnd() > 0.15 + 0.85 * m) continue
      const shade = 1 + kerbNoise(x, z) * 0.2
      const T = sn * 3
      spos[T] = x
      spos[T + 1] = terrainHeight(x, z) + 0.12
      spos[T + 2] = z
      scol[T] = STREET_COL[0] + (BLOCK_COL[0] * shade - STREET_COL[0]) * m
      scol[T + 1] = STREET_COL[1] + (BLOCK_COL[1] * shade - STREET_COL[1]) * m
      scol[T + 2] = STREET_COL[2] + (BLOCK_COL[2] * shade - STREET_COL[2]) * m
      sn++
    }
    for (let i = 0; i < sn; i++) {
      const T = i * 3
      draw.pushPoint(spos[T], spos[T + 1], spos[T + 2], [scol[T], scol[T + 1], scol[T + 2]], 0.45, 0)
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
