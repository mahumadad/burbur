// Censo de un mundo: agentes con nombre y tipo. Puro: sin three/tone/DOM.
// El modelo deja `memory` y `state` como gancho para un futuro cerebro (LLM /
// generative_agents), aunque hoy no se usen.

/** Censo del bosque, por tipo. Contenido propio inspirado en un bosque templado. */
export const FOREST_CENSUS = [
  // flying_animal (mayoría en un bosque)
  { name: 'pito real', type: 'flying_animal' },
  { name: 'cárabo', type: 'flying_animal', night: true },
  { name: 'corneja', type: 'flying_animal' },
  { name: 'arrendajo', type: 'flying_animal' },
  { name: 'mirlo', type: 'flying_animal', dawn: true },
  { name: 'chochín', type: 'flying_animal' },
  { name: 'petirrojo', type: 'flying_animal' },
  { name: 'trepador azul', type: 'flying_animal' },
  { name: 'busardo', type: 'flying_animal' },
  { name: 'jilguero', type: 'flying_animal' },
  { name: 'urraca', type: 'flying_animal' },
  { name: 'cuco', type: 'flying_animal' },
  { name: 'chotacabras', type: 'flying_animal', night: true },
  { name: 'paloma zurita', type: 'flying_animal' },
  { name: 'gavilán', type: 'flying_animal' },
  // walking_animal
  { name: 'corzo', type: 'walking_animal' },
  { name: 'tejón', type: 'walking_animal', night: true },
  { name: 'zorro', type: 'walking_animal', night: true },
  { name: 'ardilla roja', type: 'walking_animal' },
  { name: 'ratón de campo', type: 'walking_animal', night: true },
  { name: 'sapo común', type: 'walking_animal' },
  { name: 'faisán', type: 'walking_animal' },
  // static_object (no se mueven pero suenan)
  { name: 'viejo roble', type: 'static_object' },
  { name: 'el arroyo', type: 'static_object' },
  { name: 'la hojarasca', type: 'static_object' },
  { name: 'los mosquitos', type: 'static_object' },
  // human (raros)
  { name: 'recolector', type: 'human' },
  { name: 'excursionista', type: 'human' },
  { name: 'ciclista de montaña', type: 'human' },
  { name: 'paseador de perros', type: 'human' },
]

/**
 * Censo de la célula (un macrófago). Los `organelle` e `invader` se mueven y
 * salen a escena; las `structure` son el paisaje: suenan y se narran, pero no
 * deambulan. Ver `docs/superpowers/specs/2026-08-11-diseno-mundo-celula.md` §2.
 */
export const CELL_CENSUS = [
  // organelle — los individuos con jaula, estela y nombre (móviles: sin artículo,
  // como la fauna del bosque)
  { name: 'mitocondria', type: 'organelle' },
  { name: 'vesícula de transporte', type: 'organelle' },
  { name: 'lisosoma', type: 'organelle' },
  { name: 'endosoma temprano', type: 'organelle' },
  { name: 'endosoma tardío', type: 'organelle' },
  { name: 'autofagosoma', type: 'organelle' },
  { name: 'peroxisoma', type: 'organelle' },
  { name: 'gránulo secretor', type: 'organelle' },
  { name: 'fagosoma', type: 'organelle' },
  // motor — caminan por los rieles
  { name: 'kinesina', type: 'motor' },
  { name: 'dineína', type: 'motor' },
  // invader — llegan del sustrato
  { name: 'bacteria', type: 'invader' },
  { name: 'virión', type: 'invader' },
  // structure — el paisaje: no deambula. Con artículo, como los estáticos del
  // bosque ("el arroyo"): son también las CLAVES del léxico por nombre.
  { name: 'el núcleo', type: 'structure', static: true },
  { name: 'el nucleolo', type: 'structure', static: true },
  { name: 'el aparato de Golgi', type: 'structure', static: true },
  { name: 'el retículo rugoso', type: 'structure', static: true },
  { name: 'el retículo liso', type: 'structure', static: true },
  { name: 'el centrosoma', type: 'structure', static: true },
  { name: 'la corteza de actina', type: 'structure', static: true },
  { name: 'la adhesión focal', type: 'structure', static: true },
  { name: 'la fibra de estrés', type: 'structure', static: true },
  { name: 'el poro nuclear', type: 'structure', static: true },
  { name: 'el proteasoma', type: 'structure', static: true },
  { name: 'la bomba de iones', type: 'structure', static: true },
  // signal — recorren la célula sin ser objetos
  { name: 'la onda de calcio', type: 'signal', static: true },
]

/**
 * Construye el censo del mundo y asigna identidad a los agentes VISIBLES.
 * Devuelve { census, visible } donde `visible[i]` = { name, type, idx, memory, state }.
 */
export function createCensus(source, visibleCount, rand = Math.random) {
  const census = source.map((a) => ({ ...a, memory: [], state: 'move' }))
  // A cada agente visible se le da una identidad del censo (para la etiqueta al
  // pasar el mouse y para las interacciones). Se prefieren tipos que "se mueven":
  // el bosque los marca con el tipo `static_object`, los demás mundos con `static`.
  const movers = census.filter((a) => !(a.static ?? a.type === 'static_object'))
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
