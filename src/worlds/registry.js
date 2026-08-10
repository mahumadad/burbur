import { createScene } from '../render/scene.js'
import { createCityScene } from '../render/city.js'
import { createStubWorld } from './stub.js'
import { FOREST_CENSUS, CITY_CENSUS } from '../sim/agents.js'

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
    id: 'city', label: 'Block ecosystem', accent: '#fab75e', ready: true,
    census: CITY_CENSUS,
    build: (container, cfg, names) => createCityScene(container, cfg, names),
  },
]

export function worldById(id) {
  return WORLDS.find((w) => w.id === id) || WORLDS[0]
}
