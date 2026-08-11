// Estado del mundo: hora, clima, temperatura, actividad y tensión.
// Puro: sin three/tone/DOM. Es el motor del que cuelgan luz, sonido y (luego) eventos.

export const TIME_PHASES = [
  'night', 'pre-dawn', 'dawn chorus', 'first light',
  'early morning', 'mid-morning', 'morning', 'midday',
  'early afternoon', 'afternoon', 'golden hour', 'dusk',
]

export const WEATHERS = ['dry still', 'light rain', 'frost', 'after rain', 'heavy rain']

// Perfil por fase. `temp` es un DELTA de la hora (amplitud térmica del día,
// zona centro de Chile: fuerte oscilación día/noche) que se SUMA a la base
// estacional. La temperatura final la calcula update() = base estación + hora + clima.
const PHASE = [
  { act: 0.15, temp: -8, light: [0.34, 0.44, 0.78], gain: 0.72 }, // night
  { act: 0.25, temp: -9, light: [0.48, 0.44, 0.82], gain: 0.80 }, // pre-dawn (lo más frío)
  { act: 0.88, temp: -5, light: [1.00, 0.70, 0.48], gain: 0.86 }, // dawn chorus
  { act: 0.76, temp: -2, light: [1.00, 0.84, 0.68], gain: 1.08 }, // first light
  { act: 0.70, temp: 0, light: [1.00, 0.94, 0.84], gain: 1.24 }, // early morning
  { act: 0.62, temp: 3, light: [1.00, 0.99, 0.94], gain: 1.35 }, // mid-morning
  { act: 0.56, temp: 5, light: [1.00, 1.00, 1.00], gain: 1.35 }, // morning
  { act: 0.50, temp: 7, light: [1.00, 1.00, 0.99], gain: 1.35 }, // midday
  { act: 0.46, temp: 8, light: [1.00, 0.99, 0.95], gain: 1.35 }, // early afternoon (pico)
  { act: 0.52, temp: 7, light: [1.00, 0.96, 0.88], gain: 1.32 }, // afternoon
  { act: 0.68, temp: 2, light: [1.00, 0.76, 0.46], gain: 1.10 }, // golden hour
  { act: 0.50, temp: -3, light: [0.72, 0.56, 0.72], gain: 0.86 }, // dusk
]

// Efecto del clima. `temp` también es un DELTA (enfriamiento por lluvia/escarcha).
const WEATHER = {
  'dry still': { act: 1.00, tension: 0.05, temp: 0, rain: 0.00, fog: 0.10 },
  'light rain': { act: 0.85, tension: 0.20, temp: -3, rain: 0.35, fog: 0.35 },
  'frost': { act: 0.60, tension: 0.15, temp: -6, rain: 0.00, fog: 0.55 }, // helada
  'after rain': { act: 1.10, tension: 0.10, temp: 0, rain: 0.08, fog: 0.30 },
  'heavy rain': { act: 0.55, tension: 0.45, temp: -4, rain: 1.00, fog: 0.60 },
}

// ─── PERFILES POR MUNDO ─────────────────────────────────────────────────────
// Un perfil trae las fases del "día" y los estados del "clima". El bosque es el
// que se usa si nadie pide otro; la célula cambia el día por el ciclo celular y
// el clima por el medio en el que vive.

export const FOREST_PROFILE = {
  phases: TIME_PHASES, phaseData: PHASE,
  weathers: WEATHERS, weatherData: WEATHER,
  // Base térmica por estación (zona CENTRO de Chile, clima mediterráneo):
  // temp = mid + amp·cos(2π(seasonT − peak)). Verano (seasonT≈0.35) ≈ 24°,
  // invierno ≈ 10°, primavera/otoño ≈ 17°. Sobre esto van los deltas de hora y clima.
  seasonTemp: { mid: 17, amp: 7, peak: 0.35 },
}

// El "día" de la célula ya NO es el ciclo celular (ver
// docs/superpowers/specs/2026-08-11-ciclo-y-division-celula.md §2 y §3): es
// el RITMO FUNCIONAL del macrófago, que también es real (la fagocitosis y la
// secreción de citoquinas están bajo control circadiano). El pico de
// actividad es `hunting` (la caza); `resting` es el mínimo. El ciclo celular
// de verdad — mitosis incluida — vive aparte en `sim/cellCycle.js`, gateado
// por señal, no por el reloj.
export const CELL_PHASES = [
  'resting', 'surveillance', 'patrolling', 'chemotaxis',
  'alert', 'hunting', 'engulfing', 'digesting',
  'antigen presentation', 'cytokine secretion', 'efferocytosis', 'recovery',
]

