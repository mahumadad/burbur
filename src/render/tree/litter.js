// Hojarasca: el pool de hojas, pétalos y frutos que se desprenden y caen.
// Sustituye a las dos copias de `updateFallingLeaves` que tenían el bosque y la
// ciudad, y agrega lo que ninguna hacía: DERIVA REAL por viento. Antes la caída
// era un vaivén sinusoidal simétrico que no desplazaba nada; ahora la partícula
// se va de verdad para donde sopla.

// Perfil de caída por tipo. `drift` es cuánto la empuja el viento, `vTerm` la
// velocidad de caída y `flutter` cuánto aletea alrededor de su trayectoria.
const PERFIL = {
  leaf: { vTerm: [1.4, 3.0], drift: 2.6, flutter: 1.5, spin: 2.0, kind: 0 },
  petal: { vTerm: [0.5, 1.2], drift: 4.2, flutter: 2.2, spin: 1.2, kind: 1 },
  fruit: { vTerm: [5.0, 6.5], drift: 0.2, flutter: 0.2, spin: 0.6, kind: 2 },
}

/**
 * Convierte anclas de hoja de 9 floats (posición + color verde + color de
 * otoño) al formato de 6 floats (posición + color) que espera `createLitter`,
 * interpolando verde→otoño según `autumn`. El bosque y la ciudad comparten
 * este helper para no duplicar la interpolación cada uno por su lado.
 * @param {number[]|Float32Array} leafAnchors9  [x,y,z, verde(3), otoño(3)] × n
 * @param {Float32Array} out6  destino, tamaño (n*6); se sobrescribe en el lugar
 * @param {number} autumn  0..1
 * @returns {Float32Array} out6
 */
export function tintLeafAnchors(leafAnchors9, out6, autumn) {
  const n = leafAnchors9.length / 9
  for (let i = 0; i < n; i++) {
    const s = i * 9, d = i * 6
    out6[d] = leafAnchors9[s]
    out6[d + 1] = leafAnchors9[s + 1]
    out6[d + 2] = leafAnchors9[s + 2]
    for (let k = 0; k < 3; k++) {
      out6[d + 3 + k] = leafAnchors9[s + 3 + k] +
        (leafAnchors9[s + 6 + k] - leafAnchors9[s + 3 + k]) * autumn
    }
  }
  return out6
}

/**
 * @param {object} opts
 * @param {object} opts.THREE
 * @param {number} opts.count       tamaño del pool
 * @param {number} opts.ground      altura del suelo (se recicla al tocarlo)
 * @param {object} opts.pointUniforms  para compartir uProj/uT con el resto
 */
