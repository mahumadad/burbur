import * as THREE from 'three'
import { createLineBuffer } from '../../render/engine/points.js'

// Dibujo de la mitosis (M4): cromatina, cromosomas discretos y huso.
// La máquina de estados (condensation/alignment/separation/furrow) vive en
// sim/mitosis.js, puro y testeada; esto es SOLO three.js. Se extrae de
// cell.js por tamaño (spec §11: si cell.js pasa ~1200 líneas).
//
// Diseño: 8 cromosomas, cada uno hecho de 5 hebras enredadas (misma
// densidad que la cromatina estática que reemplaza: 8×5 = 40 hebras). En
// reposo (condensation=0) cada hebra es el mismo random-walk de siempre; al
// condensar, sus puntos interpolan hacia una barra corta con leve espesor
// (el desplazamiento perpendicular por hebra). El CENTRO de cada cromosoma
// migra por separado: de su posición "casera" al plano ecuatorial
// (alignment) y de ahí a uno de los dos polos (separation, 4 y 4).
//
// Eje del huso: el eje +x/-x local (mismo que usan los dos polos del huso
// dibujado más abajo). La placa metafásica es el plano x≈0, perpendicular a
// ese eje — así los polos (a ±x) y el ecuador quedan geométricamente
// consistentes.

const CHROM_COUNT = 8
const STRANDS_PER_CHROM = 5
const SEGMENTS = 8 // por hebra: 9 puntos, igual que la cromatina original

/**
 * @param {object} p
 * @param {THREE.Scene} p.scene
 * @param {number} p.NR  radio del núcleo, ya escalado a mundo
 * @param {number} p.NY  altura del núcleo
 * @param {function} p.rnd
 * @param {[number,number,number]} p.chromatinColor  rgb 0..1
 * @param {[number,number,number]} p.spindleColor    rgb 0..1
 */
export function createMitosisDraw({ scene, NR, NY, rnd, chromatinColor, spindleColor }) {
  // ── Construcción (una vez): 8 cromosomas con su forma en reposo y su
  // forma condensada, ambas fijas — cada frame solo interpola entre ellas.
  const chromosomes = []
  for (let c = 0; c < CHROM_COUNT; c++) {
    // Posición "casera" dentro del núcleo, antes de alinearse al huso.
    const home = {
      x: (rnd() - 0.5) * NR * 0.9,
      y: (rnd() - 0.5) * NR * 0.5,
      z: (rnd() - 0.5) * NR * 0.9,
    }
    // Eje de la barra condensada, perpendicular al eje del huso (x): el
    // cromosoma queda "acostado" en el plano y-z, como en una placa real.
    const barAng = rnd() * Math.PI * 2
    const axis = { x: 0, y: Math.cos(barAng), z: Math.sin(barAng) }
    const perp = { x: 0, y: -axis.z, z: axis.y }
    const half = NR * 0.16   // medio-largo de la barra
    const thick = NR * 0.06  // espesor total (grosor = varias hebras juntas)

    const strands = []
    for (let s = 0; s < STRANDS_PER_CHROM; s++) {
      // Hebra enredada en reposo: mismo random-walk que la cromatina vieja.
      let x = (rnd() - 0.5) * NR, y = (rnd() - 0.5) * NR, z = (rnd() - 0.5) * NR
      const restAbs = [{ x, y, z }]
      for (let k = 0; k < SEGMENTS; k++) {
        x += (rnd() - 0.5) * NR * 0.5
        y += (rnd() - 0.5) * NR * 0.5
        z += (rnd() - 0.5) * NR * 0.5
        restAbs.push({ x, y, z })
      }
      // Forma condensada: puntos repartidos a lo largo de la barra, con un
      // corrimiento perpendicular fijo por hebra (le da el "grosor").
      const side = (s / (STRANDS_PER_CHROM - 1) - 0.5) * thick
      const condAbs = []
      for (let k = 0; k <= SEGMENTS; k++) {
        const t = (k / SEGMENTS - 0.5) * half * 2
        condAbs.push({
          x: home.x + axis.x * t + perp.x * side,
          y: home.y + axis.y * t + perp.y * side,
          z: home.z + axis.z * t + perp.z * side,
        })
      }
      // Guardamos OFFSETS respecto de `home`, no posiciones absolutas: así la
      // hebra entera viaja con su centro cuando este migra (alignment/
      // separation) sin deformarse por el camino.
      const restOffset = restAbs.map((p) => ({ x: p.x - home.x, y: p.y - home.y, z: p.z - home.z }))
      const condOffset = condAbs.map((p) => ({ x: p.x - home.x, y: p.y - home.y, z: p.z - home.z }))
      strands.push({ restOffset, condOffset })
    }
    // Mitad de los cromosomas viaja a cada polo en anafase.
    const pole = c < CHROM_COUNT / 2 ? -1 : 1
    chromosomes.push({ home, strands, pole })
  }

  const maxSeg = CHROM_COUNT * STRANDS_PER_CHROM * SEGMENTS
  const chromMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 })
  const chromBuf = createLineBuffer(maxSeg, chromMat)
  scene.add(chromBuf.mesh)

  // Huso: 2 líneas (una por polo) por cromosoma, tenues.
  const spindleMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22 })
  const spindleBuf = createLineBuffer(CHROM_COUNT * 2, spindleMat)
  scene.add(spindleBuf.mesh)

  const POLE_X = NR * 1.4       // polos del huso, a ±NR*1.4 en x
  const GROUP_X = NR * 0.85     // adónde viajan los CROMOSOMAS (más cerca que los polos del huso)

  /** @param {{condensation:number, alignment:number, separation:number, furrow:number}} mit */
  function update(mit) {
    chromBuf.begin()
    const centers = []
    for (const ch of chromosomes) {
      // Centro actual: casero → plato ecuatorial (x≈0) → polo (±GROUP_X).
      const xPlate = ch.home.x * (1 - mit.alignment)
      const xPole = xPlate * (1 - mit.separation) + ch.pole * GROUP_X * mit.separation
      const center = { x: xPole, y: ch.home.y, z: ch.home.z }
      centers.push(center)
      for (const st of ch.strands) {
        let prev = null
        for (let k = 0; k <= SEGMENTS; k++) {
          const ro = st.restOffset[k], co = st.condOffset[k]
          const px = center.x + ro.x + (co.x - ro.x) * mit.condensation
          const py = center.y + ro.y + (co.y - ro.y) * mit.condensation
          const pz = center.z + ro.z + (co.z - ro.z) * mit.condensation
          if (prev) {
            chromBuf.push(prev.x, NY + prev.y, prev.z, px, NY + py, pz, chromatinColor, chromatinColor)
          }
          prev = { x: px, y: py, z: pz }
        }
      }
    }
    chromBuf.commit()

    spindleBuf.begin()
    if (mit.alignment > 0) {
      for (const center of centers) {
        spindleBuf.push(-POLE_X, NY, 0, center.x, NY + center.y, center.z, spindleColor, spindleColor)
        spindleBuf.push(POLE_X, NY, 0, center.x, NY + center.y, center.z, spindleColor, spindleColor)
      }
    }
    spindleBuf.commit()
  }

  return { update }
}
