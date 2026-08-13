import * as THREE from 'three'

// ─── SIMULACIÓN DE ALTURA DEL AGUA (heightfield) ───────────────────────────
// Técnica estándar de agua 2D en GPU (método de doble buffer / ecuación de onda,
// tipo "webgl-water"): una textura guarda la altura del agua; cada frame un
// shader la actualiza leyendo los vecinos, así las ondas se PROPAGAN, se
// INTERFIEREN y REBOTAN en las paredes. Gotas/agentes inyectan altura.
//
//   textura RGBA (half-float):  R = altura actual   G = altura previa
//   nueva = (izq+der+arr+aba)*0.5 - previa ; *= damping   (+ gotas)
//   Islas = pared: su celda queda a 0 y los vecinos-pared reflejan (mix con hc).
//
// Ping-pong entre dos render targets. Se dibuja a una textura chica (p. ej.
// 256²) → barato. El material del agua muestrea `texture` para desplazar/sombrear.

const MAX_DROPS = 28

export function createWaterSim(renderer, { size = 256, halfExtent, mask = null, damping = 0.977, dropRadius = 0.013 }) {
  const rtOpts = {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
  }
  let rtA = new THREE.WebGLRenderTarget(size, size, rtOpts)
  let rtB = new THREE.WebGLRenderTarget(size, size, rtOpts)

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const simScene = new THREE.Scene()
  const uniforms = {
    uPrev: { value: rtA.texture },
    uMask: { value: mask },
    uHasMask: { value: mask ? 1 : 0 },
    uTexel: { value: new THREE.Vector2(1 / size, 1 / size) },
    uDamping: { value: damping },
    // x,y = uv del impacto · z = radio · w = fuerza
    uDrops: { value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uDropCount: { value: 0 },
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      precision highp float;
      #define K ${MAX_DROPS}
      varying vec2 vUv;
      uniform sampler2D uPrev; uniform sampler2D uMask; uniform int uHasMask;
      uniform vec2 uTexel; uniform float uDamping;
      uniform vec4 uDrops[K]; uniform int uDropCount;
      float wallAt(vec2 uv) { return uHasMask == 1 ? step(0.5, texture2D(uMask, uv).r) : 0.0; }
      void main() {
        vec2 dx = vec2(uTexel.x, 0.0), dy = vec2(0.0, uTexel.y);
        vec4 c = texture2D(uPrev, vUv);
        if (wallAt(vUv) > 0.5) {
          // Pared (isla): ESPEJA la altura de los vecinos NO-pared → borde suave,
          // sin escalón que marque un anillo brillante sobre la roca.
          float s = 0.0, wsum = 0.0, m;
          m = 1.0 - wallAt(vUv - dx); s += m * texture2D(uPrev, vUv - dx).r; wsum += m;
          m = 1.0 - wallAt(vUv + dx); s += m * texture2D(uPrev, vUv + dx).r; wsum += m;
          m = 1.0 - wallAt(vUv + dy); s += m * texture2D(uPrev, vUv + dy).r; wsum += m;
          m = 1.0 - wallAt(vUv - dy); s += m * texture2D(uPrev, vUv - dy).r; wsum += m;
          float mh = wsum > 0.0 ? s / wsum : 0.0;
          gl_FragColor = vec4(mh, mh, 0.0, 1.0);
          return;
        }
        float hc = c.r;
        // vecino-pared → refleja (usa la propia altura en vez de la del muro)
        float hL = mix(texture2D(uPrev, vUv - dx).r, hc, wallAt(vUv - dx));
        float hR = mix(texture2D(uPrev, vUv + dx).r, hc, wallAt(vUv + dx));
        float hU = mix(texture2D(uPrev, vUv + dy).r, hc, wallAt(vUv + dy));
        float hD = mix(texture2D(uPrev, vUv - dy).r, hc, wallAt(vUv - dy));
        float nH = (hL + hR + hU + hD) * 0.5 - c.g;
        nH *= uDamping;
        for (int i = 0; i < K; i++) {
          if (i >= uDropCount) break;
          vec4 d = uDrops[i];
          float r = distance(vUv, d.xy) / d.z;
          nH += d.w * exp(-r * r);
        }
        gl_FragColor = vec4(nH, hc, 0.0, 1.0);
      }`,
  })
  simScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat))

  // Limpiar ambos targets a 0.
  const prevRT = renderer.getRenderTarget()
  for (const rt of [rtA, rtB]) { renderer.setRenderTarget(rt); renderer.clear(true, false, false) }
  renderer.setRenderTarget(prevRT)

  const pending = []
  // Inyecta una gota en coordenadas de MUNDO (x,z). str puede ser +/-.
  function drop(worldX, worldZ, str, radius = dropRadius) {
    const u = worldX / (2 * halfExtent) + 0.5
    const v = worldZ / (2 * halfExtent) + 0.5
    if (u < 0 || u > 1 || v < 0 || v > 1) return
    pending.push(u, v, radius, str)
  }

  function update() {
    const n = Math.min(pending.length / 4 | 0, MAX_DROPS)
    for (let i = 0; i < MAX_DROPS; i++) {
      const d = uniforms.uDrops.value[i]
      if (i < n) d.set(pending[i * 4], pending[i * 4 + 1], pending[i * 4 + 2], pending[i * 4 + 3])
      else d.set(0, 0, 0, 0)
    }
    uniforms.uDropCount.value = n
    pending.length = 0
    uniforms.uPrev.value = rtA.texture
    const keep = renderer.getRenderTarget()
    renderer.setRenderTarget(rtB)
    renderer.render(simScene, cam)
    renderer.setRenderTarget(keep)
    const tmp = rtA; rtA = rtB; rtB = tmp // rtA = el más nuevo
  }

  return {
    update, drop, halfExtent, texelSize: 1 / size,
    get texture() { return rtA.texture },
    dispose() { rtA.dispose(); rtB.dispose(); mat.dispose() },
  }
}

// Máscara de islas (blanco = pared) para que las ondas reboten en las orillas.
// `inside(worldX, worldZ)` decide si un punto cae dentro de una isla.
export function buildIslandMask(size, halfExtent, inside) {
  const data = new Uint8Array(size * size * 4)
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const wx = ((i + 0.5) / size - 0.5) * 2 * halfExtent
      const wz = ((j + 0.5) / size - 0.5) * 2 * halfExtent
      const wall = inside(wx, wz) ? 255 : 0
      const k = (j * size + i) * 4
      data[k] = wall; data[k + 1] = 0; data[k + 2] = 0; data[k + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.needsUpdate = true
  return tex
}
