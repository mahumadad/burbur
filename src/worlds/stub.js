import * as THREE from 'three'

// Mundo placeholder para los biomas todavía sin construir (agua/ciudad).
// Cumple la MISMA API que createScene (update/resize/flash/dispose) para que el
// host los intercambie sin ramas especiales. Muestra un fondo tintado + rótulo.
export function createStubWorld(container, cfg, { accent = '#aacdff', label = 'Próximamente' } = {}) {
  const scene = new THREE.Scene()
  const bg = new THREE.Color(accent).multiplyScalar(0.05)
  scene.background = bg
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(0, 0, 10)
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setClearColor(bg, 1)
  container.appendChild(renderer.domElement)

  const overlay = document.createElement('div')
  overlay.textContent = label + ' · próximamente'
  overlay.style.cssText = `position:absolute; inset:0; z-index:6; display:flex;
    align-items:center; justify-content:center; pointer-events:none;
    color:${accent}; font:600 15px/1 ui-monospace,'DM Mono',monospace;
    letter-spacing:0.14em; text-transform:uppercase; opacity:0.8;`
  container.appendChild(overlay)

  function resize() {
    const w = container.clientWidth, h = container.clientHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    const el = renderer.domElement
    el.style.position = 'absolute'
    el.style.width = w + 'px'
    el.style.height = h + 'px'
    el.style.left = '0'
    el.style.top = '0'
  }
  resize()
  window.addEventListener('resize', resize)

  // Ignora los argumentos del host (swarm/dt/eco); solo dibuja el fondo.
  function update() { renderer.render(scene, camera); return [] }
  function flash() {}
  function dispose() {
    window.removeEventListener('resize', resize)
    renderer.dispose()
    renderer.domElement.remove()
    overlay.remove()
  }
  return { update, resize, flash, dispose }
}
