import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

export function createScene(container, cfg) {
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x05121a, cfg.render.fogDensity)

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100)
  camera.position.set(0, 0, 22)

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setClearColor(0x05121a, 1)
  container.appendChild(renderer.domElement)

  // fondo: siluetas de árboles (planos casi negros)
  const trees = new THREE.Group()
  for (let t = 0; t < 9; t++) {
    const w = 2 + Math.random() * 3
    const h = 10 + Math.random() * 8
    const geo = new THREE.PlaneGeometry(w, h)
    const mat = new THREE.MeshBasicMaterial({ color: 0x02080b })
    const m = new THREE.Mesh(geo, mat)
    m.position.set((Math.random() * 2 - 1) * 16, -3, -14 - Math.random() * 6)
    trees.add(m)
  }
  scene.add(trees)

  // luciérnagas como puntos con brillo por-vértice
  const n = cfg.fireflies.count
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  geom.setAttribute('aBrightness', new THREE.BufferAttribute(new Float32Array(n), 1))
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uSize: { value: 26 * renderer.getPixelRatio() } },
    vertexShader: `
      attribute float aBrightness;
      varying float vB;
      uniform float uSize;
      void main() {
        vB = aBrightness;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * (0.25 + aBrightness) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vB;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        vec3 warm = vec3(0.75, 0.95, 0.55);
        gl_FragColor = vec4(warm, a * (0.12 + vB));
      }`,
  })
  const points = new THREE.Points(geom, mat)
  scene.add(points)

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(1, 1),
    cfg.render.bloomStrength, cfg.render.bloomRadius, cfg.render.bloomThreshold,
  )
  composer.addPass(bloom)

  function resize() {
    const side = Math.min(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.setSize(side, side, false)
    composer.setSize(side, side)
    const el = renderer.domElement
    el.style.position = 'absolute'
    el.style.left = (container.clientWidth - side) / 2 + 'px'
    el.style.top = (container.clientHeight - side) / 2 + 'px'
  }
  resize()
  window.addEventListener('resize', resize)

  function update(swarm) {
    const posAttr = geom.getAttribute('position')
    const brAttr = geom.getAttribute('aBrightness')
    posAttr.array.set(swarm.pos)
    brAttr.array.set(swarm.flash)
    posAttr.needsUpdate = true
    brAttr.needsUpdate = true
    composer.render()
  }

  return { update, resize, renderer, camera }
}