export function createLitter({ THREE, count = 320, ground = 0, pointUniforms }) {
  const pos = new Float32Array(count * 3).fill(-9999)
  const col = new Float32Array(count * 3)
  const kind = new Float32Array(count)
  const rot = new Float32Array(count)
  const vy = new Float32Array(count)
  const phase = new Float32Array(count)
  const activo = new Uint8Array(count)
  // Presupuesto fraccional POR FUENTE: cada árbol (y los árboles de puntos
  // viejos) acumula el suyo, así emitir per-árbol no se pisa entre fuentes.
  const presupuesto = new Map()
  let head = 0

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('hcol', new THREE.BufferAttribute(col, 3))
  geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1))
  geo.setAttribute('aRot', new THREE.BufferAttribute(rot, 1))

  const mat = new THREE.ShaderMaterial({
    uniforms: { uProj: pointUniforms.uProj, uT: pointUniforms.uT },
    transparent: true, depthWrite: false,
    vertexShader: `
      attribute vec3 hcol; attribute float aKind; attribute float aRot;
      uniform float uProj, uT;
      varying vec3 vC; varying float vKind; varying float vRot;
      void main() {
        vC = hcol; vKind = aKind; vRot = aRot;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float vd = max(-mv.z, 0.001);
        gl_PointSize = clamp(0.85 * uProj / vd, 1.0, 48.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision mediump float;
      varying vec3 vC; varying float vKind; varying float vRot;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv) * 2.0;
        if (vKind > 1.5) {                       // FRUTO: disco lleno
          if (d > 1.0) discard;
          gl_FragColor = vec4(vC, 1.0 - smoothstep(0.85, 1.0, d));
          return;
        }
        if (vKind > 0.5) {                       // PÉTALO: disco suave
          if (d > 1.0) discard;
          gl_FragColor = vec4(vC, 1.0 - smoothstep(0.6, 1.0, d));
          return;
        }
        // HOJA: óvalo apuntado con nervadura, girado por vRot.
        float s = sin(vRot), c = cos(vRot);
        vec2 q = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
        float halfW = 0.34 * (1.0 - (2.0 * q.y) * (2.0 * q.y));
        if (q.y < -0.5 || q.y > 0.5 || abs(q.x) > halfW) discard;
        float a = 1.0 - smoothstep(0.55, 1.0, abs(q.x) / max(halfW, 1e-3));
        float rib = smoothstep(0.06, 0.0, abs(q.x));
        gl_FragColor = vec4(vC * (0.9 + 0.35 * rib), a);
      }`,
  })

  const mesh = new THREE.Points(geo, mat)
  mesh.frustumCulled = false

  /** Suelta UNA partícula desde un ancla `[x,y,z,r,g,b]` del array `anchors`. */
  function emit(tipo, anchors) {
    if (!anchors || !anchors.length) return
    const p = PERFIL[tipo]
    const a = ((Math.random() * (anchors.length / 6)) | 0) * 6
    const i = head; head = (head + 1) % count
    pos[i * 3] = anchors[a]; pos[i * 3 + 1] = anchors[a + 1]; pos[i * 3 + 2] = anchors[a + 2]
    col[i * 3] = anchors[a + 3]; col[i * 3 + 1] = anchors[a + 4]; col[i * 3 + 2] = anchors[a + 5]
    vy[i] = p.vTerm[0] + Math.random() * (p.vTerm[1] - p.vTerm[0])
    phase[i] = Math.random() * 6.2832
    rot[i] = Math.random() * 6.2832
    kind[i] = p.kind
    activo[i] = 1
  }

  /** Ráfaga instantánea: lo que suelta el shake. Se recorta al tamaño del pool. */
  function burst(tipo, n, anchors) {
    const k = Math.min(Math.round(n), count)
    for (let i = 0; i < k; i++) emit(tipo, anchors)
  }

  /**
   * Emisión continua de UNA fuente (un árbol, o el conjunto de árboles de
   * puntos): acumula presupuesto fraccional propio (permite tasas < 1/s) y
   * emite desde SUS anclas. `fuente` distingue el presupuesto de cada emisor.
   * @param {'leaf'|'petal'|'fruit'} tipo
   * @param {number} rate  unidades/segundo
   * @param {number} dt
   * @param {Float32Array} anchors
   * @param {string} fuente  clave del presupuesto (p. ej. 'lush-0', 'puntos')
   */
  function emitRate(tipo, rate, dt, anchors, fuente) {
    if (!(rate > 0) || !anchors || !anchors.length) return
    const clave = tipo + ':' + fuente
    let b = (presupuesto.get(clave) || 0) + rate * dt
    while (b >= 1) { b -= 1; emit(tipo, anchors) }
    presupuesto.set(clave, b)
  }

  /** Avanza SOLO la física de las partículas que ya están cayendo. */
  function step(dt, env) {
    const wind = env.wind || 0
    const wx = Math.cos(env.windDir || 0), wz = Math.sin(env.windDir || 0)
    const t = (pointUniforms.uT.value) || 0

    for (let i = 0; i < count; i++) {
      if (!activo[i]) continue
      const p = kind[i] > 1.5 ? PERFIL.fruit : kind[i] > 0.5 ? PERFIL.petal : PERFIL.leaf
      // Deriva REAL: desplazamiento acumulado en la dirección del viento.
      const d = wind * p.drift * dt
      pos[i * 3] += wx * d
      pos[i * 3 + 2] += wz * d
      // Aleteo: oscilación PERPENDICULAR a la deriva, encima del desplazamiento.
      const f = Math.sin(t * 2.0 + phase[i]) * p.flutter * dt
      pos[i * 3] += -wz * f
      pos[i * 3 + 2] += wx * f
      pos[i * 3 + 1] -= vy[i] * dt
      rot[i] += p.spin * dt
      if (pos[i * 3 + 1] < ground - 0.5) { activo[i] = 0; pos[i * 3 + 1] = -9999 }
    }

    geo.attributes.position.needsUpdate = true
    geo.attributes.hcol.needsUpdate = true
    geo.attributes.aKind.needsUpdate = true
    geo.attributes.aRot.needsUpdate = true
  }

  function dispose() { geo.dispose(); mat.dispose() }

  return { mesh, emit, burst, emitRate, step, dispose }
}
