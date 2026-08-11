import * as THREE from 'three'
import { createSchools, updateSchools, scatterFish } from '../../sim/fish.js'
import { createLineBuffer } from '../engine/points.js'

// Render de los cardúmenes de peces del mundo AGUA. Cada pez = 2 segmentos
// (cuerpo + cola que coletea) dibujados con un buffer de líneas dinámico.
// La sim vive en src/sim/fish.js (puro, sin three); acá solo se lee su estado
// y se reescribe el buffer cada frame.

// Paleta fría sumergida; varía levemente por cardumen (school % length).
const SCHOOL_COLORS = [
  { body: [0.6, 0.85, 1.0], tail: [0.4, 0.62, 0.78] },
  { body: [0.75, 0.92, 1.0], tail: [0.55, 0.75, 0.88] },
  { body: [0.55, 0.78, 0.95], tail: [0.38, 0.58, 0.75] },
]

const BODY_LEN = 1.2
const TAIL_LEN = 0.8
const TAIL_AMPLITUDE = 0.32
const FLICK_SPEED = 8

const DEFAULT_DIR = [1, 0, 0]

export function createFishRender(scene, cfg, rand = Math.random) {
  const fcfg = cfg.pond.fish
  const lagoonRadius = cfg.pond.lagoonRadius
  const state = createSchools(fcfg, rand)

  const maxSegments = fcfg.schools * fcfg.perSchool * 2 // cuerpo + cola por pez
  const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, fog: true })
  const buf = createLineBuffer(maxSegments, material)
  scene.add(buf.mesh)

  // Fase de coleteo por pez (determinística vía `rand`).
  const phases = state.fish.map(() => rand() * Math.PI * 2)

  function update(dt, clock) {
    updateSchools(state, fcfg, dt, rand)
    buf.begin()
    const F = state.fish
    for (let i = 0; i < F.length; i++) {
      const f = F[i]
      const wx = f.x * lagoonRadius
      const wz = f.z * lagoonRadius
      const wy = f.y

      // Dirección en espacio de mundo (x,z escalados por el radio de laguna).
      let dx = f.vx * lagoonRadius
      let dz = f.vz * lagoonRadius
      let dy = f.vy
      let dm = Math.hypot(dx, dz, dy)
      if (dm < 1e-6) {
        dx = DEFAULT_DIR[0]; dz = DEFAULT_DIR[1]; dy = DEFAULT_DIR[2]; dm = 1
      }
      const idm = 1 / dm
      dx *= idm; dz *= idm; dy *= idm

      // Perpendicular horizontal (para el coletazo), estable salvo rumbo ~vertical.
      let px = -dz, py = 0, pz = dx
      let pm = Math.hypot(px, py, pz)
      if (pm < 1e-6) { px = 1; py = 0; pz = 0; pm = 1 }
      const ipm = 1 / pm
      px *= ipm; pz *= ipm

      const bodyHalf = BODY_LEN * 0.5
      const headX = wx + dx * bodyHalf, headY = wy + dy * bodyHalf, headZ = wz + dz * bodyHalf
      const tailX = wx - dx * bodyHalf, tailY = wy - dy * bodyHalf, tailZ = wz - dz * bodyHalf

      const colors = SCHOOL_COLORS[f.school % SCHOOL_COLORS.length]
      buf.push(tailX, tailY, tailZ, headX, headY, headZ, colors.tail, colors.body)

      // Cola: coletea perpendicular al rumbo.
      const flick = Math.sin(clock * FLICK_SPEED + phases[i]) * TAIL_AMPLITUDE
      const finX = tailX - dx * TAIL_LEN + px * flick
      const finY = tailY - dy * TAIL_LEN
      const finZ = tailZ - dz * TAIL_LEN + pz * flick
      buf.push(tailX, tailY, tailZ, finX, finY, finZ, colors.tail, colors.tail)
    }
    buf.commit()
  }

  function scatter(strength = 1) {
    scatterFish(state, strength, rand)
  }

  return { update, scatter, state }
}
