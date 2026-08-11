// Selector de mundo en GRILLA 3×2 abajo a la izquierda (pensado para mobile,
// estilo murmur.living): una tarjeta redondeada por bioma con un "blob" de su
// color de acento, y abajo una barra ancha de AGITAR. Click → cambia de mundo /
// sacude. El nombre del mundo aparece ENCIMA de la tarjeta al pasar el mouse
// (y un instante al seleccionar, útil en mobile sin hover).

// Blob SVG por mundo (viewBox 0 0 24 24, pintado con el acento del mundo).
const SHAPES = {
  land: '<polygon points="12,3.5 20.5,20 3.5,20"/>',                                     // cerro/árbol
  water: '<path d="M12 3.2c-4.3 6-5.6 9.3-3.8 12.4a4.7 4.7 0 0 0 8.1 0C17.6 12.5 16.3 9.2 12 3.2Z"/>', // gota
  city: '<rect x="4.5" y="4.5" width="15" height="15" rx="2.6"/>',                       // bloque
  cell: '<polygon points="12,2.8 19.9,7.4 19.9,16.6 12,21.2 4.1,16.6 4.1,7.4"/>',        // hexágono
  fungus: '<path d="M3.4 11.5a8.6 6.2 0 0 1 17.2 0z"/><rect x="9.8" y="11.5" width="4.4" height="8.4" rx="1.8"/>', // hongo
  neuron: '<circle cx="12" cy="12" r="3.4"/><circle cx="5" cy="6" r="1.7"/><circle cx="19" cy="7" r="1.7"/><circle cx="18.5" cy="18" r="1.7"/><circle cx="5.5" cy="17.5" r="1.7"/>', // red/neurona
}
const shapeFor = (id) => SHAPES[id] || '<circle cx="12" cy="12" r="8.2"/>'
// Icono de AGITAR: rombo con dos arcos de vibración (guiño al shake de murmur).
const SHAKE_SVG =
  '<path d="M12 7.2l3.6 4.8-3.6 4.8-3.6-4.8z"/>' +
  '<path d="M5.2 9a4.4 5 0 0 0 0 6M18.8 9a4.4 5 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'

const CSS = `
.wsel {
  position: fixed; left: 12px; bottom: 14px; z-index: 20;
  display: grid; grid-template-columns: repeat(3, 46px); gap: 8px; user-select: none;
}
.wsel .shk { grid-column: 1 / -1; width: auto; height: 40px; }
.wsel button {
  all: unset; cursor: pointer; display: grid; place-items: center;
  width: 46px; height: 46px; border-radius: 14px;
  background: rgba(6, 10, 8, 0.5); backdrop-filter: blur(7px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: transform .16s ease, background .16s ease, box-shadow .16s ease;
}
.wsel button:hover { transform: scale(1.06); background: rgba(255,255,255,.07); }
.wsel .ico { line-height: 0; }
.wsel .ico svg { display: block; width: 26px; height: 26px; fill: currentColor;
  filter: drop-shadow(0 0 5px); transition: transform .16s ease, filter .16s ease; }
.wsel button[aria-selected="true"] {
  background: rgba(255, 255, 255, 0.10);
  box-shadow: 0 0 0 2px var(--tile-accent), 0 0 16px -3px var(--tile-accent);
}
.wsel button[aria-selected="true"] .ico svg { transform: scale(1.14); filter: drop-shadow(0 0 9px); }
.wsel button[data-ready="false"] .ico { opacity: .4; filter: saturate(.5); }
.wsel .shk { color: #eafff0; }
.wsel .shk .ico svg { filter: none; }
.wsel .shk:hover { color: var(--accent, #8fe04a); }
body.is-shaking .wsel .shk .ico svg { animation: wsel-shk .55s ease; }
@keyframes wsel-shk { 0%,100%{transform:rotate(0)} 25%{transform:rotate(-13deg)} 75%{transform:rotate(13deg)} }
.wsel-lbl {
  position: fixed; z-index: 21; transform: translate(-50%, -100%);
  font: 600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: .16em; text-transform: uppercase; color: #eafff0;
  opacity: 0; transition: opacity .16s ease; pointer-events: none; white-space: nowrap;
  text-shadow: 0 1px 7px rgba(0,0,0,.7);
}
`

export function createWorldSelector(worlds, current, onSelect, onShake) {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const lbl = document.createElement('div')
  lbl.className = 'wsel-lbl'
  document.body.appendChild(lbl)

  const byId = {}
  for (const w of worlds) byId[w.id] = w
  const nameOf = (w) => w.name || w.label

  // El nombre se posiciona ENCIMA de la tarjeta (centrado), así no tapa las
  // vecinas de la grilla.
  function showLabel(text, btn) {
    lbl.textContent = text
    const r = btn.getBoundingClientRect()
    lbl.style.left = (r.left + r.width / 2) + 'px'
    lbl.style.top = (r.top - 6) + 'px'
    lbl.style.opacity = '1'
  }
  function hideLabel() { lbl.style.opacity = '0' }

  const el = document.createElement('div')
  el.className = 'wsel'
  const btns = {}
  for (const w of worlds) {
    const b = document.createElement('button')
    b.dataset.id = w.id
    b.dataset.ready = String(w.ready)
    b.setAttribute('aria-selected', String(w.id === current))
    b.style.setProperty('--tile-accent', w.accent)
    b.title = nameOf(w)
    const ico = document.createElement('span')
    ico.className = 'ico'
    ico.style.color = w.accent
    ico.innerHTML = `<svg viewBox="0 0 24 24">${shapeFor(w.id)}</svg>`
    b.appendChild(ico)
    b.addEventListener('click', () => onSelect(w.id))
    b.addEventListener('pointerenter', () => showLabel(nameOf(w) + (w.ready ? '' : ' · próximamente'), b))
    b.addEventListener('pointerleave', hideLabel)
    el.appendChild(b)
    btns[w.id] = b
  }

  // Tarjeta de AGITAR al final (mismo estilo). Llama al mismo trigger que los
  // gestos físicos (sacudir el móvil / el mouse), así todo pasa por un solo lugar.
  if (onShake) {
    const s = document.createElement('button')
    s.className = 'shk'
    s.title = 'Agitar'
    s.innerHTML = `<span class="ico"><svg viewBox="0 0 24 24">${SHAKE_SVG}</svg></span>`
    s.addEventListener('click', onShake)
    s.addEventListener('pointerenter', () => showLabel('Agitar', s))
    s.addEventListener('pointerleave', hideLabel)
    el.appendChild(s)
  }
  document.body.appendChild(el)

  function setActive(id) {
    for (const k in btns) btns[k].setAttribute('aria-selected', String(k === id))
    // Mostrar el nombre del nuevo mundo un instante (en mobile no hay hover).
    const b = btns[id]
    if (b) { showLabel(nameOf(byId[id]), b); setTimeout(hideLabel, 1400) }
  }
  return { el, setActive }
}
