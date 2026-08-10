export const CONFIG = {
  fireflies: {
    count: 220,
    couplingK: 2.2,        // fuerza de sincronización
    neighborRadius: 3.5,   // radio de acoplamiento (unidades de mundo)
    omegaMean: 1.1,        // rad/s frecuencia natural media
    omegaSpread: 0.18,     // dispersión relativa de omega
    bounds: { x: 12, y: 7, z: 10 }, // semiejes del volumen
    driftSpeed: 1.1,
  },
  ambient: {
    windPeriodSec: 23,     // periodo del oscilador lento de viento
    cricketBaseRate: 6,    // eventos/seg base
    owlChancePerSec: 0.03, // prob. de hootear por segundo
  },
  audio: {
    masterLimitDb: -3,
    flashPolyphony: 8,
    droneRootHz: 55,       // A1
    volumes: { drone: -14, bed: -18, flash: -10 }, // dB
  },
  render: {
    fogDensity: 0.055,
    bloomStrength: 0.9,
    bloomRadius: 0.6,
    bloomThreshold: 0.15,
  },
}
