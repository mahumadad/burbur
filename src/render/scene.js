import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

// Paleta estilo "glade" de murmur: pasto vibrante, relieve terroso, agentes saturados.
const SKY = 0xa9dc86
const GROUND_Y = -3.6
const AGENT_COLORS = [
  0x35e0e0, 0xff8a3a, 0xff6ab5, 0xffe14d, 0xffffff, 0xb06aff, 0x8fe04a,
]

export function createScene(container, cfg) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(SKY)
  scene.fog = new THREE.FogExp2(SKY, 0.013)

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300)
  camera.position.set(0, 15, 14) // vista aérea 3/4, picada hacia el suelo
  camera.lookAt(0, GROUND_Y, -6)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setClearColor(SKY, 1)
  container.appendChild(renderer.domElement)

  // ─── Luz suave, generosa (sombreado plano y luminoso) ─────────────────────
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4f8f3a, 1.45))
  const sun = new THREE.DirectionalLight(0xfff3d0, 0.85)
  sun.position.set(6, 12, 4)
  scene.add(sun)

  // ─── Suelo ────────────────────────────────────────────────────────────────
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(320, 320),
    new THREE.MeshStandardMaterial({ color: 0x5fb83c, roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = GROUND_Y
  scene.add(ground)

  // ─── Colinas verdes de fondo ──────────────────────────────────────────────
  const hills = new THREE.Group()
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x4fa235, roughness: 1, flatShading: true })
  for (let i = 0; i < 14; i++) {
    const r = 10 + Math.random() * 12
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), hillMat)
    m.scale.y = 0.45 + Math.random() * 0.25
    const ang = (i / 14) * Math.PI * 2
    m.position.set(Math.cos(ang) * (45 + Math.random() * 25), GROUND_Y + r * 0.12, -30 - Math.random() * 45)
    m.rotation.y = Math.random() * Math.PI
    hills.add(m)
  }
  scene.add(hills)

  // ─── Relieve: montículos terrosos en plano medio ──────────────────────────
  const mounds = new THREE.Group()
  const moundMat = new THREE.MeshStandardMaterial({ color: 0x8a5540, roughness: 1, flatShading: true })
  const moundSpots = [[-13, -18, 7], [12, -22, 8], [-4, -30, 9], [18, -14, 5]]
  for (const [mx, mz, r] of moundSpots) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), moundMat)
    m.scale.set(1, 0.7, 1)
    m.position.set(mx, GROUND_Y + r * 0.28, mz)
    m.rotation.y = Math.random() * Math.PI
    mounds.add(m)
  }
  scene.add(mounds)

  // ─── Pasto instanciado (denso, inclinado para leerse desde arriba) ─────────
  const bladeGeo = new THREE.PlaneGeometry(0.09, 0.8)
  bladeGeo.translate(0, 0.4, 0) // pivote en la base
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, side: THREE.DoubleSide,
  })
  const GRASS = 11000
  const grass = new THREE.InstancedMesh(bladeGeo, bladeMat, GRASS)
  const m4 = new THREE.Matrix4()
  const qLean = new THREE.Quaternion()
  const qSpin = new THREE.Quaternion()
  const q = new THREE.Quaternion()
  const xAxis = new THREE.Vector3(1, 0, 0)
  const yAxis = new THREE.Vector3(0, 1, 0)
  const scl = new THREE.Vector3()
  const gpos = new THREE.Vector3()
  const gcol = new THREE.Color()
  for (let i = 0; i < GRASS; i++) {
    const gx = (Math.random() * 2 - 1) * 42
    const gz = 12 - Math.random() * 54
    gpos.set(gx, GROUND_Y, gz)
    qLean.setFromAxisAngle(xAxis, 0.35 + Math.random() * 0.55) // inclina la hoja
    qSpin.setFromAxisAngle(yAxis, Math.random() * Math.PI * 2) // orienta al azar
    q.multiplyQuaternions(qSpin, qLean)
    const h = 0.75 + Math.random() * 1.25
    scl.set(0.8 + Math.random() * 0.7, h, 1)
    m4.compose(gpos, q, scl)
    grass.setMatrixAt(i, m4)
    gcol.setHSL(0.29 + Math.random() * 0.07, 0.72, 0.34 + Math.random() * 0.18)
    grass.setColorAt(i, gcol)
  }
  grass.instanceMatrix.needsUpdate = true
  scene.add(grass)

  // ─── Agentes (criaturas que laten) ────────────────────────────────────────
  const n = cfg.fireflies.count
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  geom.setAttribute('aBrightness', new THREE.BufferAttribute(new Float32Array(n), 1))
  const colorArr = new Float32Array(n * 3)
  const tmp = new THREE.Color()
  for (let i = 0; i < n; i++) {
    tmp.set(AGENT_COLORS[i % AGENT_COLORS.length])
    colorArr[i * 3] = tmp.r; colorArr[i * 3 + 1] = tmp.g; colorArr[i * 3 + 2] = tmp.b
  }
  geom.setAttribute('aColor', new THREE.BufferAttribute(colorArr, 3))

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uSize: { value: 360 * renderer.getPixelRatio() } },
    vertexShader: `
      attribute float aBrightness;
      attribute vec3 aColor;
      varying float vB;
      varying vec3 vC;
      uniform float uSize;
      void main() {
        vB = aBrightness;
        vC = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * (0.55 + aBrightness) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vB;
      varying vec3 vC;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float ring = smoothstep(0.50, 0.44, d) - smoothstep(0.44, 0.33, d);
        float core = smoothstep(0.12, 0.0, d);
        float a = clamp(ring * 0.95 + core * (0.55 + vB), 0.0, 1.0);
        vec3 col = vC * (0.95 + vB * 0.5);
        gl_FragColor = vec4(col, a * (0.65 + 0.35 * vB));
      }`,
  })
  const points = new THREE.Points(geom, mat)
  scene.add(points)

  // ─── Estelas: rastro punteado de cada individuo al moverse ────────────────
  const TRAIL = 18
  const TRAIL_STEP = 3
  const trailGeom = new THREE.BufferGeometry()
  const tPos = new Float32Array(n * TRAIL * 3)
  const tCol = new Float32Array(n * TRAIL * 3)
  const tFade = new Float32Array(n * TRAIL)
  for (let i = 0; i < n; i++) {
    for (let s = 0; s < TRAIL; s++) {
      const k = (i * TRAIL + s) * 3
      tCol[k] = colorArr[i * 3]; tCol[k + 1] = colorArr[i * 3 + 1]; tCol[k + 2] = colorArr[i * 3 + 2]
    }
  }
  trailGeom.setAttribute('position', new THREE.BufferAttribute(tPos, 3))
  trailGeom.setAttribute('aColor', new THREE.BufferAttribute(tCol, 3))
  trailGeom.setAttribute('aFade', new THREE.BufferAttribute(tFade, 1))
  const trailMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uSize: { value: 70 * renderer.getPixelRatio() } },
    vertexShader: `
      attribute vec3 aColor;
      attribute float aFade;
      varying vec3 vC;
      varying float vF;
      uniform float uSize;
      void main() {
        vC = aColor; vF = aFade;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * aFade / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vC;
      varying float vF;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vF * 0.6;
        gl_FragColor = vec4(vC, a);
      }`,
  })
  const trail = new THREE.Points(trailGeom, trailMat)
  scene.add(trail)
  let tHead = 0
  let tFrame = 0

  // Mapea la posición de la simulación (caja ±bounds) al claro con profundidad.
  const B = cfg.fireflies.bounds
  const worldPos = new Float32Array(n * 3)
  function mapPositions(swarm) {
    const p = swarm.pos
    for (let i = 0; i < n; i++) {
      worldPos[i * 3] = p[i * 3] * 2.4
      worldPos[i * 3 + 1] = GROUND_Y + 0.6 + (p[i * 3 + 1] + B.y) * 0.06
      worldPos[i * 3 + 2] = -4 - (p[i * 3 + 2] + B.z) * 1.7
    }
  }

  // ─── Postproceso: bloom (solo los núcleos brillantes) ─────────────────────
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.4, 0.8)
  composer.addPass(bloom)

  function resize() {
    const side = Math.min(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.setSize(side, side, false)
    composer.setSize(side, side)
    const el = renderer.domElement
    el.style.position = 'absolute'
    el.style.width = side + 'px'
    el.style.height = side + 'px'
    el.style.left = (container.clientWidth - side) / 2 + 'px'
    el.style.top = (container.clientHeight - side) / 2 + 'px'
  }
  resize()
  window.addEventListener('resize', resize)

  function update(swarm) {
    mapPositions(swarm)
    const posAttr = geom.getAttribute('position')
    const brAttr = geom.getAttribute('aBrightness')
    posAttr.array.set(worldPos)
    brAttr.array.set(swarm.flash)
    posAttr.needsUpdate = true
    brAttr.needsUpdate = true

    // estelas: desvanece todo y siembra una muestra cada TRAIL_STEP frames
    for (let k = 0; k < n * TRAIL; k++) tFade[k] *= 0.94
    if (tFrame % TRAIL_STEP === 0) {
      for (let i = 0; i < n; i++) {
        const slot = (i * TRAIL + tHead) * 3
        tPos[slot] = worldPos[i * 3]
        tPos[slot + 1] = worldPos[i * 3 + 1]
        tPos[slot + 2] = worldPos[i * 3 + 2]
        tFade[i * TRAIL + tHead] = 1
      }
      tHead = (tHead + 1) % TRAIL
    }
    tFrame++
    trailGeom.getAttribute('position').needsUpdate = true
    trailGeom.getAttribute('aFade').needsUpdate = true

    composer.render()
  }

  return { update, resize, renderer, camera }
}
