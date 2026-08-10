// Panel ECOSYSTEM: lectura técnica del estado del mundo (estilo murmur).

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
.eco h4 { margin: 0 0 8px; font-size: 11px; letter-spacing: 0.12em; color: #eafff0; font-weight: 600; }
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
  el.style.setProperty('--accent', accent)
  el.innerHTML = `
    <h4><span class="dot"></span>PLOT ECOSYSTEM</h4>
    <div class="row"><span>TIME</span><span data-f="time">—</span></div>
    <div class="row"><span>WEATHER</span><span data-f="weather">—</span></div>
    <div class="row"><span>TEMPERATURE</span><span data-f="temp">—</span></div>
    <div class="sep"></div>
    <div class="row"><span>ACTIVITY</span><span data-f="actv">—</span></div>
    <div class="bar"><i data-f="actbar" style="width:0%"></i></div>
    <div class="row"><span>TENSION</span><span data-f="tenv">—</span></div>
    <div class="bar warn"><i data-f="tenbar" style="width:0%"></i></div>
    <div class="sep"></div>
    <div class="row"><span>MUSIC</span><input type="range" data-f="music" min="0" max="100" value="100"></div>
    <div class="row"><span>WORLD</span><input type="range" data-f="world" min="0" max="100" value="100"></div>`
  document.body.appendChild(el)

  const f = {}
  el.querySelectorAll('[data-f]').forEach((n) => { f[n.dataset.f] = n })

  // 0–100 % → dB (−40 dB = silencio práctico)
  const pctToDb = (v) => (v <= 0 ? -60 : -40 + (v / 100) * 40)
  f.music.addEventListener('input', () => hooks.onMusic && hooks.onMusic(pctToDb(+f.music.value)))
  f.world.addEventListener('input', () => hooks.onWorld && hooks.onWorld(pctToDb(+f.world.value)))

  let lastPhase = null, lastWeather = null
  function update(s) {
    if (s.phase !== lastPhase) { f.time.textContent = s.phase; lastPhase = s.phase }
    if (s.weather !== lastWeather) { f.weather.textContent = s.weather; lastWeather = s.weather }
    f.temp.textContent = s.temperature + '°C'
    f.actv.textContent = Math.round(s.activity * 100) + '%'
    f.tenv.textContent = s.tension.toFixed(2)
    f.actbar.style.width = (s.activity * 100).toFixed(0) + '%'
    f.tenbar.style.width = (s.tension * 100).toFixed(0) + '%'
  }

  return { update, el }
}
