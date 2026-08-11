// COSTRA DE ROCA compartida entre mundos: líquenes y musgos como los reales.
//
// La clave visual (referencias de roca chilena): NO son puntitos sueltos y
// uniformes, son PARCHES.
//   · Liquen  = roseta plana que crece hacia afuera desde un centro; borde más
//     denso que el interior (el talo viejo se desgasta). Naranja (Xanthoria) o
//     gris-verde pálido (Parmelia).
//   · Musgo   = cúmulo ABULTADO, verde intenso, que corona la parte alta de la
//     piedra; con volumen (los puntos se apilan un poco hacia arriba).
//
// Ambas funciones sólo necesitan un `push(x, y, z, color, size, phase)` — el
// mundo decide de dónde salen los puntos (su acumulador de `engine/points.js`).

const rnd = Math.random

// Xanthoria (naranja-mostaza) y Parmelia (gris-verde pálido): los dos líquenes
// que más se ven sobre piedra húmeda.
export const LICHEN_ORANGE = [1.0, 0.62, 0.06]
export const LICHEN_PALE = [0.72, 0.78, 0.72]

/**
 * Roseta de liquen: anillos concéntricos con el borde más denso, salpicada de
 * lóbulos para que el contorno quede irregular (no un círculo perfecto).
 */
export function lichenRosette(push, x, y, z, {
  radius = 0.9, color = LICHEN_ORANGE, density = 1, size = 0.11,
} = {}) {
  const rings = 3 + ((rnd() * 3) | 0)
  // Lóbulos: deforman el radio según el ángulo → contorno de talo, no un disco.
  const lobes = 3 + ((rnd() * 4) | 0)
  const lobeAmp = 0.16 + rnd() * 0.22
  const phase = rnd() * 6.2832
  for (let r = 1; r <= rings; r++) {
    const t = r / rings                    // 0 centro → 1 borde
    const rr = radius * t
    // Borde más poblado que el centro (el talo crece hacia afuera).
    const count = Math.max(3, Math.round((6 + 22 * t * t) * density))
    for (let i = 0; i < count; i++) {
      const a = (i / count) * 6.2832 + rnd() * 0.25
      const wob = 1 + Math.sin(a * lobes + phase) * lobeAmp
      const d = rr * wob * (0.92 + rnd() * 0.16)
      const A = 0.86 + rnd() * 0.2         // moteado dentro del parche
      push(
        x + Math.cos(a) * d, y + 0.04 + rnd() * 0.03, z + Math.sin(a) * d,
        [color[0] * A, color[1] * A, color[2] * A],
        size * (0.75 + rnd() * 0.5), 0,
      )
    }
  }
}

/**
 * Cúmulo de musgo: manojo abultado (semiesfera de puntos) verde intenso. Los
 * puntos suben con el radio invertido → se lee como colchón, no como mancha.
 */
export function mossClump(push, x, y, z, {
  radius = 1.1, height = 0.5, density = 1, size = 0.2,
} = {}) {
  const count = Math.max(8, Math.round((70 + rnd() * 60) * density))
  for (let i = 0; i < count; i++) {
    const a = rnd() * 6.2832
    // sqrt → reparto parejo en el disco; el centro queda igual de tupido.
    const t = Math.sqrt(rnd())
    const d = radius * t
    // Domo: alto en el centro, se desvanece en el borde.
    const up = height * (1 - t * t) * (0.55 + rnd() * 0.75)
    // Verde vivo con variación (musgo fresco vs seco).
    const g = 0.52 + rnd() * 0.36
    push(
      x + Math.cos(a) * d, y + 0.05 + up, z + Math.sin(a) * d,
      [0.10 + rnd() * 0.12, g, 0.09 + rnd() * 0.1],
      size * (0.7 + rnd() * 0.6), 0,
    )
  }
}
