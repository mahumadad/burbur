// Selector de mundo: una figura por bioma (triángulo/gota/bloque/hexágono) con
// el color de acento exacto de cada mundo y un glow del mismo tono. Click →
// cambia de mundo. Réplica del selector de murmur (`window.setScene(id)`), pero
// con geometría en vez de simples puntos. El nombre del mundo SIEMPRE se ve:
// muestra el del mundo activo y se resalta al pasar el mouse por otro.

// Figura SVG por mundo (viewBox 0 0 24 24, se pinta con currentColor).
const SHAPES = {
  land: '<polygon points="12,3.5 20.5,20 3.5,20"/>',                                     // cerro/árbol
  water: '<path d="M12 3.2c-4.3 6-5.6 9.3-3.8 12.4a4.7 4.7 0 0 0 8.1 0C17.6 12.5 16.3 9.2 12 3.2Z"/>', // gota
  city: '<rect x="4.5" y="4.5" width="15" height="15" rx="2.6"/>',                       // bloque
  cell: '<polygon points="12,2.8 19.9,7.4 19.9,16.6 12,21.2 4.1,16.6 4.1,7.4"/>',        // hexágono
}
const shapeFor = (id) => SHAPES[id] || '<circle cx="12" cy="12" r="8.2"/>'

const CSS = `
.wsel {
  position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); z-index: 20;
  display: flex; gap: 6px; padding: 7px 10px; border-radius: 999px;
  background: rgba(6, 10, 8, 0.55); backdrop-filter: blur(7px);
  border: 1px solid rgba(255, 255, 255, 0.09); user-select: none;
}
.wsel button {
  all: unset; cursor: pointer; display: grid; place-items: center;
  width: 30px; height: 30px; border-radius: 9px;
  transition: transform .16s ease, background .16s ease;
}
.wsel button:hover { transform: translateY(-2px); background: rgba(255,255,255,.06); }
.wsel .shape { color: #fff; line-height: 0; transition: transform .16s ease, filter .16s ease; }
.wsel .shape svg { display: block; fill: currentColor; width: 20px; height: 20px; }
.wsel button:hover .shape { filter: drop-shadow(0 0 5px); }
.wsel button[aria-selected="true"] .shape { transform: scale(1.16); filter: drop-shadow(0 0 6px) drop-shadow(0 0 2px); }
.wsel button[data-ready="false"] .shape { opacity: .4; filter: saturate(.55); }
.wsel button[data-ready="false"][aria-selected="true"] .shape { opacity: .62; }
.wsel-lbl {
  position: fixed; bottom: 56px; left: 50%; transform: translateX(-50%); z-index: 20;
  font: 600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: .16em; text-transform: uppercase; color: #eafff0;
  opacity: .5; transition: opacity .16s ease, letter-spacing .16s ease;
  pointer-events: none; white-space: nowrap; text-shadow: 0 1px 7px rgba(0,0,0,.65);
}
.wsel-lbl.hot { opacity: 1; letter-spacing: .2em; }
`

export function createWorldSelector(worlds, current, onSelect) {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const lbl = document.createElement('div')
  lbl.className = 'wsel-lbl'
  document.body.appendChild(lbl)

  const byId = {}
  for (const w of worlds) byId[w.id] = w
  const nameOf = (w) => w.name || w.label
  let currentId = current
  let hovering = false

  function renderLabel(id, hot) {
    const w = byId[id]
    if (!w) return
    lbl.textContent = nameOf(w) + (w.ready ? '' : ' · próximamente')
    lbl.classList.toggle('hot', hot)
  }

  const el = document.createElement('div')
  el.className = 'wsel'
  const btns = {}
  for (const w of worlds) {
    const b = document.createElement('button')
    b.dataset.id = w.id
    b.dataset.ready = String(w.ready)
    b.setAttribute('aria-selected', String(w.id === current))
    b.title = nameOf(w)
    const shape = document.createElement('span')
    shape.className = 'shape'
    shape.style.color = w.accent
    shape.innerHTML = `<svg viewBox="0 0 24 24">${shapeFor(w.id)}</svg>`
    b.appendChild(shape)
    b.addEventListener('click', () => onSelect(w.id))
    b.addEventListener('pointerenter', () => { hovering = true; renderLabel(w.id, true) })
    b.addEventListener('pointerleave', () => { hovering = false; renderLabel(currentId, false) })
    el.appendChild(b)
    btns[w.id] = b
  }
  document.body.appendChild(el)

  // El nombre del mundo activo se ve desde el arranque (no solo en hover).
  renderLabel(currentId, false)

  function setActive(id) {
    for (const k in btns) btns[k].setAttribute('aria-selected', String(k === id))
    currentId = id
    if (!hovering) renderLabel(id, false)
  }
  return { el, setActive }
}
