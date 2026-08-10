// Paleta exacta observada en murmur (ningún verde: los agentes siempre contrastan con el pasto).
export const PALETTE = {
  white: 0xeef2ff,
  cyan: 0x10e6cf,
  pink: 0xff5fb0,
  magenta: 0xff1f8f,
  cyanEye: 0x16f0d8,
  orange: 0xff7a14,
  cyanSat: 0x35e6d2,
  yellow: 0xffe21a,
  blue: 0x2b48ff,
  bond: 0xffb15a,
}

export const CONFIG = {
  world: {
    radius: 85,          // radio de la isla (el del original)
    groundY: 0,
    dustCount: 3200,     // polvo del borde
  },
  // Deambular libre: estados move/rest + separación mutua.
  wander: {
    density: 0.66,
    wanderTurn: 2.2,     // deriva del ángulo (rad/s)
    wanderPush: 0.055,   // empuje continuo
    kickMin: 0.085,      // impulso al pasar a 'move'
    kickRange: 0.085,
    separation: 0.16,
    sepRadius: 0.10,
    drag: 0.965,
    maxSpeed: 0.075,
    softR: 0.30,         // desde aquí empieza la fuerza hacia el centro
    centerPull: 2.2,     // fuerza de la cuenca
    bound: 0.82,         // tope duro
    // Campo de flujo: corrientes coherentes que varían lento.
    flowFreq: 5.1,
    flowPush: 0.030,
    // Atracción a caminos. 0 = ignorarlos; alto = encauzar (calles de ciudad).
    pathPull: 0.055,     // bosque: los caminos son sendas preferidas, no rieles
    pathRadius: 0.14,
  },
  fireflies: {
    count: 18,           // agentes visibles (murmur usa 15)
    couplingK: 2.2,
    neighborRadius: 3.5,
    omegaMean: 1.1,
    omegaSpread: 0.18,
    bounds: { x: 12, y: 7, z: 10 },
    driftSpeed: 0.4,
  },
  paths: {
    loopCount: 3,
    minRadius: 0.34,
    maxRadius: 0.72,
    samples: 46,
  },
  events: {
    baseRate: 0.62,      // eventos/seg base (bosque ≈ 37/min a plena actividad)
    ambientProb: 0.35,   // fracción de sonidos sin agente (texturas)
  },
  // Bichitos voladores que van de flor en flor; algunos agentes los cazan.
  bugs: {
    count: 90,
    speed: 0.10,         // velocidad de vuelo (coords normalizadas/seg)
    arrive: 0.02,        // distancia para posarse en la flor
    hoverMin: 0.6, hoverMax: 2.2,  // segundos posado
    jitter: 0.45,        // zigzag del vuelo
    height: 3.4,         // altura de vuelo sobre el suelo
    bob: 0.9,            // cabeceo vertical
    fleeRadius: 0.06,    // huyen si un cazador entra aquí
    hunters: 3,          // agentes que cazan
    huntRadius: 0.22,    // radio de detección del cazador
    huntPull: 0.12,      // fuerza con que persigue
    catchRadius: 0.02,   // distancia para atrapar
    respawn: 2.5,        // segundos hasta reaparecer
  },
  ecosystem: {
    dayLengthSec: 540,   // día completo en 9 min → 45 s por fase
    weatherMinSec: 55,
    weatherMaxSec: 130,
  },
  ambient: {
    windPeriodSec: 23,
    cricketBaseRate: 6,
    owlChancePerSec: 0.03,
  },
  audio: {
    masterLimitDb: -3,
    flashPolyphony: 8,
    droneRootHz: 55,
    volumes: { drone: -14, bed: -18, flash: -10 },
  },
  render: {
    grassBlades: 112000,  // hojas como líneas de 2 segmentos
    flowerPatches: 88,
    hazeCount: 5200,
    hazeColor: [0.12, 0.35, 1.0],  // azul frío (bosque); ciudad usaría naranja
    hazeAlpha: 0.15,
    // Cámara / lente
    fisheye: 0.6,        // fov = 50 + fisheye*72 = 93°
    chroma: 0.25,
    vigSize: 1.0,
    squareFrame: false,  // true = recuadro cuadrado (modo device 466x466)
    tintStrength: 0.3,   // cuánto vira el color con la hora (el brillo va aparte)
    // Profundidad de campo falsa
    dofFocus: 95,
    dofAperture: 0.2,
    // Estelas
    trailLen: 34,
    trailSize: 3.4,
    agentLineWidth: 0.9,  // grosor de las jaulas (px de dispositivo)
  },
}
