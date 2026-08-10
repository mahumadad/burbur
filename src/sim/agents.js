// Censo de un mundo: agentes con nombre y tipo. Puro: sin three/tone/DOM.
// El modelo deja `memory` y `state` como gancho para un futuro cerebro (LLM /
// generative_agents), aunque hoy no se usen.

/** Censo del bosque, por tipo. Contenido propio inspirado en un bosque templado. */
export const FOREST_CENSUS = [
  // flying_animal (mayoría en un bosque)
  { name: 'green woodpecker', type: 'flying_animal' },
  { name: 'tawny owl', type: 'flying_animal', night: true },
  { name: 'carrion crow', type: 'flying_animal' },
  { name: 'jay', type: 'flying_animal' },
  { name: 'blackbird', type: 'flying_animal', dawn: true },
  { name: 'wren', type: 'flying_animal' },
  { name: 'robin', type: 'flying_animal' },
  { name: 'nuthatch', type: 'flying_animal' },
  { name: 'buzzard', type: 'flying_animal' },
  { name: 'goldfinch', type: 'flying_animal' },
  { name: 'magpie', type: 'flying_animal' },
  { name: 'cuckoo', type: 'flying_animal' },
  { name: 'nightjar', type: 'flying_animal', night: true },
  { name: 'stock dove', type: 'flying_animal' },
  { name: 'sparrowhawk', type: 'flying_animal' },
  // walking_animal
  { name: 'roe deer', type: 'walking_animal' },
  { name: 'badger', type: 'walking_animal', night: true },
  { name: 'fox', type: 'walking_animal', night: true },
  { name: 'red squirrel', type: 'walking_animal' },
  { name: 'wood mouse', type: 'walking_animal', night: true },
  { name: 'common toad', type: 'walking_animal' },
  { name: 'pheasant', type: 'walking_animal' },
  // static_object (no se mueven pero suenan)
  { name: 'old oak', type: 'static_object' },
  { name: 'the stream', type: 'static_object' },
  { name: 'leaf litter', type: 'static_object' },
  { name: 'midges', type: 'static_object' },
  // human (raros)
  { name: 'forager', type: 'human' },
  { name: 'hiker', type: 'human' },
  { name: 'mountain biker', type: 'human' },
  { name: 'dog walker', type: 'human' },
]

/**
 * Construye el censo del mundo y asigna identidad a los agentes VISIBLES.
 * Devuelve { census, visible } donde `visible[i]` = { name, type, idx, memory, state }.
 */
export function createCensus(source, visibleCount, rand = Math.random) {
  const census = source.map((a) => ({ ...a, memory: [], state: 'move' }))
  // A cada agente visible se le da una identidad del censo (para la etiqueta al
  // pasar el mouse y para las interacciones). Se prefieren tipos que "se mueven".
  const movers = census.filter((a) => a.type !== 'static_object')
  const visible = []
  for (let i = 0; i < visibleCount; i++) {
    const src = movers[(rand() * movers.length) | 0]
    visible.push({ name: src.name, type: src.type, idx: i, memory: [], state: 'move' })
  }
  return { census, visible }
}

/** Peso de un agente según la hora: nocturnos de noche, cantores al alba, etc. */
export function timeWeight(agent, phase) {
  const night = phase === 'night' || phase === 'pre-dawn'
  const dawn = phase === 'dawn chorus' || phase === 'first light'
  if (agent.night) return night ? 3 : 0.15
  if (agent.dawn) return dawn ? 3 : 1
  return 1
}
