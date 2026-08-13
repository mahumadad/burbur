import * as THREE from 'three'
import { createStage } from './stage.js'
import { createDraw } from './engine/points.js'
import { fbm } from './noise.js'
import { tideLevel } from '../sim/tide.js'

// Mundo POZA DE MAREA: una poza rocosa de la costa chilena vista DESDE ABAJO
// DEL AGUA — la primera cámara volteada del proyecto. Una taza de roca con un
// portillo bajo por donde entra el mar; la cámara vive dentro de la cavidad, a
// media agua, mirando en diagonal hacia la superficie.
// Ver docs/superpowers/specs/2026-08-13-mundo-poza-marea-design.md
export function createTidepool(container, cfg, agentNames = []) {
  const rc = cfg.render
  const P = cfg.tidepool
  const q = Math.random

  // La cámara arranca dentro de la taza, algo descentrada, mirando hacia arriba.
  const stage = createStage(container, {
    ...cfg,
    stage: {
      camera: { orbR: 26, theta: 0.9, phi: 2.05, target: [0, P.surfaceMax, 0] },
      orbit: { minDist: 8, maxDist: 34, minPolar: Math.PI * 0.18, maxPolar: Math.PI * 0.92 },
      breathe: { baseY: P.camY + 6, ampY: 0.7 },
      fog: { color: 0x0a2733, density: 0.026 },
      background: 0x061a24,
    },
  })
  const { scene } = stage
  const draw = createDraw(rc)
  const { pushPoint, pushLine, uniforms: pointUniforms } = draw

  // ─── LA TAZA: pared anular de roca + lecho ────────────────────────────────
  // Roca mojada de la costa: gris-carbón frío, no arena.
  const ROCK_LO = [0.05, 0.06, 0.07]
  const ROCK_HI = [0.26, 0.28, 0.31]
  {
    const R = P.bowlRadius
    const geo = new THREE.CylinderGeometry(R * 1.5, R * 0.55, P.wallTop - P.bedY, 96, 24, true)
    const pos = geo.attributes.position
    const cols = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      // Relieve: la roca no es un cono liso.
      const bump = (fbm(x * 0.09 + 4, z * 0.09 - 2, 3) - 0.5) * 5.5
      const ang = Math.atan2(z, x)
      // El PORTILLO: un sector del borde queda más bajo, y por ahí entra el mar.
      let dAng = Math.abs(ang - P.portillo.ang)
      if (dAng > Math.PI) dAng = Math.PI * 2 - dAng
      const gate = Math.max(0, 1 - dAng / P.portillo.width)
      const rr = Math.hypot(x, z) || 1
      pos.setX(i, x + (x / rr) * bump)
      pos.setZ(i, z + (z / rr) * bump)
      pos.setY(i, y - gate * gate * P.wallTop * 1.4)
      // Más oscuro hacia el fondo (menos luz llega abajo).
      const t = Math.max(0, Math.min(1, (y - P.bedY) / (P.wallTop - P.bedY)))
      for (let k = 0; k < 3; k++) cols[i * 3 + k] = ROCK_LO[k] + (ROCK_HI[k] - ROCK_LO[k]) * t
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    geo.translate(0, (P.wallTop + P.bedY) / 2, 0)
    scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: true,
    })))
  }
  // Lecho de la poza.
  {
    const geo = new THREE.PlaneGeometry(P.bowlRadius * 3, P.bowlRadius * 3, 60, 60)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    const cols = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      pos.setY(i, P.bedY + (fbm(x * 0.08 + 9, z * 0.08 + 5, 2) - 0.5) * 2.2)
      const s = 0.5 + fbm(x * 0.2, z * 0.2, 2) * 0.5
      cols[i * 3] = ROCK_LO[0] * s * 3.2
      cols[i * 3 + 1] = ROCK_LO[1] * s * 3.4
      cols[i * 3 + 2] = ROCK_LO[2] * s * 3.6
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: true,
    })))
  }
  // Bolones sueltos por el fondo.
  for (let i = 0; i < 90; i++) {
    const a = q() * 6.2832, r = Math.sqrt(q()) * P.bowlRadius * 0.95
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    pushPoint(x, P.bedY + 0.4 + q() * 0.6, z, [0.18, 0.2, 0.22], 0.4 + q() * 0.9, 0)
  }

  draw.finalizeLines(scene, new THREE.LineBasicMaterial({ vertexColors: true, fog: true }))
  draw.finalizePoints(scene)

  stage.setResizeHook((m) => { pointUniforms.uProj.value = m.proj })

  // ─── API del builder ──────────────────────────────────────────────────────
  let clock = 0
  let tide = 0
  function update(swarm, dt, eco) {
    const step = dt || 0.016
    clock += step
    pointUniforms.uT.value = clock
    if (eco) {
      // Turbidez: el sedimento en suspensión come visibilidad.
      scene.fog.density = 0.018 + eco.fog * 0.03
      tide = tideLevel(eco.phaseIndex, eco.phaseT)
      // La estación de este mundo es la SURGENCIA; el HUD lee esta etiqueta.
      eco.seasonLabel = surgeLabel(eco.seasonT)
    }
    stage.render(step)
    return []
  }
  // Frío = surgencia = comida. La etiqueta invierte el sentido del año del bosque.
  function surgeLabel(seasonT) {
    const s = (seasonT + 0.5) % 1   // el pico de surgencia va opuesto al verano
    if (s < 0.25) return 'surgencia fuerte'
    if (s < 0.5) return 'surgencia'
    if (s < 0.75) return 'aguas calmas'
    return 'aguas pobres'
  }

  function setPointer() {}
  function scare() {}

  return {
    update, scare, setPointer,
    flash: stage.flash, resize: stage.resize, dispose: stage.dispose,
    camera: stage.camera, controls: stage.controls,
  }
}
