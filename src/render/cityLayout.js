// Generador puro de la retícula de calles → bloques (manzanas) de la ciudad.
// Sin dependencias de three ni del DOM: recibe `rnd` inyectable para tests deterministas.
export function cityLayout({ Wt, Gt, streets }, rnd = Math.random) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  let nx = clamp(Math.round(streets), 1, 4)
  let nz = clamp(nx + (rnd() < 0.4 ? 1 : 0), 1, 4)
  if (rnd() < 0.5) { const t = nx; nx = nz; nz = t }
  // Posiciones de calle equiespaciadas por eje (excluye los bordes).
  const cuts = (n) => Array.from({ length: n }, (_, i) => -Wt + (2 * Wt) * (i + 1) / (n + 1))
  const xs = cuts(nx), zs = cuts(nz)
  const streetLines = [
    ...xs.map((at) => ({ axis: 'x', at })),
    ...zs.map((at) => ({ axis: 'z', at })),
  ]
  // Bordes de franja por eje: [-Wt, ...calles±Gt/2..., Wt] → intervalos de bloque.
  const spans = (cutsArr) => {
    const edges = [-Wt]
    for (const c of cutsArr) { edges.push(c - Gt / 2, c + Gt / 2) }
    edges.push(Wt)
    const out = []
    for (let i = 0; i < edges.length; i += 2) {
      const lo = edges[i], hi = edges[i + 1]
      if (hi - lo > 1) out.push({ c: (lo + hi) / 2, h: (hi - lo) / 2 })
    }
    return out
  }
  const sx = spans(xs), sz = spans(zs)
  const blocks = []
  for (const bx of sx) for (const bz of sz) {
    blocks.push({ cx: bx.c, cz: bz.c, hx: bx.h, hz: bz.h })
  }
  return { blocks, streetLines }
}
