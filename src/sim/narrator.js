// Narrador gramatical: convierte un evento en texto (español). Puro y determinista.
// Estilo bitácora: usa el nombre como sujeto SIN artículo, para no lidiar con el
// género ("MIRLO canta...", "ZORRO se aleja..."). Los objetos estáticos ya traen
// su artículo en el nombre ("el arroyo", "la hojarasca").

import { phaseES, weatherES } from '../i18n.js'

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const pick = (arr, rand) => arr[(rand() * arr.length) | 0]

// Acciones por tipo: { l: fragmento largo, s: forma corta }.
const ACTIONS = {
  flying_animal: [
    { l: 'canta fino y agudo', s: 'canta' },
    { l: 'parlotea desde una rama oculta', s: 'parlotea' },
    { l: 'tamborilea sobre madera muerta', s: 'tamborilea' },
    { l: 'da una vuelta por encima', s: 'sobrevuela' },
    { l: 'regaña a un intruso invisible', s: 'regaña' },
    { l: 'deja caer una sola nota', s: 'canta' },
    { l: 'sale aleteando del follaje', s: 'alza el vuelo' },
  ],
  walking_animal: [
    { l: 'quiebra una ramita al pisar', s: 'quiebra una ramita' },
    { l: 'camina entre la hojarasca', s: 'pasa' },
    { l: 'se congela a medio paso, atento', s: 'se congela' },
    { l: 'hurga en la maleza', s: 'forrajea' },
    { l: 'se aleja a saltos por el helecho', s: 'se aleja a saltos' },
    { l: 'escarba en el suelo húmedo', s: 'escarba' },
  ],
  static_object: [
    { l: 'cruje cuando el viento lo empuja', s: 'cruje' },
    { l: 'gotea sin parar sobre la hojarasca', s: 'gotea' },
    { l: 'zumba con una nube de mosquitos', s: 'zumba' },
    { l: 'suspira cuando el aire lo atraviesa', s: 'suspira' },
    { l: 'corre sobre piedras frías', s: 'fluye' },
  ],
  human: [
    { l: 'pasa con cuidado', s: 'pasa' },
    { l: 'murmura algo por lo bajo', s: 'murmura' },
    { l: 'aparta una rama de un golpe', s: 'aparta una rama' },
    { l: 'silba una vez y calla', s: 'silba' },
    { l: 'rebusca en una mochila', s: 'rebusca' },
  ],
}

// Texturas de ambiente (sin agente).
const AMBIENT = [
  { l: 'Una gota suave cae de las hojas mojadas', s: 'gotean las hojas' },
  { l: 'Una ramita se asienta en la oscuridad', s: 'cruje una ramita' },
  { l: 'Agua lejana corre sobre las piedras', s: 'agua lejana' },
  { l: 'El viento peina las ramas altas', s: 'viento en las ramas' },
  { l: 'La lluvia repica suave sobre las hojas anchas', s: 'lluvia en las hojas' },
  { l: 'Una rama lejana cruje y aguanta', s: 'cruje una rama' },
  { l: 'La hojarasca susurra y vuelve a callar', s: 'susurra la hojarasca' },
]

const DIR_PHRASE = {
  left: 'a la izquierda', right: 'a la derecha', ahead: 'más adelante',
  behind: 'en algún lugar detrás', above: 'por encima', below: 'a ras del suelo',
  'all around': 'por todas partes',
}

// ─── LÉXICOS POR MUNDO ──────────────────────────────────────────────────────
// Un léxico trae el vocabulario (`actions`, `ambient`), el lugar (`place`, con
// artículo) y, opcionalmente, una función por tipo de evento que reemplaza la
// plantilla genérica. `narrate` usa el del bosque si no le pasan otro.
// Las CLAVES (tipos, fases, climas) siguen en inglés; el texto es español.

export const FOREST_LEXICON = {
  actions: ACTIONS,
  ambient: AMBIENT,
  fallbackType: 'static_object',
  place: 'el claro',
  moment: (ctx) => ({
    log: `El viejo roble gime mientras ${weatherES(ctx.weather)} se apodera del claro.`,
    short: 'gime el roble',
  }),
  overview: (ctx) => ({
    log: `${cap(weatherES(ctx.weather))} se asienta sobre el claro mientras ${phaseES(ctx.phase)} se ahonda.`,
    short: 'panorama',
  }),
  shift: (ctx) => ({ log: `La luz gira hacia ${phaseES(ctx.phase)}.`, short: `cambio · ${phaseES(ctx.phase)}` }),
  conflict: (ctx, ev, rand) => {
    const a = pick(ACTIONS[ev.agentType] || ACTIONS.static_object, rand)
    return { log: `Algo sobresalta al claro; ${ev.agent} ${a.l}.`, short: `${ev.agent} ${a.s}` }
  },
}

