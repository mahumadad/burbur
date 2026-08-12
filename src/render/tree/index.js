// Fábrica de árboles. Posee los ATLAS (uno por especie, compartido entre todos
// los árboles de esa especie) y la lista de recursos a liberar. Nada de aquí
// llama a scene.add por su cuenta: el mundo decide dónde va el grupo.

import { growSkeleton } from './skeleton.js'
import { buildBark } from './bark.js'
import { buildFoliage } from './foliage.js'
import { buildAtlas } from './leafAtlas.js'
import { SPECIES } from './species.js'

export function createTreeFactory(THREE, noise2) {
  const atlas = new Map()      // especie → CanvasTexture
  const recursos = []          // todo lo que hay que liberar

  function atlasDe(especie) {
    if (!atlas.has(especie)) atlas.set(especie, buildAtlas(especie, THREE))
    return atlas.get(especie)
  }

  /**
   * @param {object} spec { species, origin, dir, rnd }
   */
  function createTree(spec) {
    const def = SPECIES[spec.species]
    const rnd = spec.rnd
    const { branches, tips } = growSkeleton({
      THREE, origin: spec.origin, dir: spec.dir,
      len: def.form.len, radius: def.form.radius, depth: def.form.depth,
      gnarl: def.form.gnarl, droop: def.form.droop, kids: def.form.kids,
    }, rnd)

    const bark = buildBark(branches, THREE, noise2, def.form.ribs || 0)
    const matRelleno = new THREE.MeshBasicMaterial({
      color: def.colors.bark, side: THREE.DoubleSide, fog: true,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    })
    matRelleno.onBeforeCompile = bark.onBeforeCompile
    const relleno = new THREE.Mesh(bark.geometry, matRelleno)

    const aristasGeo = new THREE.WireframeGeometry(bark.geometry)
    const matAristas = new THREE.LineBasicMaterial({
      color: def.colors.edge, transparent: true, opacity: 0.55, fog: true,
    })
    const aristas = new THREE.LineSegments(aristasGeo, matAristas)

    const group = new THREE.Group()
    group.add(relleno, aristas)

    let fol = null
    // `flowerOnly` (cactus, Task 6) pasa por buildFoliage aunque `clusters`
    // sea 0: el racimo no es de hoja, es de flor, y foliage.js lo arma solo
    // con las puntas de orden máximo.
    if (def.clusters > 0 || def.flowerOnly) {
      fol = buildFoliage(tips, def, atlasDe(spec.species), THREE, rnd)
      group.add(fol.mesh)
      recursos.push(fol.geometry, fol.material)
    }
    recursos.push(bark.geometry, matRelleno, aristasGeo, matAristas)

    return {
      group,
      // Geometría cruda de la corteza (posiciones ya "adultas"): la usa el
      // mundo para sembrar semillas de nieve sobre la copa, sin adivinar el
      // orden de los hijos del grupo.
      barkGeometry: bark.geometry,
      // Anclas para litter.js, SEPARADAS por tipo (ver el comentario en
      // foliage.js sobre por qué no van mezcladas en un solo array).
      leafAnchors: fol ? fol.leafAnchors : new Float32Array(0),
      flowerAnchors: fol ? fol.flowerAnchors : new Float32Array(0),
      // Vacío en toda especie que no fructifique (solo el manzano lo hace).
      fruitAnchors: fol ? fol.fruitAnchors : new Float32Array(0),
      // Fracción de la copa REALMENTE revelada por el crecimiento (0..1): es el
      // promedio del mismo `smoothstep(año, año+1, growth)` que usa el shader
      // para hacer aparecer cada racimo. Un plantón recién rebrotado da ~0, un
      // árbol maduro da ~1. El mundo la usa para NO botar hojas de un árbol vacío.
      _folFrac: 0,
      foliageFrac() { return this._folFrac },
      setGrowth(y) {
        bark.uniforms.uGrowth.value = y
        if (fol) fol.uniforms.uGrowth.value = y
        if (fol && fol.years.length) {
          let s = 0
          for (let i = 0; i < fol.years.length; i++) {
            // Misma ventana que el shader: smoothstep(iYear+iOff, +0.4, y).
            const u = Math.min(1, Math.max(0, (y - fol.years[i] - fol.offs[i]) / 0.4))
            s += u * u * (3 - 2 * u)
          }
          this._folFrac = s / fol.years.length
        }
      },
      update(phen, t) {
        if (!fol) return
        fol.uniforms.uT.value = t
        // `leafShown`/`flowerShown` (no `leaf`/`flower` a secas): son la
        // densidad YA atenuada por la lluvia que calcula phenology.js — el
        // mismo campo que usan el bosque y el resto de la ciudad.
        fol.uniforms.uLeaf.value = phen.leafShown ?? phen.leaf
        fol.uniforms.uFlower.value = phen.flowerShown ?? phen.flower
        fol.uniforms.uFruit.value = phen.fruit ?? 0
        fol.uniforms.uAutumn.value = phen.autumn
      },
    }
  }

  function dispose() {
    for (const r of recursos) r.dispose()
    for (const tex of atlas.values()) tex.dispose()
    recursos.length = 0
    atlas.clear()
  }

  return { createTree, dispose }
}
