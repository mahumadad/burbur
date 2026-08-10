import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { PALETTE } from '../../config.js'

// ─── AGENTES: jaula de aristas + criatura molecular + tallo ───────────────
// Kit de geometría de agente: jaulas de aristas gruesas + criatura molecular.
export function createAgentKit(rc) {
  // Líneas gruesas de verdad: LineBasicMaterial ignora linewidth en casi todas
  // las plataformas, así que las jaulas usan LineMaterial (grosor en píxeles).
  const fatMaterials = []
  function fatLine(positions, color) {
    const mat = new LineMaterial({ color, linewidth: rc.agentLineWidth })
    mat.resolution.set(1, 1)
    fatMaterials.push(mat)
    const geo = new LineSegmentsGeometry()
    geo.setPositions(positions)
    const seg = new LineSegments2(geo, mat)
    seg.computeLineDistances()
    return seg
  }
  function edgesOf(geometry, color) {
    const e = new THREE.EdgesGeometry(geometry)
    const arr = Array.from(e.attributes.position.array)
    e.dispose()
    geometry.dispose()
    return fatLine(arr, color)
  }
  function ringLoop(radius, segments, color) {
    const pos = []
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2
      const b = ((i + 1) / segments) * Math.PI * 2
      pos.push(Math.cos(a) * radius, 0, Math.sin(a) * radius,
        Math.cos(b) * radius, 0, Math.sin(b) * radius)
    }
    return fatLine(pos, color)
  }
  const pick = (arr) => arr[(Math.random() * arr.length) | 0]

  /**
   * Criatura interna: núcleo naranja + 3–4 satélites en direcciones FIJAS
   * (por eso se lee igual desde cualquier ángulo), unidos por enlaces.
   */
  function creature(t) {
    const g = new THREE.Group()
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.6 * t, 16, 12),
      new THREE.MeshBasicMaterial({ color: PALETTE.orange })))
    const dirs = [
      new THREE.Vector3(1, 0.5, 0.3), new THREE.Vector3(-0.8, -0.4, 0.6),
      new THREE.Vector3(0.25, -0.95, -0.55), new THREE.Vector3(0.7, 0.6, -0.7),
    ]
    const cols = [PALETTE.orange, PALETTE.magenta, PALETTE.white, PALETTE.cyanSat]
    const k = 3 + (Math.random() < 0.5 ? 1 : 0)
    const seg = []
    for (let i = 0; i < k; i++) {
      const p = dirs[i].clone().normalize().multiplyScalar((1.5 + Math.random() * 0.45) * t)
      const s = new THREE.Mesh(
        new THREE.SphereGeometry((0.3 + Math.random() * 0.12) * t, 12, 10),
        new THREE.MeshBasicMaterial({ color: cols[(i + ((Math.random() * 4) | 0)) % 4] }))
      s.position.copy(p)
      g.add(s)
      seg.push(0, 0, 0, p.x, p.y, p.z)
    }
    g.add(fatLine(seg, PALETTE.bond))
    return g
  }

  /** Cuña/planeador: prisma triangular de 9 aristas. */
  function wedge(e) {
    const t = 5.2, n = 2.2, r = 1.6, lo = -0.7, hi = 0.8
    const P = (x, y, z) => [x * e, y * e, z * e]
    const s = P(0, lo, t), c = P(-n, lo, -r), l = P(n, lo, -r)
    const u = P(0, hi, t * 0.45), d = P(-n * 0.5, hi, -r), f = P(n * 0.5, hi, -r)
    const seg = (a, b) => [...a, ...b]
    return [
      ...seg(s, c), ...seg(c, l), ...seg(l, s),
      ...seg(u, d), ...seg(d, f), ...seg(f, u),
      ...seg(s, u), ...seg(c, d), ...seg(l, f),
    ]
  }

  function setResolution(w, h) {
    for (const m of fatMaterials) m.resolution.set(w, h)
  }

  return { fatLine, edgesOf, ringLoop, creature, wedge, pick, fatMaterials, setResolution }
}

// ─── MOTION: rodado/planeo/giro de los agentes, solo por flags ────────────
export function updateAgentMotion(agents, roamers, R, step, worldPos, tmp) {
  const { up, dir, axis, q } = tmp
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i]
    const r = roamers[i]
    a.group.position.set(worldPos[i * 3], worldPos[i * 3 + 1], worldPos[i * 3 + 2])

    // Velocidad en unidades de mundo (los roamers están normalizados).
    const wvx = r.vx * R, wvz = r.vz * R
    const wspeed = Math.hypot(wvx, wvz)
    if (a.glide) {
      // Planeador: se orienta hacia donde va.
      if (wspeed > 0.05) a.group.rotation.y = Math.atan2(wvx, wvz)
    } else if (a.rollMul > 0 && a.cage && wspeed > 1e-4) {
      // Rueda como una esfera: eje = arriba × dirección, ángulo = dist/effR.
      dir.set(wvx, 0, wvz).normalize()
      axis.crossVectors(up, dir)
      if (axis.lengthSq() < 1e-5) axis.set(1, 0, 0)
      axis.normalize()
      q.setFromAxisAngle(axis, (wspeed * step) / a.effR * a.rollMul)
      a.cage.quaternion.premultiply(q)
    } else if (a.spinY) {
      a.group.rotation.y += a.spinY * step
    }
  }
}
