// Overrides por URL: fija variables del ecosistema para poder mostrar o revisar
// un escenario concreto (nieve, sequía, tormenta, mediodía…) sin esperar a que el
// reloj del mundo dé la vuelta. Puro: recibe el query string y devuelve un objeto
// normalizado que el ecosistema aplica. Sin parámetros → objeto vacío (nada fijo).
//
// Ejemplos: ?temperatura=-5   ?rain=1&wind=1   ?weather=heavy%20rain   ?snow=1
//           ?season=0.6       ?phase=midday    ?actividad=0.9&tension=0.1

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null }
const unit = (v) => { const n = num(v); return n == null ? null : clamp01(n) }
const pos = (v) => { const n = num(v); return n == null ? null : Math.max(0, n) }
const str = (v) => { const s = (v == null ? '' : String(v)).trim(); return s || null }

// campo canónico de `eco` → saneador + alias aceptados en la URL.
const KEYS = [
  { field: 'temperature', norm: num, names: ['temperature', 'temp', 'temperatura'] },
  { field: 'tension', norm: unit, names: ['tension', 'tensión'] },
  { field: 'activity', norm: unit, names: ['activity', 'actividad', 'act'] },
  { field: 'rain', norm: unit, names: ['rain', 'lluvia', 'agua', 'water'] },
  { field: 'fog', norm: unit, names: ['fog', 'niebla'] },
  { field: 'wind', norm: pos, names: ['wind', 'viento'] },
  { field: 'season', norm: unit, names: ['season', 'seasonT', 'estacion', 'estación'] },
  { field: 'gain', norm: num, names: ['gain', 'brillo'] },
  { field: 'weather', norm: str, names: ['weather', 'clima'] },
  { field: 'phase', norm: str, names: ['phase', 'fase', 'hora'] },
]

/**
 * @param {string} search - el query string (con o sin '?'), p. ej. location.search
 * @returns {Object} fijos normalizados; solo trae las claves presentes y válidas.
 */
export function parseFijos(search) {
  const qs = new URLSearchParams(search || '')
  const fijos = {}
  for (const { field, norm, names } of KEYS) {
    let raw = null
    for (const n of names) { if (qs.has(n)) { raw = qs.get(n); break } }
    if (raw == null) continue
    const val = norm(raw)
    if (val != null) fijos[field] = val
  }
  // Conveniencia: nieve. `?snow` (o `?snow=0.7`) arma un escenario nevado sin tener
  // que saber que la nieve se dispara con temperatura ≤ -3. Los overrides
  // explícitos de temperatura/lluvia ganan, así se puede afinar el escenario.
  if (qs.has('snow') || qs.has('nieve')) {
    const raw = qs.has('snow') ? qs.get('snow') : qs.get('nieve')
    const amt = raw === '' ? 1 : (unit(raw) ?? 1)
    if (fijos.temperature == null) fijos.temperature = -5
    if (fijos.rain == null) fijos.rain = amt
  }
  return fijos
}
