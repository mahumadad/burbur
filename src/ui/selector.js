// Selector de mundo: 3 "pill-dots" (uno por bioma) con el color de acento
// exacto de cada mundo. Click → cambia de mundo. Réplica del selector de murmur
// (`pill-dot-land/water/city` → `window.setScene(id)`).

const CSS = `
.wsel {
  position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 20;
  display: flex; gap: 10px; padding: 8px 12px; border-radius: 999px;
  background: rgba(6, 10, 8, 0.62); backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.10); user-select: none;
}
.wsel button { all: unset; cursor: pointer; display: grid; place-items: center; width: 24px; height: 24px; }
.wsel .dot { width: 12px; height: 12px; border-radius: 50%; transition: transform .15s ease, box-shadow .15s ease; }
.wsel button[aria-selected="true"] .dot { transform: scale(1.35); box-shadow: 0 0 0 2px rgba(255,255,255,.85); }
.wsel button[data-ready="false"] .dot { opacity: .5; }
.wsel-lbl {
  position: fixed; bottom: 50px; left: 50%; transform: translateX(-50%); z-index: 20;
  font: 600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: .12em; text-transform: uppercase; color: #eafff0;
  opacity: 0; transition: opacity .15s ease; pointer-events: none; white-space: nowrap;
}
`

export function createWorldSelector(worlds, current, onSelect) {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const lbl = document.createElement('div')
  lbl.className = 'wsel-lbl'
  document.body.appendChild(lbl)

  const el = document.createElement('div')
  el.className = 'wsel'
  const btns = {}
  for (const w of worlds) {
    const b = document.createElement('button')
    b.dataset.id = w.id
    b.dataset.ready = String(w.ready)
    b.setAttribute('aria-selected', String(w.id === current))
    b.title = w.label
    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.style.background = w.accent
    b.appendChild(dot)
    b.addEventListener('click', () => onSelect(w.id))
    b.addEventListener('pointerenter', () => {
      lbl.textContent = w.label + (w.ready ? '' : ' · próximamente')
      lbl.style.opacity = '1'
    })
    b.addEventListener('pointerleave', () => { lbl.style.opacity = '0' })
    el.appendChild(b)
    btns[w.id] = b
  }
  document.body.appendChild(el)

  function setActive(id) {
    for (const k in btns) btns[k].setAttribute('aria-selected', String(k === id))
  }
  return { el, setActive }
}
