// M9 — Fusión y fisión mitocondrial: las mitocondrias del censo (kind
// 'mitochondrion' en `agents`) se fusionan si quedan cerca de forma
// sostenida, y se separan pasado un tiempo — la red mitocondrial real es así
// de dinámica.
//
// CRÍTICO (spec §11): nunca se borra ni reordena `agents`/`roamers` — eso
// rompe `agentNames`, la etiqueta de hover y las estelas, que asumen índices
// estables. Acá solo se oculta/muestra (`group.visible`) y se escala
// (`fusedScale`); cell.js es quien lee `fusedScale` al dibujar y quien debe
// saltear los agentes ocultos al elegir el hover.

const TWO_PI = Math.PI * 2

/**
 * @param {Array<{group, kind}>} agents   censo del render de cell.js (mismo
 *   array; se lee `kind` y se escribe `group.visible`/`fusedScale`)
 * @param {Array<{x,z,vx,vz}>} roamers    posiciones normalizadas, paralelas a `agents`
 * @param {{fuseRadius:number, fuseDelay:number, fusedMin:number, fusedMax:number}} cfg
 * @param {function} rand
 */
export function createMitoFusion(agents, roamers, cfg, rand = Math.random) {
  const mitoIdx = []
  for (let i = 0; i < agents.length; i++) if (agents[i].kind === 'mitochondrion') mitoIdx.push(i)
  // Estado indexado IGUAL que `agents` (no un array compacto aparte): así no
  // hay que traducir índices al leer/escribir agents[i]/roamers[i].
  const state = agents.map(() => ({ hidden: false, fusedInto: -1, fissionAt: 0 }))
  const contact = new Map() // "i-j" (i<j) → segundos de cercanía continua

  /**
   * @param {number} step  dt del frame
   * @param {number} clock  reloj del mundo (mismo que usa cell.js)
   * @returns {Array} eventos de fusión/fisión de este frame (contrato M1)
   */
  function update(step, clock) {
    const events = []
    // ── Fusión: pares cercanos por más de `fuseDelay` seguidos ─────────────
    for (let a = 0; a < mitoIdx.length; a++) {
      const i = mitoIdx[a]
      if (state[i].hidden) continue
      for (let b = a + 1; b < mitoIdx.length; b++) {
        const j = mitoIdx[b]
        if (state[j].hidden) continue
        const key = i + '-' + j
        const dx = roamers[i].x - roamers[j].x, dz = roamers[i].z - roamers[j].z
        const d = Math.hypot(dx, dz)
        if (d >= cfg.fuseRadius) { contact.delete(key); continue }
        const t = (contact.get(key) || 0) + step
        if (t < cfg.fuseDelay) { contact.set(key, t); continue }
        // Fusión: el de menor índice absorbe (arbitrario pero estable —
        // siempre el mismo par se resuelve igual).
        contact.delete(key)
        state[j].hidden = true
        state[j].fusedInto = i
        state[j].fissionAt = clock + cfg.fusedMin + rand() * (cfg.fusedMax - cfg.fusedMin)
        agents[j].group.visible = false
        agents[i].fusedScale = 1.35
        events.push({ type: 'interaction', agent: 'mitocondria', agentType: 'organelle', kind: 'fusion' })
      }
    }
    // ── Fisión: las ocultas que cumplieron su tiempo vuelven a aparecer ────
    for (const j of mitoIdx) {
      if (!state[j].hidden || clock < state[j].fissionAt) continue
      const host = state[j].fusedInto
      state[j].hidden = false
      state[j].fusedInto = -1
      agents[j].group.visible = true
      // El anfitrión solo vuelve a su escala normal si no le queda ninguna
      // otra mitocondria fusionada encima (caso raro con 3+ fusionándose).
      const stillFused = mitoIdx.some((k) => k !== j && state[k].hidden && state[k].fusedInto === host)
      if (!stillFused) agents[host].fusedScale = 1
      // Reaparece PEGADA al anfitrión, con un empujoncito para separarse.
      const ang = rand() * TWO_PI
      roamers[j].x = roamers[host].x + Math.cos(ang) * cfg.fuseRadius * 1.6
      roamers[j].z = roamers[host].z + Math.sin(ang) * cfg.fuseRadius * 1.6
      roamers[j].vx = Math.cos(ang) * 0.02
      roamers[j].vz = Math.sin(ang) * 0.02
      events.push({ type: 'interaction', agent: 'mitocondria', agentType: 'organelle', kind: 'fission' })
    }
    return events
  }

  return { update }
}
