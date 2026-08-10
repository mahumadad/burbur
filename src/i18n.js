// Traducción de display al español. Las CLAVES internas (fase/clima) siguen en
// inglés porque se usan en lookups y en la lógica; esto solo mapea para mostrar.

export const PHASE_ES = {
  'night': 'noche',
  'pre-dawn': 'antes del alba',
  'dawn chorus': 'coro del alba',
  'first light': 'primera luz',
  'early morning': 'mañana temprana',
  'mid-morning': 'media mañana',
  'morning': 'mañana',
  'midday': 'mediodía',
  'early afternoon': 'primera tarde',
  'afternoon': 'tarde',
  'golden hour': 'hora dorada',
  'dusk': 'anochecer',
}

export const WEATHER_ES = {
  'dry still': 'seco y quieto',
  'light rain': 'llovizna',
  'frost': 'escarcha',
  'after rain': 'tras la lluvia',
  'heavy rain': 'lluvia fuerte',
}

export const phaseES = (p) => PHASE_ES[p] || p
export const weatherES = (w) => WEATHER_ES[w] || w