// Célula: vocabulario de biología celular (doc de diseño §7). Además de las
// acciones por TIPO, hay acciones por NOMBRE: las estructuras celulares hacen
// cosas demasiado distintas entre sí para compartir un balde genérico.
const CELL_ACTIONS = {
  organelle: [
    { l: 'pulsa, y un cuanto de ATP se desprende', s: 'pulsa' },
    { l: 'se desliza por un microtúbulo', s: 'se desliza' },
    { l: 'atraca y descarga su contenido', s: 'descarga' },
    { l: 'se detiene, esperando un motor', s: 'se detiene' },
    { l: 'se desprende y deriva hacia adentro', s: 'se desprende' },
    { l: 'encuentra a otro y se fusiona', s: 'se fusiona' },
  ],
  motor: [
    { l: 'da un paso, y otro, arrastrando su carga', s: 'avanza' },
    { l: 'se suelta, tantea y vuelve a agarrarse', s: 'se reengancha' },
    { l: 'lleva su carga hacia el borde', s: 'acarrea' },
  ],
  invader: [
    { l: 'da una voltereta y arranca de nuevo', s: 'da una voltereta' },
    { l: 'deriva contra la membrana', s: 'deriva' },
    { l: 'tantea a ciegas buscando un receptor', s: 'tantea' },
    { l: 'se cuela más allá de la corteza', s: 'se cuela' },
  ],
  structure: [
    { l: 'se asienta y aguanta', s: 'aguanta' },
    { l: 'queda en silencio un momento', s: 'calla' },
    { l: 'toma la tensión sobre sí', s: 'se tensa' },
  ],
  signal: [
    { l: 'barre el citoplasma de lado a lado', s: 'barre' },
    { l: 'se desvanece en el borde lejano', s: 'se desvanece' },
  ],
  // ── Vocabulario por nombre: cada estructura hace lo suyo ──
  'el núcleo': [
    { l: 'zumba de transcripción', s: 'zumba' },
    { l: 'afloja su cromatina', s: 'se afloja' },
    { l: 'deja salir un mensaje por un poro', s: 'exporta' },
  ],
  'el nucleolo': [
    { l: 'arma otra tanda de ribosomas', s: 'arma ribosomas' },
  ],
  'el aparato de Golgi': [
    { l: 'apila otra cisterna', s: 'apila' },
    { l: 'suelta una vesícula desde el borde', s: 'suelta una vesícula' },
    { l: 'clasifica una carga y la despacha', s: 'clasifica' },
  ],
  'el retículo rugoso': [
    { l: 'pliega una cadena recién hecha', s: 'pliega' },
    { l: 'hormiguea de ribosomas', s: 'hormiguea' },
  ],
  'el retículo liso': [
    { l: 'libera un pulso de calcio', s: 'libera calcio' },
  ],
  'el centrosoma': [
    { l: 'hace nacer un microtúbulo nuevo', s: 'nuclea' },
    { l: 'sostiene toda la red', s: 'ancla' },
  ],
  'la corteza de actina': [
    { l: 'avanza a trinquete en el borde', s: 'avanza' },
    { l: 'cede, y la membrana se abomba', s: 'cede' },
  ],
  'la adhesión focal': [
    { l: 'se aferra al sustrato y madura', s: 'se aferra' },
    { l: 'se suelta, y la cola salta hacia adelante', s: 'se suelta' },
  ],
  'la fibra de estrés': [
    { l: 'sostiene la tensión sin ceder', s: 'sostiene' },
    { l: 'acerca sus dos extremos', s: 'se contrae' },
  ],
  'el poro nuclear': [
    { l: 'se abre, se cierra, y vuelve a abrirse', s: 'cicla' },
  ],
  'el proteasoma': [
    { l: 'tritura una proteína gastada', s: 'tritura' },
  ],
  'la bomba de iones': [
    { l: 'empuja contra el gradiente, una y otra vez', s: 'bombea' },
  ],
}

