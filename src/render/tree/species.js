// Tabla de especies: una entrada = un árbol (o una flora, en el caso de los
// nomeolvides). Cada especie trae su curva de fenología; las tareas siguientes
// agregan aquí la forma del esqueleto, la silueta de la hoja y los colores.
//
// Recordatorio: ninguna ventana puede cruzar `budStart` (ver phenology.js).

import { DEFAULT_CURVE } from '../../sim/phenology.js'

/** Curva base con los campos que la especie quiera cambiar. */
const curva = (over = {}) => ({ ...DEFAULT_CURVE, ...over })

// Paleta de hoja/otoño reutilizada de scene.js y city.js (antes de esta tarea
// cada mundo la tenía copiada). Se conserva tal cual para no cambiar el look
// ya validado: la meta de esta tarea es la densidad del follaje, no el color.
const LEAF_LO = [0.09, 0.20, 0.05], LEAF_HI = [0.30, 0.52, 0.13]
const AUTUMN_LO = [0.85, 0.20, 0.06], AUTUMN_HI = [0.90, 0.66, 0.10]

export const SPECIES = {
  // Abedul: caducifolio clásico, sin floración llamativa, otoño amarillo fuerte.
  abedul: {
    curve: curva({
      flower: null,
      autumn: [0.48, 0.62, 0.76, 0.84],
      autumnShed: 40,
    }),
    shape: { leaf: { width: 0.62, tip: 1.1, lobes: 11, lobeDepth: 0.09 } },
    colors: {
      leaf: [[0.24, 0.44, 0.16], [0.34, 0.56, 0.20]],
      autumn: [[0.92, 0.74, 0.16], [0.86, 0.58, 0.10]],
      flower: null,
      fruit: null,
      bark: 0x2a2a24,   // el abedul tiene el tronco CLARO
      edge: 0xe8e8d4,
    },
    form: { len: 11, radius: 0.8, depth: 5, gnarl: 0.25, droop: 0.35, kids: [2, 3] },
    clusters: 400,
  },

  // Manzano: flor blanca-rosada corta y temprana, y después el fruto.
  manzano: {
    curve: curva({
      flower: [0.01, 0.07, 0.14, 0.22],
      fruit: [0.25, 0.38, 0.58, 0.68],
      autumn: [0.52, 0.70, 0.78, 0.86],
    }),
    shape: { leaf: { width: 0.72, tip: 1.0, lobes: 9, lobeDepth: 0.07 }, petals: 5 },
    colors: {
      leaf: [LEAF_LO, LEAF_HI],
      autumn: [AUTUMN_LO, AUTUMN_HI],
      flower: [[1, 0.94, 0.92], [1, 0.82, 0.86]],
      fruit: [[0.78, 0.12, 0.10], [0.88, 0.30, 0.12]],
      bark: 0x1a120c,
      edge: 0xd9d9ba,
    },
    form: { len: 7, radius: 0.95, depth: 4, gnarl: 0.75, droop: 0.1, kids: [2, 4] },
    clusters: 420,
  },

  // Sakura: pocas hojas, floración rosada larga (la "primavera extendida" que
  // ya tenía la ciudad), y mucha lluvia de pétalos.
  //
  // Nota: la ventana empieza en 0.90 (no 0.86) porque budStart = 0.88 — si
  // arrancara antes de budStart, al rotar el año quedaría fuera de orden y
  // violaría el invariante de las ventanas (ver phenology.js).
  sakura: {
    curve: curva({
      flower: [0.90, 0.02, 0.24, 0.40],
      baseDrop: 34,
      dropRain: 55,
      dropWind: 46,
    }),
    shape: { leaf: { width: 0.5, tip: 1.4, lobes: 13, lobeDepth: 0.10 }, petals: 5 },
    colors: {
      leaf: [[0.09, 0.20, 0.05], [0.30, 0.52, 0.13]],
      autumn: [[0.85, 0.20, 0.06], [0.78, 0.33, 0.10]],
      flower: [[1, 0.72, 0.82], [1, 0.86, 0.92]],
      fruit: null,
      bark: 0x130d09,
      edge: 0xd9d9ba,
    },
    form: { len: 8, radius: 0.85, depth: 5, gnarl: 0.45, droop: 0.25, kids: [2, 3] },
    clusters: 500,
  },

  // Cactus: sin hoja y sin otoño. Solo florece en las puntas, en primavera.
  cactus: {
    curve: curva({
      budDur: 0.02,
      leafFade: [0.99, 1.0],
      flower: [0.02, 0.10, 0.18, 0.28],
      autumn: null,
      autumnShed: 0,
      gustShed: 0,
    }),
    shape: { leaf: { width: 0.3, tip: 2.5, lobes: 0, lobeDepth: 0 }, petals: 8 },
    colors: {
      leaf: null,
      autumn: null,
      flower: [[1, 0.42, 0.30], [1, 0.66, 0.24]],
      fruit: null,
      bark: 0x1b2a18,
      edge: 0x9fc48a,
    },
    // ribs: costillas de la corteza (Task 6). depth bajo → 1-2 brazos, casi vertical.
    form: { len: 6, radius: 0.9, depth: 2, gnarl: 0.05, droop: -0.6, kids: [1, 2], ribs: 9 },
    // Sin follaje: `clusters: 0` no pasa por buildFoliage. Las flores son la
    // excepción — `flowerOnly` le pide a foliage.js un racimo SOLO de flor,
    // colocado únicamente en las puntas de orden máximo (Task 6).
    clusters: 0,
    flowerOnly: true,
  },

  // Nomeolvides: flora de suelo, no es un árbol. Florece en primavera.
  nomeolvides: {
    curve: curva({
      flower: [0.00, 0.06, 0.18, 0.30],
      autumn: null,
      autumnShed: 0,
    }),
    shape: { leaf: { width: 0.8, tip: 0.8, lobes: 5, lobeDepth: 0.05 }, petals: 5 },
    colors: {
      leaf: null,
      autumn: null,
      flower: [[0.42, 0.62, 0.95], [0.60, 0.76, 1.0]],
      fruit: null,
      bark: null,
      edge: null,
    },
    clusters: 0,
  },
}
