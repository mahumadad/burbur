// Capa de "mundo": agentes ligeros que modulan atmósfera y sonido.
// Puro: sin three/tone/DOM.
export function createAmbient(cfg) {
  let t = 0
  const omega = (2 * Math.PI) / cfg.windPeriodSec
  function update(dt) {
    t += dt
    const wind = 0.5 + 0.5 * Math.sin(omega * t)
    const rate = cfg.cricketBaseRate * (0.6 + 0.8 * wind)
    const cricket = Math.random() < rate * dt
    const owl = Math.random() < cfg.owlChancePerSec * dt
    return { wind, cricket, owl }
  }
  return { update }
}
