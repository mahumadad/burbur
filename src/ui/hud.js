// Panel ECOSISTEMA: lectura técnica del estado del mundo (estilo murmur).
import { phaseES, weatherES, seasonES } from '../i18n.js'

const CSS = `
.eco {
  position: fixed; top: 14px; left: 14px; z-index: 20; width: 232px;
  padding: 12px 14px; border-radius: 10px;
  background: rgba(6, 10, 8, 0.62); backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.10);
  font: 11px/1.75 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.06em; text-transform: uppercase; color: #cfe6d6;
  user-select: none;
}
.eco h4 { margin: 0 0 8px; font-size: 11px; letter-spacing: 0.12em; color: #eafff0; font-weight: 600;
  display: flex; align-items: center; cursor: pointer; }
.eco h4 .tgl { margin-left: auto; padding-left: 16px; opacity: .5; font-weight: 400; }
.eco.collapsed { width: auto; }
.eco.collapsed h4 { margin: 0; }
.eco.collapsed > :not(h4) { display: none !important; }
.eco .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
  background: var(--accent, #8fe04a); margin-right: 7px; vertical-align: middle; }
.eco .row { display: flex; justify-content: space-between; gap: 10px; }
.eco .row span:last-child { color: #fff; }
.eco .bar { height: 3px; border-radius: 2px; background: rgba(255,255,255,.14); margin: 3px 0 7px; }
.eco .bar > i { display: block; height: 100%; border-radius: 2px; background: var(--accent, #8fe04a); }
.eco .bar.warn > i { background: #ff5a5a; }
.eco .sep { height: 1px; background: rgba(255,255,255,.10); margin: 9px 0; }
.eco input[type=range] { -webkit-appearance: none; appearance: none; width: 96px; height: 3px;
  border-radius: 2px; background: rgba(255,255,255,.18); outline: none; }
.eco input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none;
  width: 9px; height: 9px; border-radius: 50%; background: var(--accent, #8fe04a); cursor: pointer; }
`

export function createHud(accent = '#8fe04a', hooks = {}) {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const el = document.createElement('div')
  el.className = 'eco'
  // El acento lo controla :root (--accent) según el mundo activo; el CSS ya lo lee.
  el.innerHTML = `
    <h4><span class="dot"></span>ECOSISTEMA<span class="tgl">–</span></h4>
    <div class="row"><span data-l="time">HORA</span><span data-f="time">—</span></div>
    <div class="row"><span data-l="weather">CLIMA</span><span data-f="weather">—</span></div>
    <div class="row" data-row="season"><span data-l="season">ESTACIÓN</span><span data-f="season">—</span></div>
    <div class="row"><span>TEMPERATURA</span><span data-f="temp">—</span></div>
    <div class="sep"></div>
    <div class="row"><span>ACTIVIDAD</span><span data-f="actv">—</span></div>
    <div class="bar"><i data-f="actbar" style="width:0%"></i></div>
    <div class="row"><span>TENSIÓN</span><span data-f="tenv">—</span></div>
    <div class="bar warn"><i data-f="tenbar" style="width:0%"></i></div>
    <div class="sep"></div>
    <div class="row"><span>FONDO</span><input type="range" data-f="drone" min="0" max="100" value="100"></div>
    <div class="row"><span>MUNDO</span><input type="range" data-f="world" min="0" max="100" value="100"></div>
    <div class="row"><span>ACTIVIDAD</span><input type="range" data-f="activity" min="0" max="100" value="100"></div>`
  document.body.appendChild(el)

  // Minimizar: tap en el título colapsa/expande. En pantallas chicas (mobile)
  // arranca colapsado para no tapar el mundo.
  const h4 = el.querySelector('h4')
  const tgl = h4.querySelector('.tgl')
  function setCollapsed(c) { el.classList.toggle('collapsed', c); tgl.textContent = c ? '+' : '–' }
  h4.addEventListener('click', () => setCollapsed(!el.classList.contains('collapsed')))
  if (window.innerWidth < 700) setCollapsed(true)

  const f = {}
  el.querySelectorAll('[data-f]').forEach((n) => { f[n.dataset.f] = n })
  const labels = {}
  el.querySelectorAll('[data-l]').forEach((n) => { labels[n.dataset.l] = n })
  const seasonRow = el.querySelector('[data-row="season"]')
  let showSeason = true

  // Cada mundo puede renombrar/ocultar filas del panel. La célula no tiene
  // estación (se oculta) y su "hora" es el ciclo y su "clima" es el medio.
  function setWorld(hud) {
    labels.time.textContent = (hud && hud.time) || 'HORA'
    labels.weather.textContent = (hud && hud.weather) || 'CLIMA'
    showSeason = !(hud && hud.season === null)
    seasonRow.style.display = showSeason ? '' : 'none'
    if (showSeason) labels.season.textContent = (hud && hud.season) || 'ESTACIÓN'
  }

  // 0–100 % → dB (−40 dB = silencio práctico)
  const pctToDb = (v) => (v <= 0 ? -60 : -40 + (v / 100) * 40)
  f.drone.addEventListener('input', () => hooks.onDrone && hooks.onDrone(pctToDb(+f.drone.value)))
  f.world.addEventListener('input', () => hooks.onWorld && hooks.onWorld(pctToDb(+f.world.value)))
  f.activity.addEventListener('input', () => hooks.onActivity && hooks.onActivity(pctToDb(+f.activity.value)))

  let lastPhase = null, lastWeather = null
  function update(s) {
    if (s.phase !== lastPhase) { f.time.textContent = phaseES(s.phase); lastPhase = s.phase }
    if (s.weather !== lastWeather) { f.weather.textContent = weatherES(s.weather); lastWeather = s.weather }
    // Un mundo puede fijar su propio valor de "estación" (la célula/micelio no
    // tienen estaciones: el micelio muestra la clase de descomposición).
    if (showSeason) f.season.textContent = s.seasonLabel || seasonES(s.seasonT)
    f.temp.textContent = s.temperature + '°C'
    f.actv.textContent = Math.round(s.activity * 100) + '%'
    f.tenv.textContent = s.tension.toFixed(2)
    f.actbar.style.width = (s.activity * 100).toFixed(0) + '%'
    f.tenbar.style.width = (s.tension * 100).toFixed(0) + '%'
  }

  return { update, el, setWorld }
}
