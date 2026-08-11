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

const rgb = (c, k = 1) =>
  `rgb(${Math.round(c[0] * 255 * k)},${Math.round(c[1] * 255 * k)},${Math.round(c[2] * 255 * k)})`

/** Cinco siluetas repartidas en la celda, para que el racimo se lea como copa. */
function pintarRacimo(ctx, pts, ox, oy, colores) {
  const disposicion = [
    [0.50, 0.50, 0.86, 0.0], [0.30, 0.34, 0.66, -0.7], [0.70, 0.32, 0.66, 0.6],
    [0.32, 0.70, 0.60, 2.4], [0.70, 0.70, 0.60, -2.2],
  ]
  for (let i = 0; i < disposicion.length; i++) {
    const [fx, fy, esc, rot] = disposicion[i]
    const c = colores[i % colores.length]
    // Las de atrás van más oscuras: da profundidad sin luz real.
    const k = i === 0 ? 1 : 0.78
    pintarPoligono(ctx, pts, ox + fx * CELDA, oy + fy * CELDA, esc * CELDA, rot, rgb(c, k))
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
    pintarRacimo(ctx, leafShape(especie, 'flower'), CELDA, 0, def.colors.flower)
  }
  if (def.colors.fruit) {
    pintarPoligono(ctx, leafShape(especie, 'fruit'),
      CELDA * 0.5, CELDA * 1.5, CELDA * 0.8, 0, rgb(def.colors.fruit[0]))
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
