// Panel de dev: tunear parámetros en vivo sin recompilar.
export function createPanel(cfg, hooks) {
  const el = document.createElement('div')
  el.style.cssText = `
    position:fixed; top:10px; left:10px; z-index:20; padding:10px 12px;
    background:rgba(5,8,12,.6); color:#dff; font:12px/1.6 system-ui,sans-serif;
    border-radius:8px; backdrop-filter:blur(4px); user-select:none; min-width:180px;`
  function row(label, min, max, step, value, on) {
    const wrap = document.createElement('label')
    wrap.style.cssText = 'display:flex; gap:8px; align-items:center; justify-content:space-between;'
    const span = document.createElement('span'); span.textContent = label
    const input = document.createElement('input')
    input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value
    input.addEventListener('input', () => on(parseFloat(input.value)))
    wrap.append(span, input); el.append(wrap)
  }
  row('acoplamiento K', 0, 6, 0.1, cfg.fireflies.couplingK, (v) => cfg.fireflies.couplingK = v)
  row('radio vecindad', 1, 8, 0.1, cfg.fireflies.neighborRadius, (v) => cfg.fireflies.neighborRadius = v)
  row('vol latidos', -40, 0, 1, cfg.audio.volumes.flash, (v) => hooks.onFlashVol(v))
  row('vol drone', -40, 0, 1, cfg.audio.volumes.drone, (v) => hooks.onDroneVol(v))
  row('vol cama', -40, 0, 1, cfg.audio.volumes.bed, (v) => hooks.onBedVol(v))
  document.body.appendChild(el)
}