const CELL_AMBIENT = [
  { l: 'Una ondulación recorre el borde de avance', s: 'ondula el borde' },
  { l: 'Cerca de la corteza, la actina cede', s: 'cede la actina' },
  { l: 'Un filopodio se estira, no encuentra nada, se retrae', s: 'se retrae un filopodio' },
  { l: 'El citoplasma se asienta en una corriente más lenta', s: 'la corriente se calma' },
  { l: 'En lo hondo del núcleo, un poro se abre y se cierra', s: 'cicla un poro' },
  { l: 'Un microtúbulo crece un poco más, y se derrumba', s: 'se derrumba un microtúbulo' },
]

export const CELL_LEXICON = {
  actions: CELL_ACTIONS,
  ambient: CELL_AMBIENT,
  fallbackType: 'structure',
  place: 'el citoplasma',
  moment: (ctx) => ({
    log: `El núcleo se hincha mientras ${weatherES(ctx.weather)} se apodera del citoplasma.`,
    short: 'el núcleo se hincha',
  }),
  overview: (ctx) => ({
    log: `${cap(weatherES(ctx.weather))} se asienta sobre el citoplasma mientras ${phaseES(ctx.phase)} se ahonda.`,
    short: 'panorama',
  }),
  // El día de este mundo es el ciclo celular: no amanece, avanza de fase.
  shift: (ctx) => ({
    log: `El ciclo gira hacia ${phaseES(ctx.phase)}.`,
    short: `cambio · ${phaseES(ctx.phase)}`,
  }),
  // El conflicto tiene dos caras: la célula caza invasores; a los suyos los
  // aprieta la contracción.
  // Fraseo sin género: los nombres del censo mezclan masculinos y femeninos.
  conflict: (ctx, ev) => (ev.agentType === 'invader'
    ? { log: `El lamelipodio se pliega; ${ev.agent} queda dentro. El fagosoma se sella.`, short: `fagocitosis · ${ev.agent}` }
    : { log: `${cap(ev.agent)} se traba en la contracción y se detiene.`, short: `${ev.agent} se detiene` }),
  // Momentos del ciclo celular real (sim/cellCycle.js §5 del spec): son
  // acontecimientos ocasionales, no la plantilla genérica de `moment`.
  byKind: {
    enter: () => ({
      log: 'El núcleo se prepara: la célula entra en ciclo.',
      short: 'entra en ciclo',
    }),
    commit: () => ({
      log: 'Cruza el punto de restricción. Ya no hay vuelta atrás.',
      short: 'punto de restricción',
    }),
    abort: () => ({
      log: 'La señal se apaga; la célula vuelve a la quiescencia.',
      short: 'vuelve a G0',
    }),
    divide: () => ({
      log: 'El anillo contráctil aprieta. La célula se parte en dos.',
      short: 'división',
    }),
  },
}

