import * as Tone from 'tone'
import { CONFIG } from './config.js'
import { createSwarm, updateSwarm, attract, perturbPhases } from './sim/fireflies.js'
import { createAmbient } from './sim/ambient.js'
import { createEcosystem } from './sim/ecosystem.js'
import { createScene } from './render/scene.js'
import { createAudio } from './audio/engine.js'
import { createHud } from './ui/hud.js'

const overlay = document.getElementById('overlay')
const app = document.getElementById('app')
let running = false

async function start() {
  if (running) return
  running = true
  overlay.classList.add('hidden')

  await Tone.start()
  const swarm = createSwarm(CONFIG.fireflies)
  const scene = createScene(app, CONFIG)
  const audio = await createAudio(CONFIG)
  const ambient = createAmbient(CONFIG.ambient)
  const ecosystem = createEcosystem(CONFIG.ecosystem)
  const hud = createHud('#8fe04a', {
    // MUSIC = latidos + drone; WORLD = cama atmosférica.
    onMusic: (db) => { audio.setFlashVol(db); audio.setDroneVol(db - 4) },
    onWorld: (db) => audio.setBedVol(db - 8),
  })

  // Interacción: el mouse atrae a los individuos cercanos.
  let mouse = null
  app.addEventListener('pointermove', (e) => {
    const rect = app.getBoundingClientRect()
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
    mouse = { x: nx * CONFIG.fireflies.bounds.x, y: ny * CONFIG.fireflies.bounds.y }
  })
  app.addEventListener('pointerleave', () => { mouse = null })
  // Barra espaciadora: perturba las fases (desincroniza → mira cómo re-sincronizan).
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); perturbPhases(swarm, Math.PI) }
  })

  let last = performance.now()
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    if (mouse) attract(swarm, CONFIG.fireflies, mouse.x, mouse.y, 0.6 * dt)
    const eco = ecosystem.update(dt)
    hud.update(eco)
    // La actividad del mundo modula cuántos individuos llegan a latir.
    const flashes = updateSwarm(swarm, CONFIG.fireflies, dt)
    for (const fl of flashes) {
      if (Math.random() < 0.25 + eco.activity * 0.75) audio.triggerFlash(fl.y, fl.intensity)
    }
    const env = ambient.update(dt)
    audio.setWind(Math.max(env.wind, eco.rain * 0.85))
    if (env.cricket && Math.random() < eco.activity) audio.cricket()
    if (env.owl) audio.owl()
    scene.update(swarm, dt, eco)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

overlay.addEventListener('click', start)
