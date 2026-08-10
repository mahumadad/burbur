// Estado del mundo: hora, clima, temperatura, actividad y tensión.
// Puro: sin three/tone/DOM. Es el motor del que cuelgan luz, sonido y (luego) eventos.

export const TIME_PHASES = [
  'night', 'pre-dawn', 'dawn chorus', 'first light',
  'early morning', 'mid-morning', 'morning', 'midday',
  'early afternoon', 'afternoon', 'golden hour', 'dusk',
]

export const WEATHERS = ['dry still', 'light rain', 'frost', 'after rain', 'heavy rain']

// Perfil por fase: actividad base, temperatura (°C), color de luz y brillo.
const PHASE = [
  { act: 0.15, temp: -3, light: [0.34, 0.44, 0.78], gain: 0.52 }, // night
  { act: 0.25, temp: -2, light: [0.48, 0.44, 0.82], gain: 0.58 }, // pre-dawn
  { act: 0.88, temp: 0, light: [1.00, 0.70, 0.48], gain: 0.62 }, // dawn chorus
  { act: 0.76, temp: 2, light: [1.00, 0.84, 0.68], gain: 0.78 }, // first light
  { act: 0.70, temp: 5, light: [1.00, 0.94, 0.84], gain: 0.90 }, // early morning
  { act: 0.62, temp: 8, light: [1.00, 0.99, 0.94], gain: 1.00 }, // mid-morning
  { act: 0.56, temp: 10, light: [1.00, 1.00, 1.00], gain: 1.05 }, // morning
  { act: 0.50, temp: 13, light: [1.00, 1.00, 0.99], gain: 1.08 }, // midday
  { act: 0.46, temp: 14, light: [1.00, 0.99, 0.95], gain: 1.04 }, // early afternoon
  { act: 0.52, temp: 13, light: [1.00, 0.96, 0.88], gain: 0.96 }, // afternoon
  { act: 0.68, temp: 10, light: [1.00, 0.76, 0.46], gain: 0.80 }, // golden hour
  { act: 0.50, temp: 6, light: [0.72, 0.56, 0.72], gain: 0.62 }, // dusk
]

// Efecto del clima sobre actividad, tensión, temperatura, lluvia y niebla.
const WEATHER = {
  'dry still': { act: 1.00, tension: 0.05, temp: 0, rain: 0.00, fog: 0.10 },
  'light rain': { act: 0.85, tension: 0.20, temp: -1, rain: 0.35, fog: 0.35 },
  'frost': { act: 0.60, tension: 0.15, temp: -6, rain: 0.00, fog: 0.55 },
  'after rain': { act: 1.10, tension: 0.10, temp: 1, rain: 0.08, fog: 0.30 },
  'heavy rain': { act: 0.55, tension: 0.45, temp: -2, rain: 1.00, fog: 0.60 },
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a, b, t) => a + (b - a) * t

/**
 * @param {{dayLengthSec:number, weatherMinSec:number, weatherMaxSec:number}} cfg
 */
export function createEcosystem(cfg, rand = Math.random) {
  const phaseLen = cfg.dayLengthSec / TIME_PHASES.length
  // Arranca en 'dawn chorus': el mundo abre con luz cálida y actividad alta.
  const startPhase = cfg.startPhase ?? 2
  let t = startPhase * phaseLen
  let phaseIndex = startPhase
  let weather = WEATHERS[(rand() * WEATHERS.length) | 0]
  let weatherLeft = cfg.weatherMinSec + rand() * (cfg.weatherMaxSec - cfg.weatherMinSec)

  const state = {
    phase: TIME_PHASES[0],
    phaseIndex: 0,
    phaseT: 0,          // 0..1 dentro de la fase (para interpolar)
    weather,
    temperature: 0,
    activity: 0,
    tension: 0,
    rain: 0,            // 0..1 intensidad de lluvia
    fog: 0,             // 0..1 densidad de niebla
    light: [1, 1, 1],   // color de luz
    gain: 1,            // brillo
    changedTime: false,
    changedWeather: false,
  }

  function update(dt) {
    t += dt
    state.changedTime = false
    state.changedWeather = false

    // Avance de la hora
    const idx = Math.floor(t / phaseLen) % TIME_PHASES.length
    if (idx !== phaseIndex) {
      phaseIndex = idx
      state.changedTime = true
    }
    const phaseT = (t % phaseLen) / phaseLen

    // Cambio de clima
    weatherLeft -= dt
    if (weatherLeft <= 0) {
      const next = WEATHERS[(rand() * WEATHERS.length) | 0]
      if (next !== weather) {
        weather = next
        state.changedWeather = true
      }
      weatherLeft = cfg.weatherMinSec + rand() * (cfg.weatherMaxSec - cfg.weatherMinSec)
    }

    // Interpolación suave entre la fase actual y la siguiente
    const a = PHASE[phaseIndex]
    const b = PHASE[(phaseIndex + 1) % PHASE.length]
    const w = WEATHER[weather]

    state.phaseIndex = phaseIndex
    state.phase = TIME_PHASES[phaseIndex]
    state.phaseT = phaseT
    state.weather = weather
    state.temperature = Math.round(lerp(a.temp, b.temp, phaseT) + w.temp)
    state.activity = clamp01(lerp(a.act, b.act, phaseT) * w.act)
    state.tension = clamp01(w.tension + (1 - state.activity) * 0.25)
    state.rain = w.rain
    state.fog = w.fog
    state.gain = lerp(a.gain, b.gain, phaseT)
    for (let i = 0; i < 3; i++) {
      state.light[i] = lerp(a.light[i], b.light[i], phaseT)
    }
    return state
  }

  return { update, state }
}
