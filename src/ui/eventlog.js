// EVENTS LOG (derecha) + píldora "ahora sonando" (arriba). Estética técnica.

const CSS = `
.evlog {
  position: fixed; top: 14px; right: 14px; z-index: 20; width: 250px; max-height: 62vh;
  padding: 12px 14px; border-radius: 10px; overflow: hidden;
  background: rgba(6, 10, 8, 0.55); backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.10);
  font: 10.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.05em; text-transform: uppercase; color: #bcd; user-select: none;
  -webkit-mask-image: linear-gradient(180deg, #000 72%, transparent 100%);
          mask-image: linear-gradient(180deg, #000 72%, transparent 100%);
}
.evlog h4 { margin: 0 0 9px; font-size: 10.5px; letter-spacing: 0.14em; color: #eafff0; font-weight: 600;
  display: flex; align-items: center; cursor: pointer; }
.evlog h4 .tgl { margin-left: auto; padding-left: 16px; opacity: .5; font-weight: 400; }
.evlog.collapsed { width: auto; max-height: none; -webkit-mask-image: none; mask-image: none; }
.evlog.collapsed h4 { margin: 0; }
.evlog.collapsed [data-f="rows"] { display: none; }
.evlog .row { display: flex; gap: 9px; margin-bottom: 7px; }
.evlog .ts { color: #6a8; flex: 0 0 auto; }
.evlog .tx { color: #cfe; }
.evlog .row.shift .tx { color: var(--accent, #8fe04a); }

.pill {
  position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 20;
  display: flex; align-items: center; gap: 9px; max-width: 46vw;
  padding: 7px 15px; border-radius: 999px;
  background: rgba(6, 10, 8, 0.62); backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.10);
  font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.06em; text-transform: uppercase; color: #eafff0; user-select: none;
}
.pill .lvl { display: flex; gap: 2px; align-items: flex-end; height: 12px; }
.pill .lvl i { width: 2px; background: var(--accent, #8fe04a); border-radius: 1px; animation: lvl 0.9s ease-in-out infinite; }
.pill .lvl i:nth-child(2){ animation-delay: .15s } .pill .lvl i:nth-child(3){ animation-delay: .3s }
.pill .lvl i:nth-child(4){ animation-delay: .45s }
.pill .tx { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@keyframes lvl { 0%,100%{ height: 3px } 50%{ height: 12px } }
`

export function createEventLog(accent = '#8fe04a', max = 14) {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  // El acento lo controla :root (--accent) según el mundo activo.
  const pill = document.createElement('div')
  pill.className = 'pill'
  pill.innerHTML = `<span class="lvl"><i></i><i></i><i></i><i></i></span><span class="tx" data-f="now">—</span>`
  document.body.appendChild(pill)
  const nowEl = pill.querySelector('[data-f="now"]')

  const box = document.createElement('div')
  box.className = 'evlog'
  box.innerHTML = `<h4>REGISTRO<span class="tgl">–</span></h4><div data-f="rows"></div>`
  document.body.appendChild(box)
  const rowsEl = box.querySelector('[data-f="rows"]')

  // Minimizar: tap en el título colapsa/expande. En mobile arranca colapsado.
  const h4 = box.querySelector('h4')
  const tgl = h4.querySelector('.tgl')
  function setCollapsed(c) { box.classList.toggle('collapsed', c); tgl.textContent = c ? '+' : '–' }
  h4.addEventListener('click', () => setCollapsed(!box.classList.contains('collapsed')))
  if (window.innerWidth < 700) setCollapsed(true)

  const rows = []
  function push(ev, timeLabel) {
    // La píldora sigue lo que "suena": sonidos e interacciones con texto propio.
    if (ev.short && ev.short !== 'overview' && !ev.short.startsWith('shift')) {
      nowEl.textContent = ev.short
    }
    const row = document.createElement('div')
    row.className = 'row' + (ev.type === 'shift' ? ' shift' : '')
    row.innerHTML = `<span class="ts">${timeLabel}</span><span class="tx"></span>`
    row.querySelector('.tx').textContent = ev.log
    rowsEl.prepend(row)
    rows.unshift(row)
    while (rows.length > max) rows.pop().remove()
  }

  // El REGISTRO es por mundo: al cambiar de mundo se vacía (los eventos del
  // bosque no tienen sentido en la célula) y la píldora vuelve a "—".
  function clear() {
    while (rows.length) rows.pop().remove()
    nowEl.textContent = '—'
  }

  return { push, clear, pill, box }
}
