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

// Mundo CÉLULA: el "día" es el ritmo funcional del macrófago (spec
// 2026-08-11-ciclo-y-division-celula.md §3) y el "clima" es el medio.
export const CELL_PHASE_ES = {
  'resting': 'reposo',
  'surveillance': 'vigilancia',
  'patrolling': 'patrulla',
  'chemotaxis': 'quimiotaxis',
  'alert': 'alerta',
  'hunting': 'caza',
  'engulfing': 'fagocitosis',
  'digesting': 'digestión',
  'antigen presentation': 'presentación de antígeno',
  'cytokine secretion': 'secreción de citoquinas',
  'efferocytosis': 'barrido de restos',
  'recovery': 'recuperación',
  // Entradas viejas del ciclo celular (ya no las produce ecosystem.js: el
  // ciclo pasó a sim/cellCycle.js). Se conservan porque test/cellNarration.test.js
  // las sigue usando para probar la traducción genérica de fase.
  'G1 early': 'G1 temprana',
  'G1': 'G1',
  'G1/S checkpoint': 'control G1/S',
  'S phase': 'fase S',
  'S late': 'S tardía',
  'G2': 'G2',
  'G2/M checkpoint': 'control G2/M',
  'prophase': 'profase',
  'metaphase': 'metafase',
  'anaphase': 'anafase',
  'telophase': 'telofase',
  'cytokinesis': 'citocinesis',
}

export const CELL_WEATHER_ES = {
  'nutrient rich': 'medio rico',
  'serum starved': 'ayuno de suero',
  'hypoxic': 'hipoxia',
  'oxidative stress': 'estrés oxidativo',
  'inflamed': 'inflamación',
  'acidic': 'medio ácido',
}
Object.assign(PHASE_ES, CELL_PHASE_ES)
Object.assign(WEATHER_ES, CELL_WEATHER_ES)

export const phaseES = (p) => PHASE_ES[p] || p
export const weatherES = (w) => WEATHER_ES[w] || w

// Estación a partir del reloj de estación (0..1, con el offset ya aplicado).
export const seasonES = (t) => {
  const s = (((t || 0) % 1) + 1) % 1
  return s < 0.2 ? 'primavera' : s < 0.5 ? 'verano' : s < 0.78 ? 'otoño' : 'invierno'
}
