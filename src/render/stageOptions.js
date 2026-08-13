// Opciones del ESCENARIO compartido. Puro: sin three ni DOM, para poder probar
// por test que los defaults reproducen el encuadre histórico — si alguno cambia,
// los seis mundos que ya existen se ven distinto, y eso es una regresión.
// Los valores salen tal cual de lo que estaba hardcodeado en stage.js.

export const STAGE_DEFAULTS = Object.freeze({
  camera: Object.freeze({
    orbR: 118, theta: 0.62, phi: 0.92,   // órbita esférica: vista aérea 3/4
    target: Object.freeze([0, 0, 0]),
  }),
  orbit: Object.freeze({
    minDist: 40, maxDist: 260,
    minPolar: 0, maxPolar: Math.PI * 0.49, // no bajar del horizonte
  }),
  // Respiración de la vista: el target sube y baja despacio.
  breathe: Object.freeze({ baseY: 0, ampY: 1.7 }),
  fog: Object.freeze({ color: 0x000000, density: 0.004 }),
  background: 0x000000,
  addPass: null,   // hook: (composer) => void, para pasadas propias del mundo
})

const section = (base, over) => (over ? { ...base, ...over } : { ...base })

/**
 * Mezcla las opciones de un mundo sobre los defaults, sección por sección.
 * @param {object} [opts]
 */
export function resolveStageOptions(opts = {}) {
  return {
    camera: section(STAGE_DEFAULTS.camera, opts.camera),
    orbit: section(STAGE_DEFAULTS.orbit, opts.orbit),
    breathe: section(STAGE_DEFAULTS.breathe, opts.breathe),
    fog: section(STAGE_DEFAULTS.fog, opts.fog),
    background: opts.background ?? STAGE_DEFAULTS.background,
    addPass: opts.addPass ?? STAGE_DEFAULTS.addPass,
  }
}

/**
 * Y del target de la órbita en este frame.
 * @param {number} clock
 * @param {{baseY:number, ampY:number}} breathe
 */
export function breatheTargetY(clock, breathe) {
  return breathe.baseY + Math.sin(clock * 0.13) * breathe.ampY
}
