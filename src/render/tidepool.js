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

  // ─── TECHO DE AGUA: la superficie vista DESDE ABAJO ───────────────────────
  // Calca el shader de agua de la laguna (render/pond.js) pero leído por su cara
  // inferior: lo que allá era brillo del sol acá es la ventana de Snell — el
  // disco claro justo encima — y el resto de la superficie devuelve la luz del
  // fondo por reflexión total. Las cáusticas son la misma malla senoidal.
  const RIPPLES = 18
  const waterUniforms = {
    uTime: { value: 0 },
    uRipples: { value: Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uAgitate: { value: 0 },
    uLight: { value: 1 },     // cuánta luz entra (0 de noche → cáusticas apagadas)
  }
  let waterMesh = null
  {
    const geo = new THREE.PlaneGeometry(P.bowlRadius * 3.2, P.bowlRadius * 3.2, 120, 120)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      vertexShader: `
        uniform float uTime; uniform float uAgitate;
        varying vec2 vXZ;
        void main() {
          vXZ = position.xz;
          vec3 p = position;
          // La superficie ondula de verdad: al mirarla desde abajo, este
          // desplazamiento es lo que la hace leerse como un techo que respira.
          p.y += sin(p.x * 0.12 + uTime * 1.1) * 0.28 + sin(p.z * 0.1 - uTime * 0.9) * 0.24;
          p.y += uAgitate * 1.4 * sin(length(p.xz) * 0.16 - uTime * 3.2);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        #define N ${RIPPLES}
        precision mediump float;
        uniform float uTime, uAgitate, uLight; uniform vec4 uRipples[N];
        varying vec2 vXZ;
        void main() {
          // Cáusticas: la red fina de luz que se arrastra por el agua.
          float c1 = sin(vXZ.x * 0.31 + uTime * 0.9) * sin(vXZ.y * 0.27 - uTime * 0.75);
          float c2 = sin(vXZ.x * 0.17 - vXZ.y * 0.21 + uTime * 0.5);
          float caustic = pow(max(0.0, c1 * 0.7 + c2 * 0.5), 3.0);
          // Ondas de los bichos que rompen la superficie.
          float wake = 0.0;
          for (int i = 0; i < N; i++) {
            vec4 r = uRipples[i];
            if (r.w <= 0.001) continue;
            float d = distance(vXZ, r.xy);
            float ring = sin((d - r.z) * 1.9) * exp(-abs(d - r.z) * 0.42);
            wake += max(0.0, ring) * smoothstep(9.0, 0.0, abs(d - r.z)) * r.w;
          }
          vec3 deep = vec3(0.02, 0.10, 0.16);
          vec3 lit = vec3(0.35, 0.72, 0.85);
          vec3 col = deep + (lit - deep) * caustic * uLight
                   + wake * vec3(0.30, 0.58, 0.92)
                   + uAgitate * vec3(0.10, 0.24, 0.38);
          float a = clamp(0.42 + caustic * 0.5 * uLight + wake * 0.4 + uAgitate * 0.2, 0.0, 0.95);
          gl_FragColor = vec4(col, a);
        }`,
    })
    waterMesh = new THREE.Mesh(geo, mat)
    waterMesh.renderOrder = 1
    scene.add(waterMesh)
  }

  // Ondas en la superficie: pool FIFO, igual que la laguna.
  let rippleHead = 0
  function spawnRipple(x, z, str) {
    waterUniforms.uRipples.value[rippleHead].set(x, z, 0.5, str)
    rippleHead = (rippleHead + 1) % RIPPLES
  }
  function updateRipples(step) {
    for (const r of waterUniforms.uRipples.value) {
      if (r.w <= 0.001) continue
      r.z += 8 * step
      r.w = Math.max(0, r.w - 0.34 * step)
    }
  }

  // ─── API del builder ──────────────────────────────────────────────────────
  let clock = 0
  let tide = 0
  let surfaceY = P.surfaceMax
  function update(swarm, dt, eco) {
    const step = dt || 0.016
    clock += step
    pointUniforms.uT.value = clock
    waterUniforms.uTime.value = clock
    if (eco) {
      // Turbidez: el sedimento en suspensión come visibilidad.
      scene.fog.density = 0.018 + eco.fog * 0.03
      tide = tideLevel(eco.phaseIndex, eco.phaseT)
      // El techo sube y baja con la marea: en bajamar se acerca a la cámara y la
      // poza se vuelve un charco chico; en pleamar se aleja y hay columna de agua.
      surfaceY = P.surfaceMin + (P.surfaceMax - P.surfaceMin) * tide
      if (waterMesh) waterMesh.position.y = surfaceY
      // De noche no hay cáusticas: sin sol arriba, la red de luz no existe.
      waterUniforms.uLight.value = Math.min(1, eco.gain * 0.85)
      // Agitación del oleaje (el `rain` del estado de OLEAJE).
      waterUniforms.uAgitate.value = eco.rain * 0.8
      // La estación de este mundo es la SURGENCIA; el HUD lee esta etiqueta.
      eco.seasonLabel = surgeLabel(eco.seasonT)
    }
    updateRipples(step)
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
