import { createScene } from '../render/scene.js'
import { createPond } from '../render/pond.js'
import { createStubWorld } from './stub.js'
import { createCellScene } from './cell.js'
import { FOREST_CENSUS, POND_CENSUS, CELL_CENSUS } from '../sim/agents.js'
import { CELL_LEXICON } from '../sim/narrator.js'
import { FOREST_PROFILE, CELL_PROFILE } from '../sim/ecosystem.js'

// Registro de mundos. Cada mundo es un builder que construye su escena en el
// container y devuelve la API común { update, resize, flash, dispose }. El host
// (main.js) los intercambia con dispose + rebuild.
//
// Ids y colores de acento EXACTOS del bundle de murmur (tabla `hg`):
//   land #b6d184 · water #aacdff · city #fab75e
export const WORLDS = [
  {
    id: 'land', label: 'Plot ecosystem', accent: '#b6d184', ready: true,
    census: FOREST_CENSUS, ecosystem: FOREST_PROFILE,
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
    id: 'water', label: 'Pond ecosystem', accent: '#aacdff', ready: true,
    census: POND_CENSUS, ecosystem: FOREST_PROFILE,
    build: (container, cfg, names) => createPond(container, cfg, names),
  },
  {
    id: 'city', label: 'Block ecosystem', accent: '#fab75e', ready: false,
    census: FOREST_CENSUS, ecosystem: FOREST_PROFILE,
    build: (container, cfg) => createStubWorld(container, cfg, { accent: '#fab75e', label: 'Block' }),
  },
  // Célula: mundo propio (no viene del bundle de murmur). El acento violeta es
  // diseño nuestro; no colisiona con land/water/city.
  {
    id: 'cell', label: 'Cell ecosystem', accent: '#c9a6ff', ready: true,
    census: CELL_CENSUS, lexicon: CELL_LEXICON, ecosystem: CELL_PROFILE,
    build: (container, cfg, names) => createCellScene(container, cfg, names),
  },
]

export function worldById(id) {
  return WORLDS.find((w) => w.id === id) || WORLDS[0]
}