// `temp` fijo en 37 (homeostasis: la célula no tiene estación ni delta
// horario real). `light`/`gain` en curva suave: más brillo y calidez en el
// pico (`hunting`), más frío y apagado en `resting`.
const CELL_PHASE = [
  { act: 0.30, temp: 37, light: [0.55, 0.62, 0.95], gain: 0.75 }, // resting
  { act: 0.45, temp: 37, light: [0.62, 0.72, 0.98], gain: 0.85 }, // surveillance
  { act: 0.62, temp: 37, light: [0.72, 0.82, 1.00], gain: 0.98 }, // patrolling
  { act: 0.78, temp: 37, light: [0.85, 0.90, 0.98], gain: 1.15 }, // chemotaxis
  { act: 0.72, temp: 37, light: [0.95, 0.80, 0.72], gain: 1.10 }, // alert
  { act: 0.90, temp: 37, light: [1.00, 0.86, 0.55], gain: 1.35 }, // hunting (pico)
  { act: 0.85, temp: 37, light: [1.00, 0.82, 0.62], gain: 1.28 }, // engulfing
  { act: 0.60, temp: 37, light: [0.92, 0.80, 0.78], gain: 1.05 }, // digesting
  { act: 0.55, temp: 37, light: [0.82, 0.80, 0.92], gain: 0.95 }, // antigen presentation
  { act: 0.68, temp: 37, light: [0.78, 0.86, 1.00], gain: 1.08 }, // cytokine secretion
  { act: 0.58, temp: 37, light: [0.68, 0.76, 0.96], gain: 0.92 }, // efferocytosis
  { act: 0.40, temp: 37, light: [0.58, 0.66, 0.96], gain: 0.80 }, // recovery
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

// ── NEURONA ──────────────────────────────────────────────────────────────────
// El "día" es un ciclo de sueño comprimido (spec §6.1): vigilia → somnolencia →
// N1 → N2 (husos) → N3 (ondas lentas) → REM → despertar. La `temperature` no se
// usa (37 fijo, sin estación); su fila del HUD mostrará la banda dominante en Hz,
// que la alimenta el mundo, no el ecosistema (F4). `light`/`gain`: frío y apagado
// en sueño profundo, brillante y neutro en vigilia y REM.
export const NEURON_PHASES = [
  'quiet wake', 'alert wake', 'focused', 'drowsy',
  'N1', 'N2 spindles', 'N3 slow wave', 'N3 deep',
  'N2 return', 'REM', 'REM burst', 'waking',
]

const NEURON_PHASE = [
  { act: 0.55, temp: 37, light: [0.80, 0.86, 1.00], gain: 1.10 }, // quiet wake (α)
  { act: 0.75, temp: 37, light: [0.90, 0.92, 1.00], gain: 1.25 }, // alert wake (β)
  { act: 0.90, temp: 37, light: [1.00, 0.96, 0.86], gain: 1.35 }, // focused (γ, pico act)
  { act: 0.50, temp: 37, light: [0.72, 0.76, 0.96], gain: 1.00 }, // drowsy (θ)
  { act: 0.42, temp: 37, light: [0.62, 0.68, 0.92], gain: 0.90 }, // N1
  { act: 0.40, temp: 37, light: [0.55, 0.62, 0.90], gain: 0.85 }, // N2 spindles
  { act: 0.35, temp: 37, light: [0.46, 0.54, 0.86], gain: 0.78 }, // N3 slow wave
  { act: 0.30, temp: 37, light: [0.40, 0.48, 0.82], gain: 0.72 }, // N3 deep (pico sincronía)
  { act: 0.42, temp: 37, light: [0.55, 0.62, 0.90], gain: 0.85 }, // N2 return
  { act: 0.82, temp: 37, light: [0.86, 0.80, 0.92], gain: 1.18 }, // REM (act alta, sin orden)
  { act: 0.88, temp: 37, light: [0.92, 0.82, 0.90], gain: 1.24 }, // REM burst
  { act: 0.60, temp: 37, light: [0.82, 0.86, 1.00], gain: 1.12 }, // waking
]

// El "clima" son los neuromoduladores (spec §6.2): química de fondo que cambia
// cómo responde la red.
export const NEURON_MODULATORS = [
  'cholinergic', 'noradrenergic', 'dopaminergic',
  'high adenosine', 'caffeine', 'gabaergic',
]

const NEURON_MODULATOR = {
  'cholinergic': { act: 1.05, tension: 0.15, temp: 0, rain: 0.20, fog: 0.15 },
  'noradrenergic': { act: 1.15, tension: 0.50, temp: 0, rain: 0.30, fog: 0.10 },
  'dopaminergic': { act: 1.00, tension: 0.20, temp: 0, rain: 0.22, fog: 0.18 },
  'high adenosine': { act: 0.55, tension: 0.30, temp: 0, rain: 0.10, fog: 0.40 },
  'caffeine': { act: 0.95, tension: 0.40, temp: 0, rain: 0.18, fog: 0.20 },
  'gabaergic': { act: 0.40, tension: 0.10, temp: 0, rain: 0.06, fog: 0.30 },
}

export const NEURON_PROFILE = {
  phases: NEURON_PHASES, phaseData: NEURON_PHASE,
  weathers: NEURON_MODULATORS, weatherData: NEURON_MODULATOR,
}

// ── MICELIO ──────────────────────────────────────────────────────────────────
// El "día" es el ciclo de humedad y temperatura: la red crece de NOCHE y al ALBA
// (con rocío) y se detiene al mediodía seco. `light` mantiene la escena tenue y
// fría (suelo del bosque); `gain` no cae del todo de noche para que se vea el
// foxfire. Ver spec §9.
export const FUNGUS_PHASES = [
  'medianoche', 'madrugada', 'rocío del alba', 'primera luz',
  'mañana', 'media mañana', 'mediodía seco', 'siesta',
  'tarde', 'frescor', 'anochecer', 'relente',
]

const FUNGUS_PHASE = [
  { act: 0.85, temp: 8, light: [0.34, 0.42, 0.55], gain: 0.78 }, // medianoche
  { act: 0.92, temp: 6, light: [0.36, 0.44, 0.58], gain: 0.76 }, // madrugada
  { act: 1.00, temp: 7, light: [0.55, 0.58, 0.62], gain: 0.86 }, // rocío del alba
  { act: 0.86, temp: 10, light: [0.72, 0.70, 0.62], gain: 0.98 }, // primera luz
  { act: 0.64, temp: 13, light: [0.82, 0.80, 0.70], gain: 1.06 }, // mañana
  { act: 0.48, temp: 16, light: [0.88, 0.86, 0.76], gain: 1.10 }, // media mañana
  { act: 0.28, temp: 19, light: [0.92, 0.90, 0.80], gain: 1.12 }, // mediodía seco
  { act: 0.30, temp: 18, light: [0.90, 0.88, 0.78], gain: 1.08 }, // siesta
  { act: 0.44, temp: 16, light: [0.86, 0.82, 0.72], gain: 1.02 }, // tarde
  { act: 0.62, temp: 13, light: [0.72, 0.68, 0.66], gain: 0.94 }, // frescor
  { act: 0.78, temp: 11, light: [0.50, 0.52, 0.60], gain: 0.86 }, // anochecer
  { act: 0.86, temp: 9, light: [0.38, 0.44, 0.58], gain: 0.80 }, // relente
]

// El "clima" es la humedad: el eje que de verdad manda para un hongo.
export const FUNGUS_MOISTURE = [
  'empapado', 'lluvia', 'niebla', 'rocío', 'secándose', 'seco', 'helada',
]

const FUNGUS_MEDIUM = {
  'empapado': { act: 1.05, tension: 0.05, temp: -1, rain: 0.20, fog: 0.50 },
  'lluvia': { act: 1.00, tension: 0.10, temp: -1, rain: 1.00, fog: 0.60 },
  'niebla': { act: 0.92, tension: 0.10, temp: 0, rain: 0.05, fog: 0.72 },
  'rocío': { act: 0.98, tension: 0.08, temp: 0, rain: 0.02, fog: 0.42 },
  'secándose': { act: 0.55, tension: 0.30, temp: 1, rain: 0.00, fog: 0.20 },
  'seco': { act: 0.22, tension: 0.50, temp: 2, rain: 0.00, fog: 0.05 }, // la red se detiene
  'helada': { act: 0.30, tension: 0.45, temp: -6, rain: 0.00, fog: 0.55 }, // gatilla fructificación
}

export const FUNGUS_PROFILE = {
  phases: FUNGUS_PHASES, phaseData: FUNGUS_PHASE,
  weathers: FUNGUS_MOISTURE, weatherData: FUNGUS_MEDIUM,
}

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
  // Reloj de estación: una vuelta (un "año") cada seasonLengthSec. El +0.35 hace
  // que el mundo arranque en VERANO. Lo comparten el HUD y el follaje.
  let seasonClock = 0
  const seasonLen = cfg.seasonLengthSec || 210

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
    seasonT: 0.35,      // 0..1 reloj de estación (arranca en verano)
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

    // Estación: avanza su reloj y da la base térmica (solo perfiles con seasonTemp).
    seasonClock += dt
    state.seasonT = (seasonClock / seasonLen + 0.35) % 1
    const st = profile.seasonTemp
    const seasonBase = st ? st.mid + st.amp * Math.cos(2 * Math.PI * (state.seasonT - st.peak)) : 0

    state.phaseIndex = phaseIndex
    state.phase = profile.phases[phaseIndex]
    state.phaseT = phaseT
    state.weather = weather
    // Temperatura = base de estación + delta de hora + delta de clima.
    state.temperature = Math.round(seasonBase + lerp(a.temp, b.temp, phaseT) + w.temp)
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
