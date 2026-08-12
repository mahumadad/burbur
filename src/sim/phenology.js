// Fenología: traduce el reloj de estación y el clima en densidades de follaje y
// en tasas de desprendimiento. Puro: sin three, sin DOM. Es la ÚNICA fuente de
// verdad estacional — el bosque y la ciudad leen de aquí para no volver a
// divergir como pasó con el sistema duplicado del sakura.
//
// Todas las ventanas se expresan en `seasonT` (0..1). Internamente el año se
// ROTA para que arranque en `budStart`, así todas las curvas quedan monótonas y
// no hay casos borde de envolvimiento. Por eso ninguna ventana puede cruzar
// `budStart` (hay un test que lo verifica).

/** Smoothstep recortado a 0..1. */
export const ss01 = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Pulso: sube entre `a` y `b`, se mantiene, y baja entre `c` y `d`. */
export const pulse = (a, b, c, d, x) => ss01(a, b, x) * (1 - ss01(c, d, x))

const wrap01 = (v) => ((v % 1) + 1) % 1

// Curva por defecto: árbol caducifolio del bosque. Cada especie sobrescribe lo
// que necesite en species.js.
export const DEFAULT_CURVE = {
  budStart: 0.88,      // arranque del brote, en invierno tardío
  // 0.42, no 0.18: con 0.18 el árbol ya no estaba "pelado" en pleno invierno
  // (seasonT = 0.92) y el test de fenología lo rechazaba.
  budDur: 0.42,        // cuánto tarda el brote en completarse
  leafFade: [0.62, 0.80],              // la hoja se va entre estos dos
  flower: [0.02, 0.10, 0.20, 0.32],    // sube a→b, baja c→d
  fruit: null,                         // null si la especie no fructifica
  autumn: [0.50, 0.70, 0.78, 0.86],    // viraje de color (cierra ANTES de budStart)
  autumnShed: 34,      // hojas/s en el pico del otoño
  gustShed: 46,        // hojas/s por unidad de racha (siempre < autumnShed en efecto)
  baseDrop: 16,        // pétalos/s con la floración plena y sin clima
  // Caída extra por clima BAJADA a pedido (antes 40/34): con lluvia/viento caen
  // más pétalos, pero suave — la flor no se desnuda de golpe.
  dropRain: 18,
  dropWind: 16,
}

/**
 * @param {{seasonT:number, rain:number, wind:number}} env
 * @param {object} curve  una entrada de DEFAULT_CURVE (o de SPECIES[x].curve)
 * @returns {{bud:number, leaf:number, flower:number, fruit:number,
 *            autumn:number, meadow:number, shed:number, petals:number}}
 */
export function phenology(env, curve = DEFAULT_CURVE) {
  const c = curve
  const rain = env.rain || 0
  const wind = env.wind || 0

  // Año rotado: y = 0 es el arranque del brote.
  const y = wrap01(env.seasonT - c.budStart)
  /** Evalúa una frontera expresada en seasonT dentro del año rotado. */
  const at = (b) => wrap01(b - c.budStart)

  const bud = ss01(0, c.budDur, y)
  const fade = ss01(at(c.leafFade[0]), at(c.leafFade[1]), y)
  const leaf = bud * (1 - fade)

  const flower = c.flower
    ? pulse(at(c.flower[0]), at(c.flower[1]), at(c.flower[2]), at(c.flower[3]), y)
    : 0
  const fruit = c.fruit
    ? pulse(at(c.fruit[0]), at(c.fruit[1]), at(c.fruit[2]), at(c.fruit[3]), y)
    : 0
  const autumn = c.autumn
    ? pulse(at(c.autumn[0]), at(c.autumn[1]), at(c.autumn[2]), at(c.autumn[3]), y)
    : 0

  // Racha: la lluvia y el viento sacuden la copa por igual.
  const gust = rain + wind * 0.7
  // El término de otoño no depende de la lluvia: en otoño cae igual, llueva o no.
  // El término de racha (0.05) es un ACENTO leve, no el evento: con lluvia/viento
  // caen SOLO algunas hojas, sin desvestir el árbol. La caída de verdad es el
  // otoño. (Se bajó 0.35→0.10→0.05 a pedido: verde estable, lluvia apenas roza.)
  const shed = leaf * (c.autumnShed * autumn + c.gustShed * gust * 0.05)
  const petals = flower * (c.baseDrop + rain * c.dropRain + wind * c.dropWind)

  // El prado: la lluvia FUERTE cierra las flores; la llovizna casi no las toca.
  const meadow = 1 - ss01(0.5, 1.0, rain)

  // Lo que se VE no es lo que HAY: con lluvia la copa se ralea un poco y las
  // flores se cierran algo, pero SIN borrarse — antes (0.3 hoja / 0.7 flor) la
  // lluvia dejaba el árbol casi pelado y la flor invisible mientras igual caían
  // pétalos, así que "nunca se veían las flores puestas". Ahora la lluvia atenúa
  // suave (la flor sigue algo más frágil que la hoja) y la copa se mantiene.
  // Importante: `shed` usa `leaf` SIN atenuar, porque si no la lluvia reduciría
  // la caída en vez de aumentarla.
  const leafShown = leaf * (1 - rain * 0.15)
  const flowerShown = flower * (1 - rain * 0.35)

  return { bud, leaf, flower, fruit, autumn, meadow, shed, petals, leafShown, flowerShown }
}
