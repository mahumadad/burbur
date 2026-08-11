import * as THREE from 'three'

// ─── ESPECIES ACUÁTICAS EXCLUSIVAS DEL MUNDO AGUA ──────────────────────────
// Geometría calcada del bundle real de murmur (constructores ye/U/be/xe/Se/W/Ce);
// colores exactos de spec §4.2. `kit` = createAgentKit(rc) del engine
// (src/render/engine/agents3d.js) — no redefine sus primitivas.

export const POND_POOL = [
  ['lamp', 2],
  ['ice', 3],
  ['strider', 3],
  ['orb', 2],
  ['burst', 3],
  ['pins', 2],
]

const DEFAULTS = { rollMul: 0, spinY: 0, speedScale: 1, effR: 3.3, colR: 2, band: 4, hover: 1, dive: 1 }

// Jaula (caja de aristas) + satélites radiales con bolitas en la punta.
// Réplica de ye(e,t,n,r,i) del bundle: t=color jaula, n=colores de los rayos,
// r=color de las bolitas, i=tamaño (escala la jaula y el alcance de los rayos).
function buildCageSatellites(kit, { cageColor, satelliteColors, ballColor, size }) {
  const group = new THREE.Group()
  const cage = new THREE.Group()
  cage.add(kit.edgesOf(new THREE.BoxGeometry(size, size, size), cageColor))
  group.add(cage)
  const count = 5 + ((Math.random() * 3) | 0) // 5–7, igual que en el bundle
  for (let i = 0; i < count; i++) {
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.7 - 0.45, Math.random() - 0.5)
      .normalize()
      .multiplyScalar(size * 0.9 + Math.random() * size * 0.55)
    group.add(kit.fatLine([0, 0, 0, dir.x, dir.y, dir.z], kit.pick(satelliteColors)))
    if (Math.random() < 0.8) {
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.34 + Math.random() * 0.24, 12, 10),
        new THREE.MeshBasicMaterial({ color: ballColor })
      )
      ball.position.copy(dir)
      group.add(ball)
    }
  }
  return { group, effR: size * 0.55, colR: size * 0.85 }
}

function buildLamp(kit) {
  const size = 3
  const { group, effR, colR } = buildCageSatellites(kit, {
    cageColor: 0xeef2ff,
    satelliteColors: [0xffe21a, 0xffe21a, 0xff7a14],
    ballColor: 0x4fa0ff,
    size,
  })
  return {
    group,
    params: { ...DEFAULTS, rollMul: 0.8, effR, colR, band: 2, hover: 1.9, dive: 2.2 + Math.random() * 1.2 },
  }
}

function buildIce(kit) {
  const size = 2.5
  const { group, effR, colR } = buildCageSatellites(kit, {
    cageColor: 0xaee6ff,
    satelliteColors: [0xb9d24a, 0x35e6d2, 0x4fa0ff],
    ballColor: 0x2b8bff,
    size,
  })
  return {
    group,
    params: { ...DEFAULTS, rollMul: 0.8, effR, colR, band: 3, hover: 1.6, dive: 1.7 + Math.random() * 1 },
  }
}

function buildStrider(kit) {
  const group = new THREE.Group()
  const cage = new THREE.Group()
  group.add(cage)

  const edgeColors = [0x1430e8, 0x2b6bff, 0x39c8ff, 0x2bd06a]
  const edgeCount = 3 + ((Math.random() * 2.6) | 0) // 3–5
  for (let i = 0; i < edgeCount; i++) {
    const az = Math.random() * Math.PI
    const el = (Math.random() - 0.5) * 1.4
    const len = 1.3 + Math.random() * 1.1
    const cx = Math.cos(az) * Math.cos(el)
    const cy = Math.sin(el)
    const cz = Math.sin(az) * Math.cos(el)
    cage.add(kit.fatLine([-cx * len, -cy * len, -cz * len, cx * len, cy * len, cz * len], kit.pick(edgeColors)))
  }

  const disc = kit.ringLoop(0.34, 22, 0x7dee32)
  disc.rotation.x = -Math.PI / 2
  cage.add(disc)

  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), new THREE.MeshBasicMaterial({ color: 0x35d06a }))
  cage.add(tip)

  return {
    group,
    params: {
      ...DEFAULTS,
      rollMul: 0.55,
      effR: 1.2,
      colR: 1.9,
      band: 12,
      spinY: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.5),
      speedScale: 0.45,
      hover: 0.42,
      dive: -0.15,
    },
  }
}

