// El eje del mundo neurona: el estado cerebral que gobierna la dinámica de la
// red (spec §6). Es el equivalente del ciclo celular de la célula — una máquina
// aparte del reloj que traduce el "estado de sueño" (eco.phase) y el
// "neuromodulador" (eco.weather) en cómo se comporta el swarm:
//
//   · syncTarget  — a cuánta sincronía tiende la red (delta en sueño profundo
//                   late entera; despierta, cada una por su lado).
//   · omegaScale  — velocidad de disparo (lenta dormida, rápida despierta).
//   · firing      — 0 apaga la red (estado DOWN del sueño profundo, o postictal).
//   · excMul/inhMul — el desbalance E/I de la convulsión.
//   · flash       — el destello que barre la red durante la crisis.
//
// Los dos clímax opuestos del mundo (§6.1): N3 profundo = máxima sincronía con
// mínima actividad; la convulsión = sincronía total patológica. Puro, testeable.

// Sincronía objetivo por estado (0..1): alta dormido, baja despierto y en REM.
const SYNC = {
  'quiet wake': 0.35, 'alert wake': 0.20, 'focused': 0.15, 'drowsy': 0.45,
  'N1': 0.55, 'N2 spindles': 0.68, 'N3 slow wave': 0.85, 'N3 deep': 0.95,
  'N2 return': 0.70, 'REM': 0.18, 'REM burst': 0.22, 'waking': 0.32,
}
// Velocidad de disparo por estado: lenta en sueño profundo (delta ~1 Hz),
// rápida en atención (gamma).
const OMEGA = {
  'quiet wake': 1.0, 'alert wake': 1.3, 'focused': 1.7, 'drowsy': 0.85,
  'N1': 0.8, 'N2 spindles': 0.7, 'N3 slow wave': 0.55, 'N3 deep': 0.45,
  'N2 return': 0.7, 'REM': 1.3, 'REM burst': 1.45, 'waking': 1.05,
}
const isDeep = (p) => p === 'N3 deep' || p === 'N3 slow wave'
const isN2 = (p) => p === 'N2 spindles' || p === 'N2 return'

/** @param {object} cfg  { riskRate, seizeExc, seizeInh, seizeDur, postictalDur,
 *                        downMin, downMax, downDur, spindleGap, spindleDur } */
export function createBrain(cfg) {
  return {
    mode: 'normal', timer: 0, risk: 0,
    down: false, downT: cfg.downMin,
    spindle: false, spindleT: cfg.spindleGap,
  }
}

/**
 * @param {object} ctx  { phase, excitatory:boolean, calming:boolean, tension }
 * @returns {{ syncTarget, omegaScale, firing, excMul, inhMul, flash, events }}
 */
export function updateBrain(b, cfg, dt, ctx, rand = Math.random) {
  const events = []
  let syncTarget = SYNC[ctx.phase] ?? 0.3
  let omegaScale = OMEGA[ctx.phase] ?? 1
  let firing = 1, excMul = 1, inhMul = 1, flash = 0

  // ── Convulsión en curso: el desbalance E/I recluta la red ─────────────────
  if (b.mode === 'seizing') {
    b.timer += dt
    excMul = cfg.seizeExc; inhMul = cfg.seizeInh
    syncTarget = 0.98; omegaScale = 0.9; flash = 1
    if (b.timer >= cfg.seizeDur) { b.mode = 'postictal'; b.timer = 0; events.push({ kind: 'postictal' }) }
    return { syncTarget, omegaScale, firing, excMul, inhMul, flash, events }
  }
  // ── Silencio postictal: la red exhausta, muda unos segundos ───────────────
  if (b.mode === 'postictal') {
    b.timer += dt
    firing = 0; syncTarget = 0.08; omegaScale = 0.5
    if (b.timer >= cfg.postictalDur) { b.mode = 'normal'; b.timer = 0; b.risk = 0 }
    return { syncTarget, omegaScale, firing, excMul, inhMul, flash, events }
  }

  // ── Normal: acumula riesgo de convulsión ──────────────────────────────────
  // Tensión alta + neuromodulador excitante suben el riesgo; el gabaérgico lo baja.
  const drive = ctx.tension + (ctx.excitatory ? 0.35 : 0) - (ctx.calming ? 0.6 : 0)
  b.risk = Math.max(0, b.risk + (drive - 0.45) * cfg.riskRate * dt)
  if (b.risk >= 1) {
    b.mode = 'seizing'; b.timer = 0; b.risk = 0
    events.push({ kind: 'seizure' })
    return { syncTarget: 0.98, omegaScale: 0.9, firing: 1, excMul: cfg.seizeExc, inhMul: cfg.seizeInh, flash: 1, events }
  }

  // ── Estados UP/DOWN del sueño profundo: la red se calla entera a ratos ─────
  if (isDeep(ctx.phase)) {
    b.downT -= dt
    if (b.down) {
      firing = 0; syncTarget = Math.max(syncTarget, 0.97)
      if (b.downT <= 0) { b.down = false; b.downT = cfg.downMin + rand() * (cfg.downMax - cfg.downMin); events.push({ kind: 'up' }) }
    } else if (b.downT <= 0) {
      b.down = true; b.downT = cfg.downDur; events.push({ kind: 'down' })
    }
  } else {
    b.down = false
    if (b.downT <= 0) b.downT = cfg.downMin
  }

  // ── Husos de sueño en N2: ráfagas de sincronía de ~1 s ────────────────────
  if (isN2(ctx.phase)) {
    b.spindleT -= dt
    if (b.spindle) {
      syncTarget = Math.max(syncTarget, 0.82)
      if (b.spindleT <= 0) { b.spindle = false; b.spindleT = cfg.spindleGap }
    } else if (b.spindleT <= 0) {
      b.spindle = true; b.spindleT = cfg.spindleDur; events.push({ kind: 'spindle' })
    }
  } else {
    b.spindle = false
  }

  return { syncTarget, omegaScale, firing, excMul, inhMul, flash, events }
}