// Neurona: vocabulario de electrofisiología (spec §8). Acciones por TIPO
// (neuronas, interneuronas, glía, señales, tejido) + por NOMBRE para las
// estructuras sinápticas, que hacen cosas demasiado distintas entre sí.
const NEURON_ACTIONS = {
  neuron: [
    { l: 'dispara una ráfaga corta', s: 'dispara' },
    { l: 'se carga hasta el umbral y descarga', s: 'descarga' },
    { l: 'queda en refractario un instante', s: 'se calla' },
    { l: 'suma entradas y no llega a disparar', s: 'no llega' },
    { l: 'se enciende justo cuando lo hace su vecina', s: 'sigue a su vecina' },
  ],
  interneuron: [
    { l: 'dispara rápido y sin pausa', s: 'traquetea' },
    { l: 'calla a sus vecinas de golpe', s: 'calla al vecindario' },
    { l: 'abre una ventana de silencio', s: 'abre silencio' },
    { l: 'recorta la ráfaga que venía', s: 'recorta' },
  ],
  glia: [
    { l: 'barre lo que quedó en la hendidura', s: 'barre la hendidura' },
    { l: 'estira un pie hacia una sinapsis', s: 'estira un pie' },
    { l: 'deja pasar una onda lenta de calcio', s: 'ondula de calcio' },
    { l: 'alimenta a la sinapsis que trabaja', s: 'alimenta' },
  ],
  neurotransmitter: [
    { l: 'inunda la hendidura', s: 'inunda' },
    { l: 'encuentra su receptor', s: 'aterriza' },
    { l: 'se escapa hacia afuera', s: 'se escapa' },
  ],
  signal: [
    { l: 'barre la red de un lado al otro', s: 'barre' },
    { l: 'se apaga en el borde', s: 'se apaga' },
  ],
  tissue: [
    { l: 'late al fondo, ajeno a todo', s: 'late al fondo' },
    { l: 'entrega oxígeno y sigue', s: 'irriga' },
  ],
  // ── por nombre: cada estructura sináptica hace lo suyo ──
  'el botón terminal': [
    { l: 'suelta su pool listo de vesículas', s: 'libera' },
    { l: 'se queda sin vesículas listas', s: 'se agota' },
    { l: 'recibe el pulso y no libera nada', s: 'falla' },
  ],
  'la hendidura sináptica': [
    { l: 'se llena de neurotransmisor y se vacía', s: 'se llena y se vacía' },
    { l: 'queda limpia otra vez', s: 'queda limpia' },
  ],
  'el nodo de Ranvier': [
    { l: 'enciende y pasa el relevo', s: 'pasa el relevo' },
  ],
  'la bomba sodio-potasio': [
    { l: 'devuelve el gradiente a su sitio, gastando', s: 'restaura el gradiente' },
  ],
  'el cono axónico': [
    { l: 'junta la corriente y larga el pulso', s: 'larga el pulso' },
  ],
  'la espina dendrítica': [
    { l: 'se enciende al recibir', s: 'se enciende' },
  ],
  'el receptor AMPA': [
    { l: 'se abre apenas llega el glutamato', s: 'se abre' },
  ],
  'el receptor NMDA': [
    { l: 'espera despolarización para dejar pasar el calcio', s: 'espera' },
  ],
}

const NEURON_AMBIENT = [
  { l: 'Un pulso recorre un axón y se pierde en el borde', s: 'un pulso se pierde' },
  { l: 'En algún lugar de la red, una sinapsis falla en silencio', s: 'una sinapsis falla' },
  { l: 'El neuropilo cruje de actividad que no se ve', s: 'cruje el neuropilo' },
  { l: 'Una mitocondria se detiene en un terminal y se queda', s: 'para una mitocondria' },
  { l: 'Un capilar late, ajeno a la conversación', s: 'late el capilar' },
  { l: 'El ritmo de fondo se hace más lento', s: 'el ritmo se hace lento' },
]

export const NEURON_LEXICON = {
  actions: NEURON_ACTIONS,
  ambient: NEURON_AMBIENT,
  fallbackType: 'neuron',
  place: 'la red',
  moment: (ctx) => ({
    log: `El ritmo se acomoda mientras ${weatherES(ctx.weather)} baña la red.`,
    short: 'se acomoda el ritmo',
  }),
  overview: (ctx) => ({
    log: `${cap(weatherES(ctx.weather))} se asienta sobre la red mientras se ahonda ${phaseES(ctx.phase)}.`,
    short: 'panorama',
  }),
  // El "día" es un ciclo de sueño: no amanece, cambia de estado.
  shift: (ctx) => ({
    log: `El estado gira hacia ${phaseES(ctx.phase)}.`,
    short: `cambio · ${phaseES(ctx.phase)}`,
  }),
  // El conflicto tiene dos caras: la inhibición (una interneurona calla a sus
  // vecinas) y la convulsión (la sincronía desbocada). La decide `ev.kind`.
  // Fraseo sin género: los nombres del censo mezclan masculinos y femeninos.
  conflict: (ctx, ev) => {
    if (ev.kind === 'seizure') {
      return { log: 'Todas disparan juntas. La red se traba en su propio eco.', short: 'convulsión' }
    }
    if (ev.kind === 'postictal') {
      return { log: 'Se apaga todo. Nadie dispara. La red vuelve despacio.', short: 'silencio postictal' }
    }
    return { log: `${cap(ev.agent)} calla a sus vecinas; varios somas se apagan a la vez.`, short: `${ev.agent} inhibe` }
  },
  // Momentos de los estados cerebrales (F4/F6): husos, ondas UP/DOWN, la crisis.
  byKind: {
    spindle: () => ({ log: 'Un huso de sueño cruza la red y se deshace.', short: 'huso' }),
    down: () => ({ log: 'La red se calla entera. Medio segundo de nada.', short: 'estado DOWN' }),
    up: () => ({ log: 'Vuelve de golpe: todas retoman a la vez.', short: 'estado UP' }),
    kcomplex: () => ({ log: 'Un complejo K sacude la red y se disuelve.', short: 'complejo K' }),
  },
}

