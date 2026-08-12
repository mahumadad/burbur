// Atlas de follaje generado en CANVAS — cero assets binarios, cero red.
// Cuatro celdas de 256×256 en una textura de 512×512:
//   (0,0) racimo de hoja   (1,0) racimo de flor
//   (0,1) fruto            (1,1) hoja suelta
// El RACIMO es el truco de rendimiento: cinco siluetas dibujadas en una celda
// dan la densidad de cinco hojas al costo de una instancia.

import { leafShape } from './leafShape.js'
import { SPECIES } from './species.js'

const CELDA = 256

function pintarPoligono(ctx, pts, cx, cy, escala, rot, color) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(rot)
  ctx.beginPath()
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i][0] * escala, y = pts[i][1] * escala
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

const rgb = (c, k = 1) => {
  const v = (i) => Math.max(0, Math.min(255, Math.round(c[i] * 255 * k)))
  return `rgb(${v(0)},${v(1)},${v(2)})`
}

/**
 * Fruto como ESFERA sombreada, no un disco plano: gradiente radial del reflejo
 * (arriba-izquierda) al borde en sombra, más un brillo especular. Así la manzana
 * se ve redonda de verdad en vez de una pelota roja chata.
 */
function pintarFruto(ctx, cx, cy, r, base, alto) {
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.12, cx, cy, r)
  g.addColorStop(0, rgb(alto, 1.12))     // reflejo cálido
  g.addColorStop(0.5, rgb(base))
  g.addColorStop(1, rgb(base, 0.45))     // borde en sombra
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = g; ctx.fill()
  // Brillo especular: un puntito claro descentrado.
  ctx.beginPath(); ctx.arc(cx - r * 0.34, cy - r * 0.4, r * 0.17, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill()
}

/**
 * Cinco siluetas repartidas en la celda, para que el racimo se lea como copa.
 * Si `centro` viene dado (flores), pinta además un puntito de estambres al medio
 * de cada silueta.
 */
function pintarRacimo(ctx, pts, ox, oy, colores, centro = null) {
  // Cinco siluetas SEPARADAS y más chicas: antes iban grandes (0.6–0.86) y muy
  // encimadas en el centro, así que se fundían en una mancha y "no se veía la
  // forma de hoja". Ahora se reparten por la celda con poco solape, cada una
  // apuntando distinto, y se leen como hojas sueltas.
  const disposicion = [
    [0.50, 0.28, 0.50, 0.0], [0.26, 0.44, 0.44, -0.9], [0.74, 0.44, 0.44, 0.9],
    [0.36, 0.72, 0.42, 2.7], [0.66, 0.70, 0.42, -2.6],
  ]
  for (let i = 0; i < disposicion.length; i++) {
    const [fx, fy, esc, rot] = disposicion[i]
    const c = colores[i % colores.length]
    // Las de atrás van más oscuras: da profundidad sin luz real.
    const k = i === 0 ? 1 : 0.78
    const cx = ox + fx * CELDA, cy = oy + fy * CELDA
    pintarPoligono(ctx, pts, cx, cy, esc * CELDA, rot, rgb(c, k))
    if (centro) {
      ctx.beginPath()
      ctx.arc(cx, cy, esc * CELDA * 0.14, 0, Math.PI * 2)
      ctx.fillStyle = rgb(centro, k)
      ctx.fill()
    }
  }
}

/** @returns {THREE.CanvasTexture} */
export function buildAtlas(especie, THREE) {
  const def = SPECIES[especie]
  const cv = document.createElement('canvas')
  cv.width = 512; cv.height = 512
  const ctx = cv.getContext('2d')
  ctx.clearRect(0, 0, 512, 512)

  // El cactus (Task 6) no tiene hoja (`colors.leaf: null`): pasa por acá
  // porque `flowerOnly` lo hace pedir atlas, pero solo necesita la celda de
  // flor — las celdas de hoja se dejan en blanco.
  const hoja = leafShape(especie, 'leaf')
  if (def.colors.leaf) {
    pintarRacimo(ctx, hoja, 0, 0, def.colors.leaf)
  }

  if (def.colors.flower) {
    pintarRacimo(ctx, leafShape(especie, 'flower'), CELDA, 0, def.colors.flower, def.colors.center)
  }
  if (def.colors.fruit) {
    pintarFruto(ctx, CELDA * 0.5, CELDA * 1.5, CELDA * 0.34,
      def.colors.fruit[0], def.colors.fruit[1] || def.colors.fruit[0])
  }
  if (def.colors.leaf) {
    pintarPoligono(ctx, hoja, CELDA * 1.5, CELDA * 1.5, CELDA * 0.9, 0, rgb(def.colors.leaf[0]))
  }

  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  return tex
}
