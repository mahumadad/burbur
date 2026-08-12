// Follaje: racimos instanciados. Cada instancia son DOS QUADS PERPENDICULARES
// (técnica EZ-Tree) con la celda del atlas que le corresponde, así el racimo se
// lee desde cualquier ángulo en vez de girar siempre hacia la cámara como
// hacían los puntos.

/**
 * Geometría base: dos quads en cruz, 8 vértices, 4 triángulos. Instanciada
 * (no BufferGeometry normal): un THREE.Mesh con InstancedBufferAttribute
 * necesita InstancedBufferGeometry, si no las instancias no se dibujan.
 */
function geometriaCruz(THREE) {
  const g = new THREE.InstancedBufferGeometry()
  const h = 0.5
  const pos = new Float32Array([
    -h, -h, 0, h, -h, 0, h, h, 0, -h, h, 0,     // quad A (plano XY)
    0, -h, -h, 0, -h, h, 0, h, h, 0, h, -h,     // quad B (plano ZY)
  ])
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1])
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
  return g
}

/** Interpola linealmente entre dos colores [r,g,b]. */
const mezclar = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

/**
 * @param {Array} tips        salida de growSkeleton
 * @param {object} def        SPECIES[especie]. Si `def.flowerOnly` es true
 *   (el cactus, Task 6), el racimo generado es SOLO de flor y se coloca
 *   únicamente en las puntas de orden máximo (las de más arriba del esqueleto,
 *   no las intermedias) — no hay hoja ni fruto para esa especie.
 * @param {THREE.Texture} atlas
 * @returns {{mesh, uniforms, geometry, material, leafAnchors, flowerAnchors, fruitAnchors}}
 *   `leafAnchors`: Float32Array de 9 floats por racimo de hoja — posición(3) +
 *   color verde(3) + color de otoño(3) — mismo formato que consume
 *   `tintLeafAnchors` de litter.js.
 *   `flowerAnchors`: Float32Array de 6 floats por racimo de flor — posición(3)
 *   + color(3) — listo para `litter.emitRate`/`litter.burst`.
 *   `fruitAnchors`: Float32Array de 6 floats por fruto — mismo formato que
 *   `flowerAnchors`. Vacío si la especie no fructifica (`def.colors.fruit`
 *   nulo, como en todas menos el manzano).
 *   Van separadas (y no mezcladas en un solo array) porque `litter` tiene un
 *   pool distinto para hoja, pétalo y fruto, con formas y perfiles de caída
 *   distintos: si se mezclaran, a veces caería un "pétalo" con forma de hoja
 *   verde, o una "hoja" rosada.
 */
