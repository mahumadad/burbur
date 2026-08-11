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

  // ─── Jaulas prismáticas ─────────────────────────────────────────────────
  /** Caja de aristas gruesas (cubo si w=h=d). */
  function boxCage(w, h, d, color) {
    return edgesOf(new THREE.BoxGeometry(w, h, d), color)
  }
  /**
   * Paralelepípedo alto ("caja con estantes"): las aristas de la caja + `rungs`
   * travesaños horizontales (rectángulos internos) a alturas repartidas.
   */
  function parallelepipedCage(w, h, d, color, rungs = 2) {
    const g = new THREE.Group()
    g.add(edgesOf(new THREE.BoxGeometry(w, h, d), color))
    const hw = w / 2, hd = d / 2, seg = []
    const c = [[-hw, hd], [hw, hd], [hw, -hd], [-hw, -hd]] // esquinas en XZ
    for (let r = 1; r <= rungs; r++) {
      const y = -h / 2 + (h * r) / (rungs + 1)
      for (let i = 0; i < 4; i++) {
        const a = c[i], b = c[(i + 1) % 4]
        seg.push(a[0], y, a[1], b[0], y, b[1])
      }
    }
    g.add(fatLine(seg, color))
    return g
  }
  /**
   * Pirámide cortada (frustum de base cuadrada): `CylinderGeometry` con 4
   * segmentos radiales → 8 aristas de los cuadrados + 4 diagonales laterales.
   */
  function frustumCage(bottom, top, h, color) {
    return edgesOf(new THREE.CylinderGeometry(top, bottom, h, 4), color)
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
   * Molécula interna: núcleo (cols[0]) + 3–5 satélites en direcciones FIJAS
   * (se lee igual desde cualquier ángulo), coloreados con el resto del set.
   * Enlaces núcleo→satélite y algunos satélite↔satélite para que se lea como
   * molécula (no como estrella). `cols[0]` es el color de especie del núcleo.
   */
  function creature(t, cols = [PALETTE.orange, PALETTE.magenta, PALETTE.white, PALETTE.cyanSat]) {
    const g = new THREE.Group()
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.66 * t, 16, 12),
      new THREE.MeshBasicMaterial({ color: cols[0] })))
    const dirs = [
      new THREE.Vector3(1, 0.5, 0.3), new THREE.Vector3(-0.8, -0.4, 0.6),
      new THREE.Vector3(0.25, -0.95, -0.55), new THREE.Vector3(0.7, 0.6, -0.7),
      new THREE.Vector3(-0.55, 0.85, 0.2),
    ]
    const sat = cols.length > 1 ? cols.slice(1) : cols
    const k = 3 + ((Math.random() * 3) | 0) // 3..5
    const pts = []
    for (let i = 0; i < k; i++) {
      const p = dirs[i].clone().normalize().multiplyScalar((1.5 + Math.random() * 0.45) * t)
      const s = new THREE.Mesh(
        new THREE.SphereGeometry((0.34 + Math.random() * 0.14) * t, 12, 10),
        new THREE.MeshBasicMaterial({ color: sat[i % sat.length] }))
      s.position.copy(p)
      g.add(s)
      pts.push(p)
    }
    const seg = []
    for (const p of pts) seg.push(0, 0, 0, p.x, p.y, p.z) // núcleo→satélite
    for (let i = 0; i + 1 < pts.length; i += 2) {           // algunos satélite↔satélite
      const a = pts[i], b = pts[i + 1]
      seg.push(a.x, a.y, a.z, b.x, b.y, b.z)
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

  return {
    fatLine, edgesOf, ringLoop, boxCage, parallelepipedCage, frustumCage,
    creature, wedge, pick, fatMaterials, setResolution,
  }
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
