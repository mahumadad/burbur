// Tabla de especies: una entrada = un árbol (o una flora, en el caso de los
// nomeolvides). Cada especie trae su curva de fenología; las tareas siguientes
// agregan aquí la forma del esqueleto, la silueta de la hoja y los colores.
//
// Recordatorio: ninguna ventana puede cruzar `budStart` (ver phenology.js).

import { DEFAULT_CURVE } from '../../sim/phenology.js'

/** Curva base con los campos que la especie quiera cambiar. */
const curva = (over = {}) => ({ ...DEFAULT_CURVE, ...over })

export const SPECIES = {
  // Abedul: caducifolio clásico, sin floración llamativa, otoño amarillo fuerte.
  abedul: {
    curve: curva({
      flower: null,
      autumn: [0.48, 0.62, 0.76, 0.84],
      autumnShed: 40,
    }),
  },

  // Manzano: flor blanca-rosada corta y temprana, y después el fruto.
  manzano: {
    curve: curva({
      flower: [0.01, 0.07, 0.14, 0.22],
      fruit: [0.25, 0.38, 0.58, 0.68],
      autumn: [0.52, 0.70, 0.78, 0.86],
    }),
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
  },

  // Nomeolvides: flora de suelo, no es un árbol. Florece en primavera.
  nomeolvides: {
    curve: curva({
      flower: [0.00, 0.06, 0.18, 0.30],
      autumn: null,
      autumnShed: 0,
    }),
  },
}