// ── MICELIO ──────────────────────────────────────────────────────────────────
// El terreno es la comida y la red es el organismo. Acciones por tipo (fauna del
// suelo, la red, las colonias, el sustrato) + por nombre para las estructuras que
// hacen algo distinto. Ver spec §12.
const FUNGUS_ACTIONS = {
  soil_fauna: [
    { l: 'hurga entre la hojarasca', s: 'hurga' },
    { l: 'pastorea el frente de avance', s: 'pastorea' },
    { l: 'se escurre por una grieta', s: 'se escurre' },
    { l: 'mordisquea una hifa y sigue', s: 'mordisquea' },
    { l: 'se queda quieto, husmeando', s: 'husmea' },
  ],
  mycelium: [
    { l: 'palpa la madera y avanza', s: 'avanza' },
    { l: 'se ramifica hacia el recurso', s: 'se ramifica' },
    { l: 'reconoce a otra hifa y se funde', s: 'se funde' },
    { l: 'engruesa hasta volverse cordón', s: 'engruesa' },
    { l: 'reabsorbe una rama estéril', s: 'poda' },
  ],
  colony: [
    { l: 'empuja su frente por la albura', s: 'coloniza' },
    { l: 'consolida el territorio ganado', s: 'consolida' },
    { l: 'invierte en cordones hacia el duramen', s: 'invierte' },
  ],
  substrate: [
    { l: 'cruje al ceder una fibra', s: 'cruje' },
    { l: 'suelta una placa de corteza', s: 'se descama' },
    { l: 'gotea agua acumulada', s: 'gotea' },
    { l: 'se ablanda un poco más', s: 'se pudre' },
  ],
  // ── por nombre: cada estructura hace lo suyo ──
  'el cordón': [
    { l: 'bombea alimento hacia el frente', s: 'bombea' },
    { l: 'se engrosa con el flujo', s: 'se engrosa' },
  ],
  'el escarabajo muerto': [
    { l: 'entrega su nitrógeno a la red', s: 'nutre' },
    { l: 'queda envuelto en hifas', s: 'se envuelve' },
  ],
  Armillaria: [
    { l: 'enciende sus rizomorfos en la oscuridad', s: 'brilla' },
    { l: 'tira un cordón negro bajo la corteza', s: 'extiende cordón' },
  ],
  'el tronco': [
    { l: 'cruje en lo hondo', s: 'cruje' },
    { l: 'cede una veta al duramen', s: 'se abre' },
  ],
}

const FUNGUS_AMBIENT = [
  { l: 'Una gota cae de la corteza empapada', s: 'gotea la corteza' },
  { l: 'La madera cruje al asentarse', s: 'cruje la madera' },
  { l: 'Un hilo de red palpa la oscuridad y sigue', s: 'palpa la red' },
  { l: 'Algo menudo se remueve en la hojarasca', s: 'se remueve la hojarasca' },
  { l: 'Un cordón late, tenue, bajo la corteza', s: 'late el cordón' },
  { l: 'El aire huele a tierra y a hongo', s: 'huele a hongo' },
]

