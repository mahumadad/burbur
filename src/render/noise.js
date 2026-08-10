// Ruido de valor 2D coherente. Puro: sin three/DOM.
// Se usa para peinar el pasto en corrientes y para los campos del terreno.

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}

function smooth(t) {
  return t * t * (3 - 2 * t)
}

/** Ruido de valor en [0,1]. */
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = smooth(xf), v = smooth(yf)
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

/** Ruido fractal (varias octavas) en [0,1]. */
export function fbm(x, y, octaves = 3) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq) * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}
