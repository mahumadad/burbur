// "Shake": botón + gestos reales que sacuden el mundo. En murmur.living el shake
// de la web es un botón (no hay acelerómetro); acá lo replicamos como botón y
// ADEMÁS agregamos gesto físico: devicemotion en móvil y sacudida rápida de
// mouse en desktop. Todos llaman al mismo onShake.

const CSS = `
.shake-btn {
  position: fixed; bottom: 16px; right: 16px; z-index: 20;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 14px; border-radius: 999px; cursor: pointer;
  background: rgba(6, 10, 8, 0.62); backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.10); color: #eafff0;
  font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.10em; text-transform: uppercase; user-select: none;
}
.shake-btn:hover { border-color: var(--accent, #8fe04a); color: var(--accent, #8fe04a); }
.shake-btn .g { font-size: 13px; line-height: 1; }
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

  const btn = document.createElement('button')
  btn.className = 'shake-btn'
  btn.innerHTML = `<span class="g">⤨</span>agitar`
  document.body.appendChild(btn)

  let lastTrigger = 0
  function trigger() {
    const now = performance.now()
    if (now - lastTrigger < 700) return // anti-rebote
    lastTrigger = now
    document.body.classList.add('is-shaking')
    setTimeout(() => document.body.classList.remove('is-shaking'), 700)
    onShake()
  }

  btn.addEventListener('click', () => {
    // En iOS el acelerómetro requiere permiso tras un gesto: lo pedimos aquí.
    const DME = window.DeviceMotionEvent
    if (DME && typeof DME.requestPermission === 'function') {
      DME.requestPermission().catch(() => {})
    }
    trigger()
  })

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

  return { el: btn, trigger }
}
