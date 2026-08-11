// Proteínas motoras (kinesina y dineína) caminando sobre los microtúbulos de rails.js.
// Kinesina (dir=+1) camina hacia la periferia; dineína (dir=-1) hacia el centrosoma.
// Como los rieles tienen inestabilidad dinámica (crecen y colapsan), un motor puede
// quedar "caminando sobre el aire" cuando el riel se encoge por debajo de él: ahí se
// suelta y se reengancha en otro riel, igual que se desprende espontáneamente de a ratos.
// Puro: coordenadas (x,z) normalizadas.

/**
 * Reengancha un motor: nuevo riel al azar, t en el extremo opuesto a su nuevo dir,
 * y se re-sortea dir/cargo. `anchorLen` guarda el largo del riel al reengancharse,
 * para poder detectar más adelante si el riel colapsó por debajo del motor.
 */
function reattach(m, net, cfg, rand) {
  m.rail = Math.floor(rand() * net.rails.length)
  m.dir = rand() < 0.5 ? 1 : -1
  m.t = m.dir === 1 ? 0 : 1
  m.cargo = rand() < cfg.cargoChance
  m.anchorLen = net.rails[m.rail].len
}

/**
 * @param {object} cfg  { count, speed, detachChance, cargoChance }
 * @param {number} railCount  cantidad de rieles de la red (net.rails.length)
 */
export function createMotors(cfg, railCount, rand = Math.random) {
  const motors = []
  for (let i = 0; i < cfg.count; i++) {
    motors.push({
      rail: Math.floor(rand() * railCount),
      t: rand(),
      dir: rand() < 0.5 ? 1 : -1,
      speed: cfg.speed,
      cargo: rand() < cfg.cargoChance,
      attached: true,
    })
  }
  return motors
}

export function updateMotors(motors, net, cfg, dt, rand = Math.random) {
  for (const m of motors) {
    // Motor recién creado (sin referencia todavía): la sincroniza contra el riel real.
    if (m.anchorLen === undefined) m.anchorLen = net.rails[m.rail].len

    // Desprendimiento espontáneo: los motores reales se sueltan solos de a ratos.
    if (rand() < cfg.detachChance * dt) { reattach(m, net, cfg, rand); continue }

    // El riel colapsó por debajo de donde camina el motor: se suelta y reengancha.
    if (m.t * m.anchorLen > net.rails[m.rail].len) { reattach(m, net, cfg, rand); continue }

    m.t += m.dir * m.speed * dt
    if (m.t < 0) m.t = 0
    else if (m.t > 1) m.t = 1

    // Llegó a un extremo del riel: se suelta y reengancha en otro.
    if (m.t <= 0 || m.t >= 1) reattach(m, net, cfg, rand)
  }
  return motors
}

/** Posición del motor proyectada sobre su riel actual. */
export function motorPosition(motor, net) {
  const r = net.rails[motor.rail]
  return {
    x: net.origin.x + Math.cos(r.ang) * r.len * motor.t,
    z: net.origin.z + Math.sin(r.ang) * r.len * motor.t,
  }
}
