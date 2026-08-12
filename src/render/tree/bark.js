// Corteza: los tubos ahusados. Es el `tube()` que estaba enterrado en scene.js
// (y duplicado en city.js), extraído y con dos atributos nuevos por vértice
// (`aYear`, `aBase`) que son lo que permite que el árbol CREZCA sin regenerar
// la malla.

/**
 * @param {Array} branches  salida de growSkeleton
 * @param {object} THREE
 * @param {(x:number,z:number)=>number} noise2  ruido para el relieve de la corteza
 * @param {number} ribs  0 = corteza irregular (árbol); >0 = costillas regulares
 *   (cactus, Task 6). Se declara desde ya para que la firma no cambie después.
 */
export function buildBark(branches, THREE, noise2, ribs = 0) {
  const pos = [], idx = [], years = [], offs = [], bases = []

  for (const b of branches) {
    const spine = b.spine
    const n = spine.length
    const segs = ribs ? 12 : b.r0 > 0.8 ? 9 : b.r0 > 0.35 ? 7 : 5
    const base = pos.length / 3
    const tan = new THREE.Vector3(), up = new THREE.Vector3()
    const bx = new THREE.Vector3(), by = new THREE.Vector3()

    for (let c = 0; c < n; c++) {
      tan.subVectors(spine[Math.min(n - 1, c + 1)], spine[Math.max(0, c - 1)]).normalize()
      up.set(0, 1, 0)
      if (Math.abs(tan.y) > 0.9) up.set(1, 0, 0)
      bx.crossVectors(tan, up).normalize()
      by.crossVectors(tan, bx)
      const h = c / (n - 1)
      const g = b.r0 + (b.r1 - b.r0) * Math.pow(h, 0.85)
      const p = spine[c]
      for (let l = 0; l < segs; l++) {
        const a = (l / segs) * 6.2832
        // Costillas: en el cactus el radio ondula de forma REGULAR alrededor del
        // tubo (las aristas verticales), en vez del relieve irregular del árbol.
        const rad = ribs
          ? g * (1 + Math.cos(a * ribs) * 0.14)
          : g * (1 + (noise2(p.x * 1.4 + l * 3.7, p.z * 1.4 + p.y * 0.9) - 0.5) * 0.34)
        pos.push(
          p.x + (bx.x * Math.cos(a) + by.x * Math.sin(a)) * rad,
          p.y + (bx.y * Math.cos(a) + by.y * Math.sin(a)) * rad,
          p.z + (bx.z * Math.cos(a) + by.z * Math.sin(a)) * rad,
        )
        years.push(b.year)
        offs.push(b.off || 0)
        bases.push(b.base.x, b.base.y, b.base.z)
      }
    }
    for (let c = 0; c < n - 1; c++) {
      for (let l = 0; l < segs; l++) {
        const x = base + c * segs + l
        const s2 = base + c * segs + ((l + 1) % segs)
        idx.push(x, x + segs, s2, s2, x + segs, s2 + segs)
      }
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('aYear', new THREE.BufferAttribute(new Float32Array(years), 1))
  geo.setAttribute('aOff', new THREE.BufferAttribute(new Float32Array(offs), 1))
  geo.setAttribute('aBase', new THREE.BufferAttribute(new Float32Array(bases), 3))
  geo.setIndex(idx)

  const uniforms = { uGrowth: { value: 0 } }

  // El shader de crecimiento: cada vértice se interpola desde el arranque de su
  // rama hasta su posición final. La rama emerge en una ventana CORTA (0.4 de
  // año) que arranca en `aYear + aOff`, no en todo el año: así cada rama se ve
  // "salir" de golpe y escalonada respecto a sus vecinas, en vez de que toda una
  // capa se estire lento y a la vez.
  const onBeforeCompile = (shader) => {
    shader.uniforms.uGrowth = uniforms.uGrowth
    shader.vertexShader = `
      attribute float aYear; attribute float aOff; attribute vec3 aBase; uniform float uGrowth;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `vec3 transformed = mix(aBase, position,
         smoothstep(aYear + aOff, aYear + aOff + 0.4, uGrowth));`,
    )
  }

  return { geometry: geo, uniforms, onBeforeCompile }
}
