import { hash2 } from './noise.js'

// Placas de corteza. La corteza de un tronco viejo (pino, roble) no es una serie
// de surcos paralelos: son PLACAS poligonales irregulares separadas por fisuras
// profundas casi negras. Eso es un diagrama de Voronoi, así que esto es un Worley
// (celular) sobre una grilla jitterada: para cada punto de la superficie devuelve
// cuán adentro de su placa está y qué placa es.
//
// El dominio es (u, θ) sobre el tubo del tronco. θ ENVUELVE en un número entero
// de celdas: si no, la corteza mostraría una costura donde el tubo cierra.

const TAU = Math.PI * 2

/**
 * @param {number} u        posición a lo largo del eje del tronco
 * @param {number} th       ángulo alrededor del eje (rad, se envuelve solo)
 * @param {number} around   celdas alrededor del contorno (entero, para cerrar)
 * @param {number} along    celdas por unidad de eje — menos que `around` por
 *                          unidad de arco, así las placas salen alargadas a lo
 *                          largo del tronco, como en un tronco real
 * @returns {{edge:number, id:number}} `edge` 0 en la fisura → 1 en el centro de
 *          la placa; `id` en [0,1) constante dentro de cada placa
 */
export function barkCell(u, th, around = 16, along = 6) {
  const gx = u * along
  const gy = ((((th % TAU) + TAU) % TAU) / TAU) * around
  const ix = Math.floor(gx), iy = Math.floor(gy)
  let f1 = Infinity, f2 = Infinity, bi = 0, bj = 0
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const ci = ix + di, cj = iy + dj
      // La celda se identifica por su índice ENVUELTO, pero el punto semilla se
      // coloca en el índice sin envolver: misma placa a ambos lados de la costura.
      const wj = ((cj % around) + around) % around
      const px = ci + 0.15 + 0.7 * hash2(ci, wj)
      const py = cj + 0.15 + 0.7 * hash2(wj + 37, ci * 2 + 11)
      const d = Math.hypot(px - gx, py - gy)
      if (d < f1) { f2 = f1; f1 = d; bi = ci; bj = wj }
      else if (d < f2) { f2 = d }
    }
  }
  // f2 - f1 es la distancia al bisector: 0 justo sobre la fisura.
  const edge = Math.min(1, (f2 - f1) / 0.45)
  return { edge, id: hash2(bi * 13 + 5, bj * 7 + 3) }
}
