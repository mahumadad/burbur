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

/** Censo del estanque, por tipo. Fauna de humedal chilena, en español (coherente
 * con el bosque). Móviles sin artículo; estáticos con artículo. */
export const POND_CENSUS = [
  // flying_animal — aves de humedal (mayoría)
  { name: 'garza cuca', type: 'flying_animal' },
  { name: 'cisne de cuello negro', type: 'flying_animal' },
  { name: 'tagua', type: 'flying_animal' },
  { name: 'pidén', type: 'flying_animal' },
  { name: 'pato jergón', type: 'flying_animal' },
  { name: 'martín pescador', type: 'flying_animal' },
  { name: 'hualas', type: 'flying_animal' },
  { name: 'siete colores', type: 'flying_animal', dawn: true },
  { name: 'trile', type: 'flying_animal', dawn: true },
  { name: 'run-run', type: 'flying_animal' },
  { name: 'pato colorado', type: 'flying_animal' },
  { name: 'yeco', type: 'flying_animal' },
  { name: 'garza grande', type: 'flying_animal' },
  // walking_animal — de la ribera
  { name: 'coipo', type: 'walking_animal', night: true },
  { name: 'huillín', type: 'walking_animal', night: true },
  { name: 'rana chilena', type: 'walking_animal' },
  { name: 'culebra de cola larga', type: 'walking_animal' },
  // static_object — el paisaje: no deambula pero suena
  { name: 'el juncal', type: 'static_object' },
  { name: 'el agua quieta', type: 'static_object' },
  { name: 'los nenúfares', type: 'static_object' },
  { name: 'los mosquitos', type: 'static_object' },
  // human (raros)
  { name: 'el pescador', type: 'human' },
  { name: 'la kayakista', type: 'human' },
  { name: 'el observador de aves', type: 'human' },
]

/** Censo de la ciudad: fauna urbana chilena + actores humanos, en español
 * (coherente con el bosque y el estanque). Móviles sin artículo; estáticos
 * con artículo. */
export const CITY_CENSUS = [
  // flying_animal — aves urbanas
  { name: 'paloma', type: 'flying_animal' },
  { name: 'tórtola', type: 'flying_animal' },
  { name: 'zorzal', type: 'flying_animal', dawn: true },
  { name: 'chincol', type: 'flying_animal' },
  { name: 'gorrión', type: 'flying_animal' },
  { name: 'tiuque', type: 'flying_animal' },
  { name: 'jote', type: 'flying_animal' },
  { name: 'golondrina', type: 'flying_animal' },
  // walking_animal — de la calle y los sitios eriazos
  { name: 'quiltro', type: 'walking_animal' },
  { name: 'gato callejero', type: 'walking_animal', night: true },
  { name: 'laucha', type: 'walking_animal', night: true },
  { name: 'rata', type: 'walking_animal', night: true },
  { name: 'zarigüeya', type: 'walking_animal', night: true },
  // static_object — el paisaje: no deambula pero suena
  { name: 'el semáforo', type: 'static_object' },
  { name: 'el paradero', type: 'static_object' },
  { name: 'la fuente', type: 'static_object' },
  { name: 'el letrero de neón', type: 'static_object' },
  // human
  { name: 'transeúnte', type: 'human' },
  { name: 'vendedor ambulante', type: 'human' },
  { name: 'ciclista', type: 'human' },
  { name: 'guardia', type: 'human' },
  { name: 'músico callejero', type: 'human' },
]

/**
 * Construye el censo del mundo y asigna identidad a los agentes VISIBLES.
 * Devuelve { census, visible } donde `visible[i]` = { name, type, idx, memory, state }.
 */
export function createCensus(source, visibleCount, rand = Math.random, isAerial = null) {
  const census = source.map((a) => ({ ...a, memory: [], state: 'move' }))
  // A cada agente visible se le da una identidad del censo (para la etiqueta al
  // pasar el mouse y para las interacciones). Se prefieren tipos que "se mueven":
  // el bosque los marca con el tipo `static_object`, los demás mundos con `static`.
  const movers = census.filter((a) => !(a.static ?? a.type === 'static_object'))
  // La LOCOMOCIÓN manda: si el mundo declara qué slots son AÉREOS (los que se
  // posan alto o cruzan el cielo) y tiene aves, esos slots solo reciben aves
  // (`flying_animal`) y el resto, animales de tierra o personas. Así ningún zorro
  // termina volando. Sin `isAerial` —o sin aves, p. ej. la célula— todos salen
  // del mismo conjunto de móviles (comportamiento base, intacto).
  const fliers = movers.filter((a) => a.type === 'flying_animal')
  const walkers = movers.filter((a) => a.type !== 'flying_animal')
  const split = isAerial && fliers.length > 0 && walkers.length > 0
  const visible = []
  for (let i = 0; i < visibleCount; i++) {
    const pool = split ? (isAerial(i) ? fliers : walkers) : movers
    const src = pool[(rand() * pool.length) | 0]
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
