import * as Tone from 'tone'
import { CONFIG } from './config.js'
import { createSwarm, updateSwarm, attract, perturbPhases } from './sim/fireflies.js'
import { createAmbient } from './sim/ambient.js'
import { createEcosystem } from './sim/ecosystem.js'
import { createCensus, FOREST_CENSUS } from './sim/agents.js'
import { createEventEngine } from './sim/events.js'
import { narrate } from './sim/narrator.js'
import { createScene } from './render/scene.js'
import { createAudio } from './audio/engine.js'
import { createHud } from './ui/hud.js'
import { createEventLog } from './ui/eventlog.js'

// Reloj HH:MM a partir del avance del día (para los timestamps del log).
function clockLabel(eco) {
  const frac = (eco.phaseIndex + eco.phaseT) / 12
  const h = Math.floor(frac * 24) % 24
  const m = Math.floor(((frac * 24) % 1) * 60)
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
}

const overlay = document.getElementById('overlay')
const app = document.getElementById('app')
let running = false

async function start() {
  if (running) return
  running = true
  overlay.classList.add('hidden')

  await Tone.start()
  const swarm = createSwarm(CONFIG.fireflies)
  const pop = createCensus(FOREST_CENSUS, CONFIG.fireflies.count)
  const scene = createScene(app, CONFIG, pop.visible.map((v) => v.name))
  const audio = await createAudio(CONFIG)
  const ambient = createAmbient(CONFIG.ambient)
  const ecosystem = createEcosystem(CONFIG.ecosystem)
  const events = createEventEngine(pop, CONFIG.events)
  const eventLog = createEventLog('#8fe04a')
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
  let lightningCooldown = 4
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    if (mouse) attract(swarm, CONFIG.fireflies, mouse.x, mouse.y, 0.6 * dt)
    const eco = ecosystem.update(dt)
    hud.update(eco)
    audio.setMood(eco.tension)

    // Motor de eventos: alimenta el log, la píldora y un acento de sonido.
    const evs = events.update(dt, {
      time: performance.now() / 1000,
      phase: eco.phase, weather: eco.weather, activity: eco.activity,
      changedTime: eco.changedTime, changedWeather: eco.changedWeather,
    })
    if (evs.length) {
      const label = clockLabel(eco)
      for (const ev of evs) {
        eventLog.push(ev, label)
        // Cada tipo de agente tiene su voz; el ambiente usa un acento suave.
        if (ev.agentType) audio.fauna(ev.agentType, ev.dir, ev.agent)
        else if (ev.dir && ev.type === 'sound') audio.accent(ev.dir, ev.log.length)
      }
    }

    // Tormenta: relámpagos y truenos cuando llueve (más con lluvia fuerte).
    if (eco.rain > 0.3) {
      lightningCooldown -= dt
      if (lightningCooldown <= 0 && Math.random() < 1.1 * dt * eco.rain) {
        lightningCooldown = 2.5 + Math.random() * 5
        const strength = 0.55 + eco.rain * 0.45
        scene.flash(0.7 * strength)
        // El trueno llega tras el destello (según "distancia").
        const delay = 300 + Math.random() * 1600
        setTimeout(() => audio.thunder(strength), delay)
        if (Math.random() < 0.5) setTimeout(() => scene.flash(0.4 * strength), 90)
      }
    }

    // La actividad del mundo modula cuántos individuos llegan a latir.
    const flashes = updateSwarm(swarm, CONFIG.fireflies, dt)
    for (const fl of flashes) {
      if (Math.random() < 0.25 + eco.activity * 0.75) audio.triggerFlash(fl.y, fl.intensity)
    }
    const env = ambient.update(dt)
    audio.setWind(Math.max(env.wind, eco.rain * 0.4))
    // Lluvia: siseo por intensidad + goteo a un ritmo proporcional.
    audio.setRain(eco.rain)
    if (eco.rain > 0.02 && Math.random() < eco.rain * 26 * dt) audio.drip()
    // Los grillos son de clima cálido: enmudecen con el frío.
    if (env.cricket && eco.temperature > 4 && Math.random() < eco.activity) audio.cricket()
    if (env.owl) audio.owl()
    const predations = scene.update(swarm, dt, eco)
    // Un cazador atrapó a un bicho → evento de conflicto narrado.
    if (predations && predations.length) {
      const label = clockLabel(eco)
      for (const p of predations) {
        const who = pop.visible[p.hunterIdx]
        if (!who) continue
        const ev = { type: 'conflict', agent: who.name, agentIdx: p.hunterIdx, dir: p.dir }
        const text = narrate({ ...ev, agentType: who.type }, { phase: eco.phase, weather: eco.weather })
        eventLog.push({ ...ev, ...text }, label)
        audio.fauna(who.type, p.dir)
      }
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

overlay.addEventListener('click', start)
