import { createScene } from '../render/scene.js'
import { createCityScene } from '../render/city.js'
import { createPond } from '../render/pond.js'
import { createCellScene } from './cell.js'
import { createFungusScene } from './fungus.js'
import { createNeuronScene } from './neuron.js'
import { createTidepool } from '../render/tidepool.js'
import { FOREST_CENSUS, CITY_CENSUS, POND_CENSUS, CELL_CENSUS, FUNGUS_CENSUS, NEURON_CENSUS, TIDEPOOL_CENSUS } from '../sim/agents.js'
import { CELL_LEXICON, FUNGUS_LEXICON, NEURON_LEXICON, TIDEPOOL_LEXICON } from '../sim/narrator.js'
import { FOREST_PROFILE, CELL_PROFILE, FUNGUS_PROFILE, NEURON_PROFILE, TIDEPOOL_PROFILE } from '../sim/ecosystem.js'

// Registro de mundos. Cada mundo es un builder que construye su escena en el
// container y devuelve la API común { update, resize, flash, dispose }. El host
// (main.js) los intercambia con dispose + rebuild.
//
// Ids y colores de acento EXACTOS del bundle de murmur (tabla `hg`):
//   land #b6d184 · water #aacdff · city #fab75e

// La ciudad NO tiene un subconjunto de agentes que vuele de verdad: todos se
// mueven a la altura de tráfico o dentro de su manzana (ver `moveAgents` en
// `render/city.js`), a diferencia de los perchers/sky del bosque o las garzas
// del estanque. Para que las aves del censo (paloma, tórtola, etc.) igual se
// repartan entre los agentes visibles en la MISMA proporción que tienen en
// CITY_CENSUS —y no terminen nombrando un auto "paloma"— se marca aérea una
// FRACCIÓN fija de los slots (los primeros `count*ratio`), de tamaño igual a
// la proporción de `flying_animal` sobre el total de móviles del censo.
const CITY_MOVERS = CITY_CENSUS.filter((a) => a.type !== 'static_object')
const CITY_FLIER_RATIO = CITY_MOVERS.length
  ? CITY_MOVERS.filter((a) => a.type === 'flying_animal').length / CITY_MOVERS.length
  : 0

