export const PENTATONIC = [0, 2, 4, 7, 9]

export function flashToFreq(y, boundsY, rootHz = 220, octaves = 3) {
  const scale = []
  for (let o = 0; o < octaves; o++) for (const s of PENTATONIC) scale.push(o * 12 + s)
  const t = Math.max(0, Math.min(1, (y + boundsY) / (2 * boundsY)))
  const idx = Math.min(scale.length - 1, Math.floor(t * (scale.length - 1) + 1e-9))
  return rootHz * Math.pow(2, scale[idx] / 12)
}
