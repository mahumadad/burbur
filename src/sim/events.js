// EventEngine: la fuente de eventos procedural. Puro y determinista dado `rand`.
// Implementa la interfaz EventSource: update(dt, world) -> Event[].
// Sustituible por un timeline horneado o un LLM offline sin tocar log/audio/UI.

import { narrate } from './narrator.js'
import { timeWeight } from './agents.js'

const DIRS = ['left', 'right', 'ahead', 'behind', 'above', 'below', 'all around']

// Distribución de tipos (del análisis del bundle; `shift` va aparte, por evento).
const TYPE_WEIGHTS = [
  ['sound', 0.72], ['residue', 0.11], ['overview', 0.08],
  ['interaction', 0.033], ['moment', 0.015], ['setup', 0.012],
  ['distant', 0.012], ['conflict', 0.008],
]

function weightedPick(pairs, rand) {
  let total = 0
  for (const [, w] of pairs) total += w
  let r = rand() * total
  for (const [k, w] of pairs) { if ((r -= w) <= 0) return k }
  return pairs[0][0]
}

function pickCensus(census, phase, rand) {
  // Peso por hora: nocturnos de noche, cantores al alba.
  let total = 0
  const w = census.map((a) => { const x = timeWeight(a, phase); total += x; return x })
  let r = rand() * total
  for (let i = 0; i < census.length; i++) { if ((r -= w[i]) <= 0) return census[i] }
  return census[0]
}

/**
 * @param {{census:Array, visible:Array}} pop
 * @param {{baseRate:number, ambientProb:number}} cfg
 */
export function createEventEngine(pop, cfg, rand = Math.random) {
  let budget = 0
  let lastActor = null // para 'residue'

  function makeEvent(type, world) {
    let agent = null, agentType = null, agentIdx = null, source = null
    let dir = null

    if (type === 'shift' || type === 'overview' || type === 'moment') {
      // Sin agente: hablan del mundo.
    } else if (type === 'residue' && lastActor) {
      agent = lastActor.name; agentType = lastActor.type
      agentIdx = lastActor.idx ?? null
      source = 'cache'
    } else if (type === 'interaction' || type === 'conflict' || type === 'setup') {
      // Agente VISIBLE (tiene idx): las interacciones ocurren "en escena".
      const v = pop.visible[(rand() * pop.visible.length) | 0]
      if (v) { agent = v.name; agentType = v.type; agentIdx = v.idx; lastActor = v }
      dir = DIRS[(rand() * DIRS.length) | 0]
    } else {
      // sound / distant: mayormente ambiente; si no, un agente del censo.
      if (type === 'sound' && rand() < cfg.ambientProb) {
        source = rand() < 0.5 ? 'ghost' : 'cache'
      } else {
        const a = pickCensus(pop.census, world.phase, rand)
        agent = a.name; agentType = a.type
        source = rand() < 0.5 ? 'ghost' : 'cache'
        lastActor = a
        dir = rand() < 0.7 ? DIRS[(rand() * DIRS.length) | 0] : null
      }
    }

    const text = narrate(
      { type, agent, agentType, dir },
      { phase: world.phase, weather: world.weather },
      rand,
    )
    return {
      t: world.time, type, agent, agentIdx, dir,
      log: text.log, short: text.short, source,
    }
  }

  function update(dt, world) {
    const out = []

    // Cambios de hora/clima → siempre un 'shift'.
    if (world.changedTime || world.changedWeather) out.push(makeEvent('shift', world))

    // Presupuesto de eventos, escalado por la actividad del ecosistema.
    const rate = cfg.baseRate * (0.35 + world.activity)
    budget += rate * dt
    let guard = 0
    while (budget >= 1 && guard++ < 8) {
      budget -= 1
      out.push(makeEvent(weightedPick(TYPE_WEIGHTS, rand), world))
    }
    return out
  }

  return { update }
}