export const WORLDS = [
  {
    id: 'land', label: 'Plot ecosystem', name: 'Bosque', accent: '#b6d184', ready: true,
    census: FOREST_CENSUS, ecosystem: FOREST_PROFILE,
    // Capas de ambiente que suenan en ESTE mundo (el drone + los eventos van
    // siempre; esto solo gatea los sonidos de exterior). El bosque: todo.
    audio: { rain: true, insects: true, owl: true },
    // Índices que la escena manda al aire (perchers + sky). SOLO pueden ser aves.
    // Los cazadores (0..hunters) NO: acechan a ras de suelo. Coincide con
    // createPerchers, cuyo startIndex es el nº de cazadores.
    aerial: (i, cfg) => {
      const start = Math.min(cfg.bugs.hunters, cfg.fireflies.count)
      return i >= start && i < start + cfg.behaviors.perchers + cfg.behaviors.sky
    },
    build: (container, cfg, names) => createScene(container, cfg, names),
  },
  {
    id: 'water', label: 'Pond ecosystem', name: 'Laguna', accent: '#aacdff', ready: true,
    census: POND_CENSUS, ecosystem: FOREST_PROFILE,
    // Laguna: lluvia sobre el agua e insectos, pero sin el búho del bosque.
    audio: { rain: true, insects: true, owl: false },
    // En el pond casi todo VUELA/planea sobre el agua, y las garzas (slots 0-1,
    // los cazadores de pond.js) PICAN desde arriba → deben ser aves. Solo 2 slots
    // (2 y 3) quedan para fauna de ribera (coipo/huillín/rana/culebra).
    aerial: (i) => i !== 2 && i !== 3,
    build: (container, cfg, names) => createPond(container, cfg, names),
  },
  {
    id: 'city', label: 'Block ecosystem', name: 'Ciudad', accent: '#fab75e', ready: true,
    census: CITY_CENSUS, ecosystem: FOREST_PROFILE,
    // Ciudad: cae lluvia, pero nada de grillos ni búhos.
    audio: { rain: true, insects: false, owl: false },
    // Sin percha real (ver CITY_FLIER_RATIO arriba): los primeros slots, en la
    // proporción de aves del censo, reciben nombres de `flying_animal`.
    aerial: (i, cfg) => i < Math.round(cfg.fireflies.count * CITY_FLIER_RATIO),
    build: (container, cfg, names) => createCityScene(container, cfg, names),
  },
  // Célula: mundo propio (no viene del bundle de murmur). El acento violeta es
  // diseño nuestro; no colisiona con land/water/city.
  {
    id: 'cell', label: 'Cell ecosystem', name: 'Célula', accent: '#c9a6ff', ready: true,
    census: CELL_CENSUS, lexicon: CELL_LEXICON, ecosystem: CELL_PROFILE,
    // La célula no tiene estación: su "hora" es el ciclo celular y su "clima" el
    // medio. La temperatura sí importa (≈37°C, sube en mitosis).
    hud: { time: 'CICLO', weather: 'MEDIO', season: null },
    // Interior húmedo: sin lluvia, grillos ni búhos. Solo el drone y la vida
    // celular (bloops de los organelos + la onda de calcio del propio mundo).
    audio: { rain: false, insects: false, owl: false },
    build: (container, cfg, names) => createCellScene(container, cfg, names),
  },
  // Micelio: la red que crece y se come su propio tronco. El acento
  // verde-musgo es diseño nuestro (no colisiona con los otros cuatro).
  {
    id: 'fungus', label: 'Log ecosystem', name: 'Micelio', accent: '#9cc47a', ready: true,
    census: FUNGUS_CENSUS, lexicon: FUNGUS_LEXICON, ecosystem: FUNGUS_PROFILE,
    // El "día" es el ciclo de humedad; el "clima", la humedad; la "estación", la
    // clase de descomposición del tronco (la maneja el mundo, no el reloj).
    hud: { time: 'HORA', weather: 'HUMEDAD', season: 'DESCOMP.' },
    // Suelo del bosque, húmedo: llueve y hay bichos, pero sin búho.
    audio: { rain: true, insects: true, owl: false },
    build: (container, cfg, names) => createFungusScene(container, cfg, names),
  },
  // Neurona: una microred cortical vista desde arriba. Los somas están fijos;
  // lo que se mueve es la señal. El corazón es el swarm (osciladores tipo
  // integrate-and-fire). El acento rosa es diseño nuestro. Ver spec §9.1.
  {
    id: 'neuron', label: 'Network ecosystem', name: 'Neurona', accent: '#f2a0c8', ready: true,
    census: NEURON_CENSUS, lexicon: NEURON_LEXICON, ecosystem: NEURON_PROFILE,
    // El "día" es el ciclo de sueño; el "clima", los neuromoduladores. Sin
    // estación. (La fila de métrica pasará a mostrar Hz en F4.)
    hud: { time: 'ESTADO', weather: 'NEUROMODULADOR', season: null },
    // Interior seco y eléctrico: sin lluvia, grillos ni búhos.
    audio: { rain: false, insects: false, owl: false },
    // La clase de cada slot del swarm: 0–9 neuronas piramidales, 10–11
    // interneuronas, 12–17 astrocitos. Así el censo no le pone nombre de
    // piramidal a una interneurona (§9.4b).
    slotClass: (i) => (i < 10 ? 'neuron' : i < 12 ? 'interneuron' : 'glia'),
    build: (container, cfg, names) => createNeuronScene(container, cfg, names),
  },
  // Poza de marea: la costa rocosa chilena vista DESDE ABAJO DEL AGUA. Es la
  // primera cámara volteada del proyecto (las otras seis miran desde arriba).
  // El acento aqua-verde es diseño nuestro. Ver spec del mundo.
  {
    id: 'tidepool', label: 'Tidepool ecosystem', name: 'Poza', accent: '#5bd6c4', ready: true,
    census: TIDEPOOL_CENSUS, lexicon: TIDEPOOL_LEXICON, ecosystem: TIDEPOOL_PROFILE,
    // El "día" es la marea (dos vueltas por día solar); el "clima", el oleaje;
    // la "estación", la surgencia de Humboldt.
    hud: { time: 'MAREA', weather: 'OLEAJE', season: 'SURGENCIA' },
    // Bajo el agua no llueve ni cantan grillos: el clima es oleaje (`surf`).
    audio: { rain: false, insects: false, owl: false, surf: true },
    // La clase de cada slot: 0–1 cazadores lentos, 2–13 el cardumen, 14–17 el
    // bentos que camina. Así el censo no le pone "estrella de sol" a un pez.
    slotClass: (i) => (i < 2 ? 'predator' : i < 14 ? 'fish' : 'benthos'),
    build: (container, cfg, names) => createTidepool(container, cfg, names),
  },
]

export function worldById(id) {
  return WORLDS.find((w) => w.id === id) || WORLDS[0]
}
