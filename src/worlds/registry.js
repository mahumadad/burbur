import { createScene } from '../render/scene.js'
import { createStubWorld } from './stub.js'
import { createCellScene } from './cell.js'
import { FOREST_CENSUS, CELL_CENSUS } from '../sim/agents.js'
import { CELL_LEXICON } from '../sim/narrator.js'

// Registro de mundos. Cada mundo es un builder que construye su escena en el
// container y devuelve la API común { update, resize, flash, dispose }. El host
// (main.js) los intercambia con dispose + rebuild.
//
// Ids y colores de acento EXACTOS del bundle de murmur (tabla `hg`):
//   land #b6d184 · water #aacdff · city #fab75e
export const WORLDS = [
  {
    id: 'land', label: 'Plot ecosystem', accent: '#b6d184', ready: true,
    census: FOREST_CENSUS,
    build: (container, cfg, names) => createScene(container, cfg, names),
  },
  {
    id: 'water', label: 'Pond ecosystem', accent: '#aacdff', ready: false,
    census: FOREST_CENSUS,
    build: (container, cfg) => createStubWorld(container, cfg, { accent: '#aacdff', label: 'Pond' }),
  },
  {
    id: 'city', label: 'Block ecosystem', accent: '#fab75e', ready: false,
    census: FOREST_CENSUS,
    build: (container, cfg) => createStubWorld(container, cfg, { accent: '#fab75e', label: 'Block' }),
  },
  // Célula: mundo propio (no viene del bundle de murmur). El acento violeta es
  // diseño nuestro; no colisiona con land/water/city.
  {
    id: 'cell', label: 'Cell ecosystem', accent: '#c9a6ff', ready: true,
    census: CELL_CENSUS, lexicon: CELL_LEXICON,
    build: (container, cfg, names) => createCellScene(container, cfg, names),
  },
]

export function worldById(id) {
  return WORLDS.find((w) => w.id === id) || WORLDS[0]
}
