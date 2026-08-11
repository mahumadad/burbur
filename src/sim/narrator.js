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
  // Ciclo de vida del árbol (Task 4): lo emite el mundo con `kind` cuando
  // un árbol lush cae. No hay agente involucrado.
  treeLife: (ctx, ev) => {
    const map = {
      fall: { log: 'Un árbol se vino abajo.', short: 'árbol caído' },
    }
    return map[ev.kind] || map.fall
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
