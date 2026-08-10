import * as THREE from 'three'

// ─── LLUVIA: líneas que caen, recicladas al llegar al suelo ───────────────
export function createRain(scene, R, G) {
  const RAIN_N = 1400
  const rainPos = new Float32Array(RAIN_N * 6)
  const rainTop = new Float32Array(RAIN_N * 3)
  const RAIN_H = 46
  for (let i = 0; i < RAIN_N; i++) {
    const a = Math.random() * 6.2832
    const rr = Math.sqrt(Math.random()) * R * 1.1
    rainTop[i * 3] = Math.cos(a) * rr
    rainTop[i * 3 + 1] = G + Math.random() * RAIN_H
    rainTop[i * 3 + 2] = Math.sin(a) * rr
  }
  const rainGeom = new THREE.BufferGeometry()
  rainGeom.setAttribute('position', new THREE.BufferAttribute(rainPos, 3))
  const rainMat = new THREE.LineBasicMaterial({
    color: 0xbcd6e8, transparent: true, opacity: 0, depthWrite: false,
  })
  const rainMesh = new THREE.LineSegments(rainGeom, rainMat)
  rainMesh.frustumCulled = false
  rainMesh.visible = false
  scene.add(rainMesh)

  function update(dt, intensity) {
    rainMesh.visible = intensity > 0.01
    if (!rainMesh.visible) return
    rainMat.opacity = 0.16 + 0.34 * intensity
    const fall = (26 + 42 * intensity) * dt
    const streak = 1.6 + 3.4 * intensity
    for (let i = 0; i < RAIN_N; i++) {
      let y = rainTop[i * 3 + 1] - fall
      if (y < G - 4) y = G + RAIN_H
      rainTop[i * 3 + 1] = y
      const x = rainTop[i * 3], z = rainTop[i * 3 + 2]
      const k = i * 6
      rainPos[k] = x;             rainPos[k + 1] = y;           rainPos[k + 2] = z
      rainPos[k + 3] = x + 0.5;   rainPos[k + 4] = y - streak;  rainPos[k + 5] = z
    }
    rainGeom.getAttribute('position').needsUpdate = true
  }

  return { mesh: rainMesh, update }
}

// ─── NIEVE: copos que caen lento y derivan; densidad por intensidad ───────
export function createSnow(scene, R, G, uProjUniform) {
  const SNOW_N = 5000
  const SNOW_H = 46
  const snowPos = new Float32Array(SNOW_N * 3)
  const snowPhase = new Float32Array(SNOW_N)
  for (let i = 0; i < SNOW_N; i++) {
    const a = Math.random() * 6.2832, rr = Math.sqrt(Math.random()) * R * 1.05
    snowPos[i * 3] = Math.cos(a) * rr
    snowPos[i * 3 + 1] = G + Math.random() * SNOW_H
    snowPos[i * 3 + 2] = Math.sin(a) * rr
    snowPhase[i] = Math.random() * 6.2832
  }
  const snowGeom = new THREE.BufferGeometry()
  snowGeom.setAttribute('position', new THREE.BufferAttribute(snowPos, 3))
  const snowMat = new THREE.ShaderMaterial({
    uniforms: { uProj: uProjUniform },
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    vertexShader: `uniform float uProj; void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = clamp(0.55 * uProj / max(-mv.z, 0.001), 1.5, 34.0);
      gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `void main(){ vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
      if(d > 0.5) discard;
      gl_FragColor = vec4(1.0, 1.0, 1.0, smoothstep(0.5, 0.15, d)); }`,
  })
  const snowMesh = new THREE.Points(snowGeom, snowMat)
  snowMesh.frustumCulled = false
  snowMesh.visible = false
  scene.add(snowMesh)

  function update(dt, clockT, intensity) {
    snowMesh.visible = intensity > 0.01
    if (!snowMesh.visible) return
    const active = Math.floor(intensity * SNOW_N)
    const fall = (7 + 7 * intensity) * dt
    for (let i = 0; i < SNOW_N; i++) {
      if (i >= active) { snowPos[i * 3 + 1] = -9999; continue }
      let y = snowPos[i * 3 + 1] - fall
      if (y < G - 2) { y = G + SNOW_H; }
      snowPos[i * 3 + 1] = y
      // Deriva lateral suave (revoloteo).
      snowPos[i * 3] += Math.sin(clockT * 0.8 + snowPhase[i]) * 6 * dt
      snowPos[i * 3 + 2] += Math.cos(clockT * 0.6 + snowPhase[i] * 1.3) * 6 * dt
    }
    snowGeom.getAttribute('position').needsUpdate = true
  }

  return { mesh: snowMesh, update }
}

// Nieve acumulada sobre rocas/árboles: puntos que crecen con la acumulación.
export function createSnowCaps(scene, capPos, uProjUniform) {
  const capUniforms = { uProj: uProjUniform, uCap: { value: 0 } }
  const capGeom = new THREE.BufferGeometry()
  capGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capPos), 3))
  const capMat = new THREE.ShaderMaterial({
    uniforms: capUniforms, transparent: true, depthWrite: false,
    vertexShader: `uniform float uProj, uCap; varying float vC; void main(){ vC = uCap;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = clamp(0.7 * uCap * uProj / max(-mv.z, 0.001), 0.0, 30.0);
      gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vC; void main(){ if(vC < 0.02) discard;
      vec2 uv = gl_PointCoord - 0.5; if(length(uv) > 0.5) discard;
      gl_FragColor = vec4(0.96, 0.98, 1.0, 1.0); }`,
  })
  const capMesh = new THREE.Points(capGeom, capMat)
  capMesh.frustumCulled = false
  scene.add(capMesh)

  return { setCover(v) { capUniforms.uCap.value = v } }
}
