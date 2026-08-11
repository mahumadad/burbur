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
  { act: 0.15, temp: -3, light: [0.34, 0.44, 0.78], gain: 0.72 }, // night
  { act: 0.25, temp: -2, light: [0.48, 0.44, 0.82], gain: 0.80 }, // pre-dawn
  { act: 0.88, temp: 0, light: [1.00, 0.70, 0.48], gain: 0.86 }, // dawn chorus
  { act: 0.76, temp: 2, light: [1.00, 0.84, 0.68], gain: 1.08 }, // first light
  { act: 0.70, temp: 5, light: [1.00, 0.94, 0.84], gain: 1.24 }, // early morning
  { act: 0.62, temp: 8, light: [1.00, 0.99, 0.94], gain: 1.35 }, // mid-morning
  { act: 0.56, temp: 10, light: [1.00, 1.00, 1.00], gain: 1.35 }, // morning
  { act: 0.50, temp: 13, light: [1.00, 1.00, 0.99], gain: 1.35 }, // midday
  { act: 0.46, temp: 14, light: [1.00, 0.99, 0.95], gain: 1.35 }, // early afternoon
  { act: 0.52, temp: 13, light: [1.00, 0.96, 0.88], gain: 1.32 }, // afternoon
  { act: 0.68, temp: 10, light: [1.00, 0.76, 0.46], gain: 1.10 }, // golden hour
  { act: 0.50, temp: 6, light: [0.72, 0.56, 0.72], gain: 0.86 }, // dusk
]

// Efecto del clima sobre actividad, tensión, temperatura, lluvia y niebla.
const WEATHER = {
  'dry still': { act: 1.00, tension: 0.05, temp: 0, rain: 0.00, fog: 0.10 },
  'light rain': { act: 0.85, tension: 0.20, temp: -1, rain: 0.35, fog: 0.35 },
  'frost': { act: 0.60, tension: 0.15, temp: -6, rain: 0.00, fog: 0.55 },
  'after rain': { act: 1.10, tension: 0.10, temp: 1, rain: 0.08, fog: 0.30 },
  'heavy rain': { act: 0.55, tension: 0.45, temp: -2, rain: 1.00, fog: 0.60 },
}

// ─── PERFILES POR MUNDO ─────────────────────────────────────────────────────
// Un perfil trae las fases del "día" y los estados del "clima". El bosque es el
// que se usa si nadie pide otro; la célula cambia el día por el ciclo celular y
// el clima por el medio en el que vive.

export const FOREST_PROFILE = {
  phases: TIME_PHASES, phaseData: PHASE,
  weathers: WEATHERS, weatherData: WEATHER,
}

// El "día" de la célula es una vuelta completa del ciclo. El clímax es la
// mitosis: la tensión sube hasta metafase, y anafase es el pico de actividad.
// Durante la fase M la célula se redondea y deja de reptar (§5.1 del diseño).
export const CELL_PHASES = [
  'G1 early', 'G1', 'G1/S checkpoint', 'S phase',
  'S late', 'G2', 'G2/M checkpoint', 'prophase',
  'metaphase', 'anaphase', 'telophase', 'cytokinesis',
]

const CELL_PHASE = [
  { act: 0.55, temp: 37, light: [0.62, 0.72, 1.00], gain: 0.92 }, // G1 early
  { act: 0.68, temp: 37, light: [0.70, 0.78, 1.00], gain: 1.00 }, // G1
  { act: 0.80, temp: 37, light: [0.82, 0.84, 1.00], gain: 1.10 }, // G1/S checkpoint
  { act: 0.86, temp: 37, light: [0.90, 0.88, 1.00], gain: 1.22 }, // S phase
  { act: 0.84, temp: 37, light: [0.94, 0.90, 1.00], gain: 1.24 }, // S late
  { act: 0.66, temp: 37, light: [0.90, 0.86, 0.98], gain: 1.14 }, // G2
  { act: 0.42, temp: 37, light: [0.96, 0.82, 0.86], gain: 1.02 }, // G2/M checkpoint
  { act: 0.30, temp: 37, light: [1.00, 0.78, 0.72], gain: 0.94 }, // prophase
  { act: 0.22, temp: 38, light: [1.00, 0.70, 0.60], gain: 0.88 }, // metaphase
  { act: 0.95, temp: 38, light: [1.00, 0.86, 0.62], gain: 1.34 }, // anaphase
  { act: 0.78, temp: 37, light: [1.00, 0.92, 0.80], gain: 1.20 }, // telophase
  { act: 0.70, temp: 37, light: [0.86, 0.88, 0.98], gain: 1.06 }, // cytokinesis
]

