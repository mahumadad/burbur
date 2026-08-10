import { CONFIG } from './config.js'
import { createSwarm, updateSwarm } from './sim/fireflies.js'
import { createScene } from './render/scene.js'

const overlay = document.getElementById('overlay')
const app = document.getElementById('app')
let running = false

function start() {
  if (running) return
  running = true
  overlay.classList.add('hidden')

  const swarm = createSwarm(CONFIG.fireflies)
  const scene = createScene(app, CONFIG)

  let last = performance.now()
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    updateSwarm(swarm, CONFIG.fireflies, dt)
    scene.update(swarm)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

overlay.addEventListener('click', start)
