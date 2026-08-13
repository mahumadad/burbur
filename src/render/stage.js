import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { resolveStageOptions, breatheTargetY } from './stageOptions.js'

// ESCENARIO COMPARTIDO entre mundos (bosque, ciudad, agua, …).
// Contiene todo lo que NO depende del bioma: escena+niebla, cámara aérea 3/4,
// renderer, órbita con "respiración", el lente (fisheye + cromática + viñeta),
// la etiqueta flotante, el destello de relámpago, el resize y el dispose.
//
// Cada mundo construye SU contenido dentro de `stage.scene` y solo aporta:
//   - un hook de resize (para sus uniforms que dependen de la resolución)
//   - su propio update por frame, terminando con `stage.render(step)`

export function createStage(container, cfg) {
  const rc = cfg.render

  // Opciones del escenario. Sin `cfg.stage`, los defaults reproducen el encuadre
  // aéreo 3/4 de siempre — los seis mundos que ya existen no se enteran.
  const so = resolveStageOptions(cfg.stage)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(so.background)
  // La distancia se funde en el fondo. La densidad la ajusta el clima del mundo.
  scene.fog = new THREE.FogExp2(so.fog.color, so.fog.density)

  const fov = 50 + rc.fisheye * 72 // 93°
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.5, 900)
  // Órbita esférica inicial. Por defecto, la vista aérea 3/4 de murmur; la poza
  // la mueve DENTRO del agua y sube el objetivo hacia la superficie.
  const { orbR, theta: th, phi: ph, target } = so.camera
  camera.position.set(
    orbR * Math.sin(ph) * Math.cos(th),
    orbR * Math.cos(ph),
    orbR * Math.sin(ph) * Math.sin(th),
  )
  camera.lookAt(target[0], target[1], target[2])

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setClearColor(0x000000, 1)
  container.appendChild(renderer.domElement)

  // Etiqueta flotante que sigue al individuo más cercano al centro (estilo murmur).
  const labelEl = document.createElement('div')
  labelEl.style.cssText = `position:absolute; left:0; top:0; z-index:6; pointer-events:none;
    transform:translate(-50%,-100%); background:#000; color:#e2ddd1;
    font:600 12px/1 ui-monospace,'DM Mono',monospace; letter-spacing:0.05em;
    text-transform:uppercase; padding:5px 8px; border-radius:4px; white-space:nowrap;
    opacity:0; transition:opacity 0.15s ease;`
  container.appendChild(labelEl)

  // Destello de relámpago: overlay blanco que se apaga rápido.
  const flashEl = document.createElement('div')
  flashEl.style.cssText = `position:absolute; inset:0; z-index:7; pointer-events:none;
    background:#e6f0ff; opacity:0; mix-blend-mode:screen;`
  container.appendChild(flashEl)
  let flashV = 0

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(target[0], target[1], target[2])
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.minDistance = so.orbit.minDist
  controls.maxDistance = so.orbit.maxDist
  controls.minPolarAngle = so.orbit.minPolar
  controls.maxPolarAngle = so.orbit.maxPolar
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.3
  // La vista nunca queda estática: la auto-rotación se reanuda tras inactividad.
  let idleTimer = null
  controls.addEventListener('start', () => {
    controls.autoRotate = false
    if (idleTimer) clearTimeout(idleTimer)
  })
  controls.addEventListener('end', () => {
    idleTimer = setTimeout(() => { controls.autoRotate = true }, 3500)
  })

  // ─── Post-proceso: el "lente" (fisheye + cromática + viñeta) ──────────────
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const lensPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uStrength: { value: rc.fisheye },
      uChroma: { value: rc.chroma },
      uVigSize: { value: rc.vigSize },
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform float uStrength, uChroma, uVigSize;
      void main(){
        vec2 cc = vUv - 0.5;
        float rn = length(cc) / 0.7071;
        float k = min(uStrength, 0.62);
        float f = mix(1.0 - k, 1.0, rn * rn);            // fisheye (barril)
        float ca = pow(rn, 2.5) * uChroma * 0.07;        // aberración cromática
        float r = texture2D(tDiffuse, clamp(0.5 + cc * (f - ca), 0.0, 1.0)).r;
        float g = texture2D(tDiffuse, clamp(0.5 + cc * f,        0.0, 1.0)).g;
        float b = texture2D(tDiffuse, clamp(0.5 + cc * (f + ca), 0.0, 1.0)).b;
        vec3 col = vec3(r, g, b);
        col *= 1.0 - rn * rn * k * 0.3;                  // caída de brillo
        col *= smoothstep(uVigSize, uVigSize - 0.4, rn); // viñeta
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
  composer.addPass(lensPass)

  // El mundo puede colgar su propia pasada (la poza: el filtro submarino).
  if (so.addPass) so.addPass(composer, { scene, camera, renderer })

  // El mundo registra aquí lo suyo que depende de la resolución (uProj de los
  // shaders de puntos, `resolution` de las líneas gruesas, …).
  let resizeHook = null
  // Métricas del último resize, para que el mundo posicione su etiqueta.
  const metrics = { w: 0, h: 0, ox: 0, oy: 0, dpr: 1, proj: 1 }

  function resize() {
    const cw = container.clientWidth, ch = container.clientHeight
    // Por defecto llena la pantalla. El recuadro cuadrado se reserva para el
    // modo device (display redondo de 466×466).
    const side = Math.min(cw, ch)
    const w = rc.squareFrame ? side : cw
    const h = rc.squareFrame ? side : ch
    const dpr = Math.min(2, window.devicePixelRatio)
    renderer.setPixelRatio(dpr)
    renderer.setSize(w, h, false)
    composer.setPixelRatio(dpr)
    composer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    // uProj: convierte tamaño-mundo a píxeles con perspectiva correcta.
    const proj = (h * dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360))
    const el = renderer.domElement
    el.style.position = 'absolute'
    el.style.width = w + 'px'
    el.style.height = h + 'px'
    el.style.left = (cw - w) / 2 + 'px'
    el.style.top = (ch - h) / 2 + 'px'
    metrics.w = w; metrics.h = h
    metrics.ox = (cw - w) / 2; metrics.oy = (ch - h) / 2
    metrics.dpr = dpr; metrics.proj = proj
    if (resizeHook) resizeHook(metrics)
  }
  function setResizeHook(fn) { resizeHook = fn; resize() }
  resize()
  window.addEventListener('resize', resize)

  function flash(v) { flashV = Math.min(1, v) }

  let clock = 0
  // Cierra el frame: respiración de la vista, apagado del destello y render.
  function render(step) {
    clock += step
    if (flashV > 0.001) { flashV = Math.max(0, flashV - step * 4.5); flashEl.style.opacity = flashV }
    // Respiración: velocidad de giro que pulsa + leve vaivén del mundo.
    controls.autoRotateSpeed = 0.3 + Math.sin(clock * 0.18) * 0.16
    controls.target.y = breatheTargetY(clock, so.breathe)
    controls.update()
    composer.render()
  }

  // Desmontar: libera GPU y saca los nodos del DOM.
  function dispose() {
    window.removeEventListener('resize', resize)
    if (idleTimer) clearTimeout(idleTimer)
    controls.dispose()
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      const m = o.material
      if (Array.isArray(m)) m.forEach((x) => x.dispose())
      else if (m) m.dispose()
    })
    composer.dispose()
    renderer.dispose()
    // Liberar el CONTEXTO WebGL explícitamente: renderer.dispose() NO lo suelta,
    // y como cada mundo crea un renderer nuevo, sin esto los contextos se acumulan
    // hasta que el navegador mata el activo → pantalla negra al cambiar de mundo.
    renderer.forceContextLoss()
    for (const el of [renderer.domElement, labelEl, flashEl]) el.remove()
  }

  return {
    scene, camera, renderer, controls, composer, labelEl, metrics,
    flash, resize, setResizeHook, render, dispose,
  }
}
