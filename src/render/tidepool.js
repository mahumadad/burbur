import * as THREE from 'three'
import { createStage } from './stage.js'
import { createDraw, createPointCloud } from './engine/points.js'
import { fbm } from './noise.js'
import { tideLevel } from '../sim/tide.js'
import { anemoneOpen } from '../sim/anemone.js'
import { createLimpet, updateLimpet, LIMPET_CFG } from '../sim/limpet.js'

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

  // ─── LA ROCA VIVA ─────────────────────────────────────────────────────────
  // Un punto en la pared de la taza, a la altura pedida (0 = fondo, 1 = borde).
  function wallPoint(h) {
    const a = q() * 6.2832
    const y = P.bedY + (P.wallTop - P.bedY) * h
    const t = (y - P.bedY) / (P.wallTop - P.bedY)
    const r = P.bowlRadius * (0.55 + 0.95 * t) - 1.2
    return { x: Math.cos(a) * r, y, z: Math.sin(a) * r, ang: a }
  }

  // ANÉMONAS: corona de tentáculos que se abre y cierra con la marea.
  const anemones = []
  const anemoneCloud = createPointCloud(P.anemones * 9, draw.pointMaterial)
  for (let i = 0; i < P.anemones; i++) {
    const p = wallPoint(0.15 + q() * 0.55)
    anemones.push({ ...p, phase: q() * 6.2832 })
    for (let k = 0; k < 9; k++) {
      const j = (i * 9 + k) * 3
      // Rojo ladrillo de la ortiga de mar, con el disco más oscuro.
      anemoneCloud.col[j] = k === 0 ? 0.42 : 0.86
      anemoneCloud.col[j + 1] = k === 0 ? 0.10 : 0.22
      anemoneCloud.col[j + 2] = k === 0 ? 0.12 : 0.26
      anemoneCloud.size[i * 9 + k] = k === 0 ? 0.55 : 0.3
    }
  }
  scene.add(anemoneCloud.mesh)
  function updateAnemones(agitation) {
    for (let i = 0; i < anemones.length; i++) {
      const an = anemones[i]
      const open = anemoneOpen(tide, agitation)
      const b = i * 9
      // Disco basal, siempre pegado a la roca.
      anemoneCloud.pos[b * 3] = an.x
      anemoneCloud.pos[b * 3 + 1] = an.y
      anemoneCloud.pos[b * 3 + 2] = an.z
      // Tentáculos: se despliegan en corona al abrirse; recogidos son una perla.
      for (let k = 1; k < 9; k++) {
        const a = (k / 8) * 6.2832 + an.phase
        const spread = 0.25 + open * 1.15
        const p = (b + k) * 3
        anemoneCloud.pos[p] = an.x + Math.cos(a) * spread
        anemoneCloud.pos[p + 1] = an.y + 0.2 + open * 0.5
        anemoneCloud.pos[p + 2] = an.z + Math.sin(a) * spread
      }
    }
    anemoneCloud.commit()
  }

  // LAPAS: pastorean con el agua y vuelven a su cicatriz antes de quedar secas.
  const limpets = []
  const limpetCloud = createPointCloud(P.limpets, draw.pointMaterial)
  for (let i = 0; i < P.limpets; i++) {
    const p = wallPoint(0.3 + q() * 0.55)
    limpets.push({ l: createLimpet(p.x, p.z), y: p.y })
    limpetCloud.col[i * 3] = 0.62; limpetCloud.col[i * 3 + 1] = 0.58; limpetCloud.col[i * 3 + 2] = 0.48
    limpetCloud.size[i] = 0.34
  }
  scene.add(limpetCloud.mesh)
  function updateLimpets(step) {
    for (let i = 0; i < limpets.length; i++) {
      const L = limpets[i]
      updateLimpet(L.l, tide, step, LIMPET_CFG, q)
      limpetCloud.pos[i * 3] = L.l.x
      limpetCloud.pos[i * 3 + 1] = L.y
      limpetCloud.pos[i * 3 + 2] = L.l.z
    }
    limpetCloud.commit()
  }

  // PICOROCOS: al sumergirse sacan los cirros y BARREN el agua, rítmicos.
  const barnacles = []
  const barnacleCloud = createPointCloud(P.barnacles * 4, draw.pointMaterial)
  for (let i = 0; i < P.barnacles; i++) {
    const p = wallPoint(0.25 + q() * 0.6)
    barnacles.push({ ...p, phase: q() * 6.2832, rate: 2.2 + q() * 1.4 })
    for (let k = 0; k < 4; k++) {
      const j = (i * 4 + k) * 3
      barnacleCloud.col[j] = k === 0 ? 0.72 : 0.9
      barnacleCloud.col[j + 1] = k === 0 ? 0.70 : 0.86
      barnacleCloud.col[j + 2] = k === 0 ? 0.64 : 0.8
      barnacleCloud.size[i * 4 + k] = k === 0 ? 0.5 : 0.16
    }
  }
  scene.add(barnacleCloud.mesh)
  function updateBarnacles() {
    for (let i = 0; i < barnacles.length; i++) {
      const b = barnacles[i]
      const base = i * 4
      barnacleCloud.pos[base * 3] = b.x
      barnacleCloud.pos[base * 3 + 1] = b.y
      barnacleCloud.pos[base * 3 + 2] = b.z
      // El barrido solo existe bajo el agua: emergido, el cono se cierra.
      const sweep = tide < 0.3 ? 0 : (0.5 + 0.5 * Math.sin(clock * b.rate + b.phase)) * tide
      for (let k = 1; k < 4; k++) {
        const p = (base + k) * 3
        const reach = sweep * (0.35 + k * 0.22)
        barnacleCloud.pos[p] = b.x + Math.cos(b.ang + k) * reach
        barnacleCloud.pos[p + 1] = b.y + 0.3 + reach * 0.6
        barnacleCloud.pos[p + 2] = b.z + Math.sin(b.ang + k) * reach
      }
    }
    barnacleCloud.commit()
  }

  // BANCOS DE CHORITOS: la despensa de la estrella de sol (Task 14).
  const musselPatches = []
  for (let i = 0; i < P.mussels.patches; i++) {
    const p = wallPoint(0.2 + q() * 0.4)
    musselPatches.push({ x: p.x, z: p.z, count: P.mussels.perPatch })
    for (let k = 0; k < P.mussels.perPatch; k++) {
      pushPoint(p.x + (q() - 0.5) * 3.4, p.y + (q() - 0.5) * 2.6, p.z + (q() - 0.5) * 3.4,
        [0.10, 0.09, 0.16], 0.2 + q() * 0.16, 0)
    }
  }

  // ALGAS: cochayuyo y huiro anclados a la roca, meciéndose con el vaivén.
  // Van como líneas con `phase`, que el shader de puntos ya usa para el balanceo.
  for (let i = 0; i < P.algae; i++) {
    const p = wallPoint(q() * 0.5)
    const h = 4 + q() * 9
    const segs = 4
    const a = q() * 6.2832
    let px = p.x, py = p.y, pz = p.z
    for (let s = 0; s < segs; s++) {
      const f = (s + 1) / segs
      const nx = p.x + Math.cos(a) * f * 2.4
      const ny = p.y + h * f
      const nz = p.z + Math.sin(a) * f * 2.4
      const lo = [0.10, 0.16, 0.06], hi = [0.26, 0.38, 0.12]
      pushLine(px, py, pz, nx, ny, nz, lo, hi)
      px = nx; py = ny; pz = nz
    }
  }

  draw.finalizeLines(scene, new THREE.LineBasicMaterial({ vertexColors: true, fog: true }))
  draw.finalizePoints(scene)

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
    const agitation = eco ? eco.rain : 0
    updateAnemones(agitation)
    updateLimpets(step)
    updateBarnacles()
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
