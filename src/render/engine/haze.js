import * as THREE from 'three'

// ─── NEBLINA aditiva (el halo de color del mundo) ─────────────────────────
export function createHaze(scene, { R, G, count, color, alpha, heightFn }) {
  const hazeUniforms = {
    uProj: { value: 1000 },
    uColor: { value: new THREE.Vector3(...color) },
    uAlpha: { value: alpha },
  }
  {
    const pos = [], siz = []
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.2832
      // Contenida dentro de la isla: fuera de ella el fondo queda negro puro.
      const rr = Math.sqrt(Math.random()) * R * 0.92
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr
      pos.push(x, G + heightFn(x, z) + 0.3 + Math.random() * 9, z)
      siz.push(2.4 + Math.random() * 5.2)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('hsize', new THREE.BufferAttribute(new Float32Array(siz), 1))
    const mat = new THREE.ShaderMaterial({
      uniforms: hazeUniforms,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float hsize; uniform float uProj;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(hsize * uProj / max(-mv.z, 0.001), 1.0, 96.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        precision mediump float;
        uniform vec3 uColor; uniform float uAlpha;
        void main() {
          vec2 uv = gl_PointCoord - 0.5; float d2 = dot(uv, uv);
          if (d2 > 0.25) discard;
          float a = 1.0 - sqrt(d2) * 2.0; a = a * a * uAlpha;
          gl_FragColor = vec4(uColor, 1.0) * a;
        }`,
    })
    const h = new THREE.Points(geo, mat)
    h.frustumCulled = false
    scene.add(h)
  }

  return { uniforms: hazeUniforms }
}