export const CELL_MEDIA = [
  'nutrient rich', 'serum starved', 'hypoxic',
  'oxidative stress', 'inflamed', 'acidic',
]

const CELL_MEDIUM = {
  'nutrient rich': { act: 1.00, tension: 0.05, temp: 0, rain: 0.05, fog: 0.10 },
  'serum starved': { act: 0.70, tension: 0.25, temp: 0, rain: 0.02, fog: 0.28 },
  'hypoxic': { act: 0.55, tension: 0.35, temp: -1, rain: 0.00, fog: 0.45 },
  'oxidative stress': { act: 0.60, tension: 0.55, temp: 1, rain: 0.55, fog: 0.35 },
  'inflamed': { act: 1.15, tension: 0.45, temp: 2, rain: 0.30, fog: 0.20 },
  'acidic': { act: 0.65, tension: 0.40, temp: 0, rain: 0.10, fog: 0.40 },
}

export const CELL_PROFILE = {
  phases: CELL_PHASES, phaseData: CELL_PHASE,
  weathers: CELL_MEDIA, weatherData: CELL_MEDIUM,
}

/** Fases en las que la célula está en mitosis: se redondea y deja de migrar. */
export const MITOTIC_PHASES = new Set(['prophase', 'metaphase', 'anaphase', 'telophase'])

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a, b, t) => a + (b - a) * t

/**
 * @param {{dayLengthSec:number, weatherMinSec:number, weatherMaxSec:number}} cfg
 */
export function createEcosystem(cfg, rand = Math.random) {
  let profile = FOREST_PROFILE
  let phaseLen = cfg.dayLengthSec / profile.phases.length
  // Arranca en 'dawn chorus': el mundo abre con luz cálida y actividad alta.
  const startPhase = cfg.startPhase ?? 2
  let t = startPhase * phaseLen
  let phaseIndex = startPhase
  let weather = profile.weathers[(rand() * profile.weathers.length) | 0]
  let weatherLeft = cfg.weatherMinSec + rand() * (cfg.weatherMaxSec - cfg.weatherMinSec)

  /**
   * Cambia el vocabulario del mundo (fases y climas) SIN reiniciar el reloj: al
   * saltar de mundo el tiempo sigue corriendo donde estaba.
   */
  function setProfile(next) {
    if (!next || next === profile) return
    profile = next
    phaseLen = cfg.dayLengthSec / profile.phases.length
    // El clima del perfil viejo no existe en la tabla nueva: sin esto, todo lo
    // que se deriva de él saldría NaN.
    if (!profile.weatherData[weather]) {
      weather = profile.weathers[(rand() * profile.weathers.length) | 0]
    }
    t = phaseIndex * phaseLen + (t % phaseLen)
  }

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
    const idx = Math.floor(t / phaseLen) % profile.phases.length
    if (idx !== phaseIndex) {
      phaseIndex = idx
      state.changedTime = true
    }
    const phaseT = (t % phaseLen) / phaseLen

    // Cambio de clima
    weatherLeft -= dt
    if (weatherLeft <= 0) {
      const next = profile.weathers[(rand() * profile.weathers.length) | 0]
      if (next !== weather) {
        weather = next
        state.changedWeather = true
      }
      weatherLeft = cfg.weatherMinSec + rand() * (cfg.weatherMaxSec - cfg.weatherMinSec)
    }

    // Interpolación suave entre la fase actual y la siguiente
    const a = profile.phaseData[phaseIndex]
    const b = profile.phaseData[(phaseIndex + 1) % profile.phaseData.length]
    const w = profile.weatherData[weather]

    state.phaseIndex = phaseIndex
    state.phase = profile.phases[phaseIndex]
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

  return { update, state, setProfile }
}
