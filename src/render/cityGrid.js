// Puerto fiel de `tn()` (bundle minificado real de murmur): genera la retícula de
// calles y las manzanas (bloques), incluyendo la fusión de celdas adyacentes en
// grupos ("pair" / "ell" / "three") que le da a murmur sus manzanas irregulares.
// Sin dependencias de three ni del DOM: randomness solo vía `rnd` inyectado.
export function cityGrid({ Wt, Gt, streets, palette }, rnd = Math.random) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

  // e(count) del original: posiciones de calle (centros) para un eje, según el nº
  // de calles en ese eje (1..4).
  function streetCuts(count) {
    const n = Wt / 86
    let cuts
    if (count <= 1) {
      cuts = [(rnd() - 0.5) * 24 * n]
    } else if (count === 2) {
      cuts = [-(20 + rnd() * 14) * n, (20 + rnd() * 14) * n]
    } else if (count === 3) {
      cuts = [-(38 + rnd() * 10) * n, (rnd() - 0.5) * 12 * n, (38 + rnd() * 10) * n]
    } else {
      cuts = [-(48 + rnd() * 8) * n, -(15 + rnd() * 4) * n, (15 + rnd() * 4) * n, (48 + rnd() * 8) * n]
    }
    cuts.sort((a, b) => a - b)
    return cuts
  }

  const t = clamp(Math.round(streets), 1, 4)
  let nX = t
  let nZ = Math.min(4, t + (rnd() < 0.4 ? 1 : 0))
  if (rnd() < 0.5) { const tmp = nX; nX = nZ; nZ = tmp }
  const cutsX = streetCuts(nX) // Jt
  const cutsZ = streetCuts(nZ) // Yt

  const half = Wt * 0.99

  // o() del original: convierte cortes de calle en tramos [inicio,fin] entre
  // calles, cavando el ancho de calle Gt alrededor de cada corte.
  function spans(cuts) {
    const out = []
    let start = -half
    for (let i = 0; i < cuts.length; i++) {
      out.push([start, cuts[i] - Gt * 0.5])
      start = cuts[i] + Gt * 0.5
    }
    out.push([start, half])
    return out
  }

  const colSpans = spans(cutsX) // s (eje x)
  const rowSpans = spans(cutsZ) // c (eje z)

  // l: celdas rectangulares de la grilla (se descartan las más angostas que 12).
  const cells = []
  for (let ix = 0; ix < colSpans.length; ix++) {
    const x0 = colSpans[ix][0], x1 = colSpans[ix][1]
    for (let iz = 0; iz < rowSpans.length; iz++) {
      const z0 = rowSpans[iz][0], z1 = rowSpans[iz][1]
      if (x1 - x0 < 12 || z1 - z0 < 12) continue
      cells.push({ ix, iz, x0, x1, z0, z1, grp: -1 })
    }
  }

  // f() del original: busca una celda por índice de grilla.
  function findCell(ix, iz) {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].ix === ix && cells[i].iz === iz) return cells[i]
    }
    return null
  }

  // m/h del original: cuánto se ha usado cada "gap" entre columnas/filas para
  // fusiones, así no se fusiona una misma calle en todas las filas/columnas.
  const usedX = new Array(cutsX.length).fill(0) // m
  const usedZ = new Array(cutsZ.length).fill(0) // h

  // _() del original: bordes compartidos entre las celdas de un grupo candidato.
  function sharedEdges(group) {
    const edges = []
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j]
        if (a.iz === b.iz && Math.abs(a.ix - b.ix) === 1) edges.push(['x', Math.min(a.ix, b.ix)])
        if (a.ix === b.ix && Math.abs(a.iz - b.iz) === 1) edges.push(['z', Math.min(a.iz, b.iz)])
      }
    }
    return edges
  }

  // v() del original.
  function hasCapacity(edges) {
    for (const [axis, idx] of edges) {
      if (axis === 'x') { if (usedX[idx] >= rowSpans.length - 1) return false }
      else { if (usedZ[idx] >= colSpans.length - 1) return false }
    }
    return true
  }

  // y() del original.
  function useEdges(edges) {
    for (const [axis, idx] of edges) {
      if (axis === 'x') usedX[idx]++
      else usedZ[idx]++
    }
  }

  // Bucle de fusión (b/x/S del original): intenta agrupar celdas vecinas en
  // pares, L ("ell") o triples ("three"). Nota: el bloque `if(!(!v(j)&&(...)))`
  // del original equivale a: commit directo si v(j) es válido; si no y el grupo
  // tenía 3 celdas, degradarlo a par y reintentar; si sigue inválido, abandonar.
  const groups = [] // b
  const attempts = Math.round(cells.length / 3.2) + 1
  for (let s = 0; s < attempts; s++) {
    if (rnd() > 0.78) continue
    const c0 = cells[rnd() * cells.length | 0]
    if (c0.grp >= 0) continue
    let w = rnd() < 0.5 ? 1 : 0
    let tAxis = 1 - w
    if (rnd() < 0.5) { w = -w; tAxis = -tAxis }
    const c1 = findCell(c0.ix + w, c0.iz + tAxis)
    if (!c1 || c1.grp >= 0) continue
    const group = [c0, c1]
    let shape = 'pair'
    if (rnd() < 0.6) {
      const wantThree = rnd() < 0.45
      let c2
      if (wantThree) {
        c2 = findCell(c1.ix + w, c1.iz + tAxis)
      } else {
        const dIx = tAxis === 0 ? 0 : (rnd() < 0.5 ? 1 : -1)
        const dIz = w === 0 ? 0 : (rnd() < 0.5 ? 1 : -1)
        c2 = findCell(c1.ix + dIx, c1.iz + dIz)
      }
      if (c2 && c2.grp < 0) {
        group.push(c2)
        shape = wantThree ? 'three' : 'ell'
      }
    }
    let edges = sharedEdges(group)
    let ok = hasCapacity(edges)
    if (!ok && group.length === 3) {
      group.pop()
      shape = 'pair'
      edges = sharedEdges(group)
      ok = hasCapacity(edges)
    }
    if (!ok) continue
    useEdges(edges)
    for (const cell of group) cell.grp = groups.length
    groups.push({ cells: group, shape })
  }

  const blocks = [] // Xt

  // P() del original.
  function pushBlock(x0, x1, z0, z1, tint) {
    const w = x1 - x0, d = z1 - z0
    const cr = Math.min(4 + rnd() * 10, Math.min(w, d) * 0.32)
    blocks.push({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: w / 2, hz: d / 2, cr, tint, area: w * d })
  }

  // F() del original: caja envolvente de un conjunto de celdas.
  function boundingBox(group) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const cell of group) {
      x0 = Math.min(x0, cell.x0); x1 = Math.max(x1, cell.x1)
      z0 = Math.min(z0, cell.z0); z1 = Math.max(z1, cell.z1)
    }
    return [x0, x1, z0, z1]
  }

  let paletteIdx = rnd() * palette.length | 0
  for (const group of groups) {
    const tint = palette[paletteIdx % palette.length]
    paletteIdx += 1 + (rnd() * 2 | 0)
    if (group.shape === 'ell') {
      // Una "ell" emite dos bloques (uno por sub-rectángulo de la L).
      const box1 = boundingBox([group.cells[0], group.cells[1]])
      const box2 = boundingBox([group.cells[1], group.cells[2]])
      pushBlock(box1[0], box1[1], box1[2], box1[3], tint)
      pushBlock(box2[0], box2[1], box2[2], box2[3], tint)
    } else {
      const box = boundingBox(group.cells)
      pushBlock(box[0], box[1], box[2], box[3], tint)
    }
  }

  // Celdas que no quedaron en ningún grupo: cada una es su propio bloque.
  for (const cell of cells) {
    if (cell.grp >= 0) continue
    const tint = palette[paletteIdx % palette.length]
    paletteIdx += 1 + (rnd() * 2 | 0)
    pushBlock(cell.x0, cell.x1, cell.z0, cell.z1, tint)
  }

  return { blocks, cutsX, cutsZ, groupCount: groups.length }
}
