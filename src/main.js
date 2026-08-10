import { CONFIG } from './config.js'

const overlay = document.getElementById('overlay')
let running = false

function start() {
  if (running) return
  running = true
  overlay.classList.add('hidden')
  let last = performance.now()
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    // sim/render/audio se cablean en tareas siguientes
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

overlay.addEventListener('click', start)
console.log('murmur-world boot', CONFIG.fireflies.count, 'luciérnagas')
