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
    radius: 62,          // radio de la isla
    groundY: 0,
    dustCount: 8500,     // polvo del borde
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
    grassBlades: 60000,  // hojas como líneas de 2 segmentos
    flowerPatches: 52,
    hazeCount: 4200,
    hazeColor: [0.12, 0.35, 1.0],  // azul frío (bosque); ciudad usaría naranja
    hazeAlpha: 0.15,
    // Cámara / lente
    fisheye: 0.6,        // fov = 50 + fisheye*72 = 93°
    chroma: 0.25,
    vigSize: 1.0,
    // Profundidad de campo falsa
    dofFocus: 95,
    dofAperture: 0.2,
    // Estelas
    trailLen: 34,
    trailSize: 3.4,
  },
}
