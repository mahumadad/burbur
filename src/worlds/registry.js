import { createScene } from '../render/scene.js'
import { createCityScene } from '../render/city.js'
import { createPond } from '../render/pond.js'
import { createCellScene } from './cell.js'
import { FOREST_CENSUS, CITY_CENSUS, POND_CENSUS, CELL_CENSUS } from '../sim/agents.js'
import { CELL_LEXICON } from '../sim/narrator.js'
import { FOREST_PROFILE, CELL_PROFILE } from '../sim/ecosystem.js'

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
]

export function worldById(id) {
  return WORLDS.find((w) => w.id === id) || WORLDS[0]
}