function buildOrb(kit) {
  const group = new THREE.Group()

  const discCount = 2 + (Math.random() < 0.6 ? 1 : 0) // 2–3
  for (let i = 0; i < discCount; i++) {
    const color = Math.random() < 0.6 ? 0xffe21a : 0xd8e84a
    const disc = kit.ringLoop(1 + Math.random() * 0.8, 30, color)
    disc.scale.y = 0.5 + Math.random() * 0.25
    disc.rotation.set(Math.random() * 1.2 - 0.6, Math.random() * 3.14, Math.random() * 0.8 - 0.4)
    group.add(disc)
  }

  group.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 12), new THREE.MeshBasicMaterial({ color: 0xe08bd8 })))

  const bubbleCount = 1 + ((Math.random() * 3) | 0) // 1–3
  for (let i = 0; i < bubbleCount; i++) {
    const bubble = new THREE.Mesh(
      new THREE.SphereGeometry(0.2 + Math.random() * 0.14, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xeef2ff })
    )
    bubble.position.set((Math.random() - 0.5) * 3.2, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 3.2)
    group.add(bubble)
  }

  return {
    group,
    params: { ...DEFAULTS, rollMul: 0, effR: 1, colR: 2.2, band: 9, hover: 1.1, dive: 1.2 + Math.random() * 0.9 },
  }
}

function buildBurst(kit) {
  const group = new THREE.Group()
  const cage = new THREE.Group()
  group.add(cage)

  const ringCount = 1 + (Math.random() < 0.6 ? 1 : 0) // 1–2
  for (let r = 0; r < ringCount; r++) {
    const ring = kit.ringLoop(0.55 + r * 0.5 + Math.random() * 0.2, 22, 0x8ee04a)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = r * 0.16
    ring.scale.z = 0.82
    cage.add(ring)
  }

  const rayColors = [0xdfe8ff, 0xcdd8ee, 0x1430e8, 0x2b6bff, 0x9fc0ff]
  const rayCount = 5 + ((Math.random() * 5) | 0) // 5–9
  for (let i = 0; i < rayCount; i++) {
    const az = Math.random() * Math.PI * 2
    const el = 0.18 + Math.random() * 0.6
    const len = 2 + Math.random() * 2.2
    const dx = Math.sin(el) * Math.cos(az)
    const dy = Math.cos(el)
    const dz = Math.sin(el) * Math.sin(az)
    cage.add(kit.fatLine([0, 0, 0, dx * len, dy * len, dz * len], kit.pick(rayColors)))
  }

  const core = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshBasicMaterial({ color: 0xbfe6ff }))
  cage.add(core)

  return {
    group,
    params: {
      ...DEFAULTS,
      rollMul: 0,
      effR: 1,
      colR: 2.4,
      band: 4,
      spinY: (Math.random() < 0.5 ? -1 : 1) * 0.7,
      speedScale: 0.5,
      hover: 0.35,
      dive: -0.18,
    },
  }
}

function buildPins(kit) {
  const group = new THREE.Group()
  const cage = new THREE.Group()
  group.add(cage)

  const baseDisc = kit.ringLoop(0.95 + Math.random() * 0.3, 24, 0x86e03a)
  baseDisc.rotation.x = -Math.PI / 2
  baseDisc.scale.z = 0.8
  cage.add(baseDisc)

  if (Math.random() < 0.4) {
    const topDisc = kit.ringLoop(0.55, 18, 0xa8e84a)
    topDisc.rotation.x = -Math.PI / 2
    topDisc.position.y = 0.14
    topDisc.scale.z = 0.8
    cage.add(topDisc)
  }

  const pinColors = [0x9aa832, 0xb9c24a, 0x8a9a2a]
  const pinCount = 4 + ((Math.random() * 4) | 0) // 4–7
  for (let i = 0; i < pinCount; i++) {
    const az = Math.random() * Math.PI * 2
    const el = 0.08 + Math.random() * 0.42
    const len = 2.2 + Math.random() * 1.8
    const dx = Math.sin(el) * Math.cos(az)
    const dy = Math.cos(el)
    const dz = Math.sin(el) * Math.sin(az)
    const mx = dx * len * 0.6 + (Math.random() - 0.5) * 0.2
    const my = dy * len * 0.6
    const mz = dz * len * 0.6 + (Math.random() - 0.5) * 0.2
    const tx = dx * len + (Math.random() - 0.5) * 0.45
    const ty = dy * len
    const tz = dz * len + (Math.random() - 0.5) * 0.45
    cage.add(kit.fatLine([0, 0, 0, mx, my, mz, mx, my, mz, tx, ty, tz], kit.pick(pinColors)))
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.16 + Math.random() * 0.08, 10, 8),
      new THREE.MeshBasicMaterial({ color: Math.random() < 0.75 ? 0xff7a14 : 0xffb340 })
    )
    tip.position.set(tx, ty, tz)
    cage.add(tip)
  }

  return {
    group,
    params: { ...DEFAULTS, rollMul: 0, effR: 1, colR: 2, band: 6, hover: 0.8, dive: 0.4 + Math.random() * 0.6 },
  }
}

const BUILDERS = {
  lamp: buildLamp,
  ice: buildIce,
  strider: buildStrider,
  orb: buildOrb,
  burst: buildBurst,
  pins: buildPins,
}

export function buildSpecies(kind, kit) {
  const builder = BUILDERS[kind]
  if (!builder) throw new Error(`especie de pond desconocida: ${kind}`)
  return builder(kit)
}
