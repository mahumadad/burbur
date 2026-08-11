// Siluetas de hoja, flor y fruto como POLÍGONOS. Puro: sin canvas y sin DOM, así
// que la parte interesante (que la silueta del abedul no sea la del sakura) se
// puede testear. leafAtlas.js es el que lo pinta.
//
// Convención: polígono cerrado, en el cuadrado unitario centrado en (0,0).

import { SPECIES } from './species.js'

const N = 48   // puntos del contorno

const FORMA_POR_DEFECTO = { width: 0.55, tip: 1.5, lobes: 7, lobeDepth: 0.06 }

/**
 * @param {string} especie  clave de SPECIES
 * @param {'leaf'|'flower'|'fruit'} tipo
 * @returns {Array<[number, number]>}
 */
export function leafShape(especie, tipo = 'leaf') {
  const s = (SPECIES[especie] && SPECIES[especie].shape) || {}
  if (tipo === 'fruit') return circulo(0.42, 0)
  if (tipo === 'flower') {
    const petalos = s.petals || 5
    return circulo(0.44, petalos, 0.13)   // margarita: lóbulos anchos
  }
  const f = { ...FORMA_POR_DEFECTO, ...(s.leaf || {}) }
  const pts = []
  for (let i = 0; i < N; i++) {
    const t = i / N
    const v = t * 2 - 1                       // -1 (base) .. 1 (punta)
    // Perfil: ancho máximo hacia el centro, cerrando en punta arriba.
    const cuerpo = Math.pow(Math.max(0, 1 - v * v), 0.5 / f.tip)
    const dentado = 1 + Math.sin(t * Math.PI * 2 * f.lobes) * f.lobeDepth
    const x = cuerpo * f.width * 0.5 * dentado
    const y = v * 0.5
    pts.push([x, y])
  }
  // Espejo para cerrar el contorno por el otro lado.
  for (let i = N - 1; i >= 0; i--) pts.push([-pts[i][0], pts[i][1]])
  return pts
}

/** Círculo, opcionalmente lobulado (para las flores). */
function circulo(r, lobulos, prof = 0) {
  const pts = []
  for (let i = 0; i < N * 2; i++) {
    const a = (i / (N * 2)) * Math.PI * 2
    const rr = lobulos ? r * (1 + Math.cos(a * lobulos) * prof) : r
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr])
  }
  return pts
}