export const FUNGUS_LEXICON = {
  actions: FUNGUS_ACTIONS,
  ambient: FUNGUS_AMBIENT,
  fallbackType: 'substrate',
  place: 'la madera',
  moment: (ctx) => ({
    log: `El tronco cruje mientras ${weatherES(ctx.weather)} se asienta sobre la madera.`,
    short: 'cruje el tronco',
  }),
  overview: (ctx) => ({
    log: `${cap(weatherES(ctx.weather))} se asienta sobre la madera mientras avanza ${phaseES(ctx.phase)}.`,
    short: 'panorama',
  }),
  // El "día" es el ciclo de humedad: la red crece de noche y con rocío.
  shift: (ctx) => ({
    log: `El aire cambia hacia ${phaseES(ctx.phase)}.`,
    short: `cambio · ${phaseES(ctx.phase)}`,
  }),
  // El conflicto va en dos sentidos: el hongo caza (trampa de nematodos) y la
  // fauna del suelo pastorea el micelio. La cara la decide `ev.kind`/tipo.
  conflict: (ctx, ev) => {
    if (ev.kind === 'trap' || ev.kind === 'phagocytosis') {
      // Fraseo sin "de {nombre}": los móviles del censo van sin artículo.
      return { log: `${cap(ev.agent)} roza el toxocisto y se paraliza; la hifa lo penetra.`, short: `trampa · ${ev.agent}` }
    }
    if (ev.kind === 'demarcation') {
      return { log: `${cap(ev.agent)} toca a su rival; se levanta la línea negra.`, short: `línea · ${ev.agent}` }
    }
    return { log: `${cap(ev.agent)} pastorea el frente; la red retrocede.`, short: `${ev.agent} pastorea` }
  },
  // Clímax: la fructificación. La emite el mundo con `kind` cuando corresponde.
  fruiting: (ctx, ev) => {
    const map = {
      primordia: { log: 'Asoman los primeros primordios en el flanco.', short: 'primordios' },
      deformed: { log: 'La fructificación sale deforme: astas sin sombrero.', short: 'fructificación deforme' },
      sporulating: { log: 'El sombrero se abre y suelta la bruma de esporas.', short: 'esporulación' },
      newlog: { log: 'Cae un tronco nuevo sobre la hojarasca.', short: 'tronco nuevo' },
    }
    return map[ev.kind] || map.primordia
  },
}

// Acciones por NOMBRE primero (si el léxico las trae), después por tipo.
function action(type, rand, lex, name) {
  const list = (name && lex.actions[name]) || lex.actions[type] || lex.actions[lex.fallbackType]
  return pick(list, rand)
}

/**
 * @param {{type,agent,agentType,dir}} ev
 * @param {{phase,weather}} ctx
 * @param {object} lex  léxico del mundo; por defecto, el del bosque
 * @returns {{log:string, short:string}}
 */
export function narrate(ev, ctx, rand = Math.random, lex = FOREST_LEXICON) {
  const name = ev.agent
  const t = ev.agentType || lex.fallbackType

  // Los acontecimientos grandes de un mundo (el ciclo celular, por ejemplo)
  // se narran por `kind`, ANTES que por tipo — necesitan frase propia, no la
  // plantilla genérica de 'moment'. Retro-compatible: sin `byKind` en el
  // léxico, no pasa nada y sigue el camino de siempre.
  if (ev.kind && lex.byKind && lex.byKind[ev.kind]) return lex.byKind[ev.kind](ctx, ev, rand)

  // Un léxico puede reemplazar la plantilla de cualquier tipo de evento.
  const override = lex[ev.type]
  if (typeof override === 'function') return override(ctx, ev, rand)

  const wx = weatherES(ctx.weather)

  switch (ev.type) {
    case 'sound': {
      if (!name) { const am = pick(lex.ambient, rand); return { log: am.l, short: am.s } }
      const a = action(t, rand, lex, name)
      const d = ev.dir && rand() < 0.5 ? ` ${DIR_PHRASE[ev.dir]}` : ''
      return { log: `${cap(name)} ${a.l}${d}.`, short: `${name} ${a.s}` }
    }
    case 'interaction': {
      const a = action(t, rand, lex, name)
      return { log: `${cap(name)} ${a.l} mientras ${wx} atraviesa ${lex.place}.`, short: `${name} ${a.s}` }
    }
    case 'residue': {
      const a = action(t, rand, lex, name)
      return { log: `${cap(name)} ${a.l} un momento más, y se apaga.`, short: `${name} se asienta` }
    }
    // `moment`, `overview`, `shift` y `conflict` los define cada léxico:
    // hablan del mundo entero, no hay plantilla genérica que valga para todos.
    case 'setup': {
      const a = action(t, rand, lex, name)
      return { log: `${cap(name)} ${a.l}, más cerca ahora.`, short: `${name} ${a.s}` }
    }
    case 'distant': {
      const a = action(t, rand, lex, name)
      return { log: `A lo lejos, ${name} ${a.l}.`, short: `${name} a lo lejos` }
    }
    default: {
      const a = action(t, rand, lex, name)
      return {
        log: `${cap(name || lex.place)} ${a.l}.`,
        short: name ? `${name} ${a.s}` : lex.place,
      }
    }
  }
}
