export function applyFraming(container) {
  if (container.querySelector('.framing')) return
  const el = document.createElement('div')
  el.className = 'framing'
  el.style.cssText = `
    position:absolute; inset:0; pointer-events:none; z-index:5;
    background:
      radial-gradient(circle at center,
        rgba(0,0,0,0) 60%, rgba(0,0,0,0.55) 78%, rgba(3,6,10,1) 92%);
  `
  container.appendChild(el)
}
