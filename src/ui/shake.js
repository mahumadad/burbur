// "Shake": gestos reales que sacuden el mundo + la animación de vibración. El
// BOTÓN ahora es una tarjeta del selector vertical (ui/selector.js), que llama a
// `trigger`; acá quedan solo los gestos físicos y el meneo del canvas. Todos
// pasan por `trigger` → animación + onShake.

const CSS = `
@keyframes wshake {
  10%, 90% { transform: translate3d(-1px, 0, 0); }
  20%, 80% { transform: translate3d(2px, 0, 0); }
  30%, 50%, 70% { transform: translate3d(-5px, 0, 0); }
  40%, 60% { transform: translate3d(5px, 0, 0); }
}
body.is-shaking #app { animation: wshake 0.7s cubic-bezier(.36,.07,.19,.97) both; }
`

export function createShake(onShake) {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  let lastTrigger = 0
  function trigger() {
    const now = performance.now()
    if (now - lastTrigger < 700) return // anti-rebote
    lastTrigger = now
    document.body.classList.add('is-shaking')
    setTimeout(() => document.body.classList.remove('is-shaking'), 700)
    onShake()
  }

  // iOS: el acelerómetro requiere permiso tras un gesto del usuario. Lo pedimos
  // en el primer tap (el mismo que entra al mundo ya sirve).
  window.addEventListener('pointerdown', function reqPerm() {
    const DME = window.DeviceMotionEvent
    if (DME && typeof DME.requestPermission === 'function') DME.requestPermission().catch(() => {})
    window.removeEventListener('pointerdown', reqPerm)
  }, { once: true })

  // Gesto móvil: una sacudida física fuerte.
  window.addEventListener('devicemotion', (e) => {
    const a = e.accelerationIncludingGravity || e.acceleration
    if (!a) return
    const mag = Math.abs(a.x || 0) + Math.abs(a.y || 0) + Math.abs(a.z || 0)
    if (mag > 34) trigger()
  })

  // Gesto desktop: sacudir el mouse rápido = varios cambios de dirección seguidos.
  let dir = 0, lastX = null, reversals = 0, lastRevT = 0
  window.addEventListener('pointermove', (e) => {
    if (lastX !== null) {
      const dx = e.clientX - lastX
      if (Math.abs(dx) > 12 && Math.sign(dx) !== dir && dir !== 0) {
        const now = performance.now()
        reversals = (now - lastRevT < 320) ? reversals + 1 : 1
        lastRevT = now
        if (reversals >= 4) { reversals = 0; trigger() }
      }
      if (Math.abs(dx) > 3) dir = Math.sign(dx)
    }
    lastX = e.clientX
  })

  return { trigger }
}