export function buildFoliage(tips, def, atlas, THREE, rnd) {
  // Flor sola (cactus): solo las puntas de orden máximo, ninguna intermedia —
  // así la flor sale en la corona del brazo, no salpicada por todo el tallo.
  let fuente = tips
  if (def.flowerOnly) {
    const ordenMax = tips.reduce((m, t) => Math.max(m, t.order), 0)
    fuente = tips.filter((t) => t.order === ordenMax)
  }
  // `clusters` es la densidad de copa REAL: antes se topaba en `tips.length`, así
  // que árboles con pocas puntas (el abedul, 244) nunca alcanzaban su densidad y
  // se veían ralos. Al no topar, los racimos de más reutilizan puntas con un
  // jitter propio (el `j` de abajo) y llenan la copa en vez de quedar apilados.
  const n = def.flowerOnly ? fuente.length : def.clusters
  const geo = geometriaCruz(THREE)

  const iPos = new Float32Array(n * 3)
  const iYear = new Float32Array(n)
  const iOff = new Float32Array(n)
  const iScale = new Float32Array(n)
  const iRot = new Float32Array(n)
  const iCell = new Float32Array(n * 2)   // desplazamiento en el atlas

  const leafAnchors = []
  const flowerAnchors = []
  const fruitAnchors = []

  const celdaHoja = [0, 0], celdaFlor = [0.5, 0], celdaFruto = [0, 0.5]
  // Sin hoja (cactus, `flowerOnly`): nunca se entra a la rama de hoja del
  // reparto de abajo, pero igual hace falta un color válido para no romper.
  const hojaPar = def.colors.leaf || [[1, 1, 1], [1, 1, 1]]
  const cLeafLo = hojaPar[0], cLeafHi = hojaPar[1]
  const autumnPar = def.colors.autumn || def.colors.leaf || hojaPar
  const cAutLo = autumnPar[0], cAutHi = autumnPar[1]
  const florPar = def.colors.flower || [[1, 1, 1], [1, 1, 1]]
  const cFlorLo = florPar[0], cFlorHi = florPar[1] || florPar[0]
  const frutoPar = def.colors.fruit || [[1, 1, 1], [1, 1, 1]]
  const cFrutoLo = frutoPar[0], cFrutoHi = frutoPar[1] || frutoPar[0]

  for (let i = 0; i < n; i++) {
    const t = fuente[(i * 7919) % fuente.length]   // barajado determinista
    const j = (0.3 + rnd() * 0.7)
    iPos[i * 3] = t.p.x + (rnd() - 0.5) * j
    iPos[i * 3 + 1] = t.p.y + (rnd() - 0.5) * j
    iPos[i * 3 + 2] = t.p.z + (rnd() - 0.5) * j
    iYear[i] = t.year
    // Hereda el desfase de emergencia de su ramita: la hoja se revela cuando la
    // rama que la sostiene termina de salir, no antes (evita hojas flotando sin
    // rama). Sin `off` (racimos viejos), 0 → comportamiento de siempre.
    iOff[i] = t.off || 0
    iScale[i] = 1.1 + rnd() * 0.9
    iRot[i] = rnd() * 6.2832
    // Reparto: flor, fruto y hoja. La flor y el fruto nunca se dibujan a la
    // vez porque sus densidades (uFlower/uFruit) no se solapan en el año.
    // `flowerOnly` fuerza la celda de flor en el 100% de las instancias.
    const r = rnd()
    const esFlor = def.flowerOnly || (!!def.colors.flower && r < (def.flowerRatio || 0.35))
    const esFruto = !esFlor && !!def.colors.fruit &&
      r < (def.flowerRatio || 0.35) + (def.fruitRatio || 0.12)
    iCell[i * 2] = esFlor ? celdaFlor[0] : esFruto ? celdaFruto[0] : celdaHoja[0]
    iCell[i * 2 + 1] = esFlor ? celdaFlor[1] : esFruto ? celdaFruto[1] : celdaHoja[1]

    const px = iPos[i * 3], py = iPos[i * 3 + 1], pz = iPos[i * 3 + 2]
    if (esFlor) {
      const c = mezclar(cFlorLo, cFlorHi, rnd())
      flowerAnchors.push(px, py, pz, c[0], c[1], c[2])
    } else if (esFruto) {
      const c = mezclar(cFrutoLo, cFrutoHi, rnd())
      fruitAnchors.push(px, py, pz, c[0], c[1], c[2])
    } else {
      const g = rnd()
      const verde = mezclar(cLeafLo, cLeafHi, g)
      const otono = mezclar(cAutLo, cAutHi, g)
      leafAnchors.push(px, py, pz, verde[0], verde[1], verde[2], otono[0], otono[1], otono[2])
    }
  }

  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3))
  geo.setAttribute('iYear', new THREE.InstancedBufferAttribute(iYear, 1))
  geo.setAttribute('iOff', new THREE.InstancedBufferAttribute(iOff, 1))
  geo.setAttribute('iScale', new THREE.InstancedBufferAttribute(iScale, 1))
  geo.setAttribute('iRot', new THREE.InstancedBufferAttribute(iRot, 1))
  geo.setAttribute('iCell', new THREE.InstancedBufferAttribute(iCell, 2))
  geo.instanceCount = n

  const uniforms = {
    uTex: { value: atlas },
    uT: { value: 0 },
    uGrowth: { value: 0 },
    uLeaf: { value: 0 },
    uFlower: { value: 0 },
    uFruit: { value: 0 },
    uAutumn: { value: 0 },
    uAutumnCol: { value: new THREE.Color(...cAutLo) },
  }

  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec3 iPos; attribute float iYear; attribute float iOff; attribute float iScale;
      attribute float iRot; attribute vec2 iCell;
      uniform float uT, uGrowth, uLeaf, uFlower, uFruit;
      varying vec2 vUv; varying float vFlor; varying float vFruto; varying float vFade;
      void main() {
        // ¿Ya salió la ramita que sostiene esta hoja? Misma ventana corta y
        // escalonada que la corteza (bark.js): se revela en iYear + iOff.
        float vivo = smoothstep(iYear + iOff, iYear + iOff + 0.4, uGrowth);
        vFlor = step(0.25, iCell.x);
        vFruto = step(0.25, iCell.y);
        // Densidad estacional: la hoja sigue uLeaf, la flor uFlower, el fruto
        // uFruit. Flor y fruto no se solapan en el año (ver phenology.js).
        float dens = vFruto > 0.5 ? uFruit : mix(uLeaf, uFlower, vFlor);
        float k = vivo * dens;
        vFade = k;
        float s = iScale * k;
        // Rotación alrededor de Y + balanceo con el tiempo.
        float a = iRot + sin(uT * 0.7 + iRot * 3.0) * 0.12;
        mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
        vec3 p = position * s;
        p.xz = r * p.xz;
        p += iPos;
        p.x += sin(uT * 0.6 + iRot) * 0.25;
        vUv = uv * 0.5 + iCell;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      precision mediump float;
      uniform sampler2D uTex; uniform float uAutumn; uniform vec3 uAutumnCol;
      varying vec2 vUv; varying float vFlor; varying float vFruto; varying float vFade;
      void main() {
        vec4 t = texture2D(uTex, vUv);
        if (t.a < 0.35 || vFade < 0.02) discard;
        // Solo la HOJA vira en otoño; la flor y el fruto conservan su color.
        float esHoja = 1.0 - max(vFlor, vFruto);
        vec3 c = mix(t.rgb, uAutumnCol * (0.6 + 0.6 * t.g), uAutumn * esHoja);
        gl_FragColor = vec4(c, t.a);
      }`,
  })

  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  return {
    mesh, uniforms, geometry: geo, material: mat,
    years: iYear,   // año de cada racimo: sirve para saber cuánta copa está revelada
    offs: iOff,     // desfase de emergencia de cada racimo (mismo que usa el shader)
    leafAnchors: new Float32Array(leafAnchors),
    flowerAnchors: new Float32Array(flowerAnchors),
    fruitAnchors: new Float32Array(fruitAnchors),
  }
}
