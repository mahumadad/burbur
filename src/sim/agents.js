// Censo de un mundo: agentes con nombre y tipo. Puro: sin three/tone/DOM.
// El modelo deja `memory` y `state` como gancho para un futuro cerebro (LLM /
// generative_agents), aunque hoy no se usen.

/** Censo del bosque: FAUNA de la zona CENTRO de Chile (bosque esclerófilo/matorral). */
export const FOREST_CENSUS = [
  // aves (flying_animal)
  { name: 'zorzal', type: 'flying_animal', dawn: true },
  { name: 'chincol', type: 'flying_animal' },
  { name: 'diuca', type: 'flying_animal' },
  { name: 'tordo', type: 'flying_animal' },
  { name: 'loica', type: 'flying_animal' },
  { name: 'queltehue', type: 'flying_animal' },
  { name: 'tiuque', type: 'flying_animal' },
  { name: 'jote', type: 'flying_animal' },
  { name: 'picaflor', type: 'flying_animal' },
  { name: 'chercán', type: 'flying_animal' },
  { name: 'pitío', type: 'flying_animal' },
  { name: 'torcaza', type: 'flying_animal' },
  { name: 'cachaña', type: 'flying_animal' },
  { name: 'tucúquere', type: 'flying_animal', night: true },
  { name: 'lechuza', type: 'flying_animal', night: true },
  // mamíferos y reptiles (walking_animal)
  { name: 'zorro chilla', type: 'walking_animal', night: true },
  { name: 'zorro culpeo', type: 'walking_animal', night: true },
  { name: 'quique', type: 'walking_animal', night: true },
  { name: 'chingue', type: 'walking_animal', night: true },
  { name: 'degú', type: 'walking_animal' },
  { name: 'ratoncito', type: 'walking_animal', night: true },
  { name: 'liebre', type: 'walking_animal' },
  { name: 'lagartija', type: 'walking_animal' },
  // objetos que no se mueven pero suenan (incluye bichitos)
  { name: 'el viejo peumo', type: 'static_object' },
  { name: 'el estero', type: 'static_object' },
  { name: 'la hojarasca', type: 'static_object' },
  { name: 'los tábanos', type: 'static_object' },
  { name: 'los abejorros', type: 'static_object' },
  // personas (raras)
  { name: 'arriero', type: 'human' },
  { name: 'excursionista', type: 'human' },
  { name: 'ciclista de montaña', type: 'human' },
  { name: 'campesino', type: 'human' },
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
