import * as THREE from 'three'

// Sistema de dibujo tamaño-mundo: un buffer de líneas (flora) y uno de puntos
// (con shader propio de tamaño-mundo + DOF falso + balanceo de vegetación).
export function createDraw(rc) {
  const linePos = []
  const lineCol = []
  const ptPos = []
  const ptCol = []
  const ptSize = []
  const ptPhase = []
  const ptBloom = []

  function pushLine(x1, y1, z1, x2, y2, z2, c1, c2) {
    linePos.push(x1, y1, z1, x2, y2, z2)
    lineCol.push(c1[0], c1[1], c1[2], c2[0], c2[1], c2[2])
  }
  // `bloom` (0 por defecto) marca los puntos que son CABEZA DE FLOR: son los
  // únicos que se cierran con la lluvia fuerte, vía el uniform uBloom.
  function pushPoint(x, y, z, col, size, phase, bloom = 0) {
    ptPos.push(x, y, z)
    ptCol.push(col[0], col[1], col[2])
    ptSize.push(size)
    ptPhase.push(phase || 0)
    ptBloom.push(bloom)
  }

  // Shader de puntos: tamaño en unidades de MUNDO + balanceo + DOF falso.
  const uniforms = {
    uProj: { value: 1000 },
    uT: { value: 0 },
    uFocus: { value: rc.dofFocus },
    uAperture: { value: rc.dofAperture },
    uBloom: { value: 1 },   // 1 = flores abiertas; baja con la lluvia fuerte
  }
  const pointMaterial = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute vec3 hcol; attribute float hsize; attribute float hphs; attribute float hbloom;
      uniform float uProj, uT, uFocus, uAperture, uBloom;
      varying vec3 vC; varying float vSoft;
      void main() {
        vC = hcol;
        vec3 p = position;
        if (hphs > 0.0) {                       // balanceo de vegetación
          float ph = hphs * 6.2831;
          p.x += sin(uT * 0.7 + ph) * 0.42;
          p.z += cos(uT * 0.6 + ph * 1.7) * 0.42;
          p.y += sin(uT * 1.1 + ph * 2.3) * 0.16;
          vC *= 0.92 + 0.12 * sin(uT * 2.0 + ph * 5.0);
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float vd = max(-mv.z, 0.001);
        float coc = abs(vd - uFocus);           // DOF falso: crece al desenfocar
        // Las cabezas de flor se cierran con la lluvia fuerte; el resto no se entera.
        float bloomK = mix(1.0, uBloom, hbloom);
        if (bloomK < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float worldR = (hsize * bloomK) + uAperture * coc * 0.02;
        gl_PointSize = clamp(worldR * uProj / vd, 1.0, 64.0);
        // Difuminado contenido: las flores deben leerse como discos nítidos.
        vSoft = clamp(coc / (uFocus * 1.6), 0.0, 0.45);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision mediump float;
      varying vec3 vC; varying float vSoft;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv) * 2.0;
        if (d > 1.0) discard;
        float edge = mix(0.06, 0.40, vSoft);    // borde casi duro; se ablanda poco
        float a = 1.0 - smoothstep(1.0 - edge, 1.0, d);
        gl_FragColor = vec4(vC, a);
      }`,
  })

  function finalizeLines(scene, material) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePos), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(lineCol), 3))
    scene.add(new THREE.LineSegments(geo, material))
    return geo
  }
  function finalizePoints(scene) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ptPos), 3))
    geo.setAttribute('hcol', new THREE.BufferAttribute(new Float32Array(ptCol), 3))
    geo.setAttribute('hsize', new THREE.BufferAttribute(new Float32Array(ptSize), 1))
    geo.setAttribute('hphs', new THREE.BufferAttribute(new Float32Array(ptPhase), 1))
    geo.setAttribute('hbloom', new THREE.BufferAttribute(new Float32Array(ptBloom), 1))
    const pts = new THREE.Points(geo, pointMaterial)
    pts.frustumCulled = false
    scene.add(pts)
  }

  return { pushPoint, pushLine, pointMaterial, uniforms, finalizePoints, finalizeLines }
}

// Nube de puntos DINÁMICA (per-frame): buffers preasignados, el consumidor
// escribe y llama commit(). DRYea las estelas y los bichos del bosque.
export function createPointCloud(count, material) {
  const pos = new Float32Array(count * 3)
  const col = new Float32Array(count * 3)
  const size = new Float32Array(count)
  const phase = new Float32Array(count)
  const bloom = new Float32Array(count)   // siempre 0: las estelas no son flores
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('hcol', new THREE.BufferAttribute(col, 3))
  geo.setAttribute('hsize', new THREE.BufferAttribute(size, 1))
  geo.setAttribute('hphs', new THREE.BufferAttribute(phase, 1))
  geo.setAttribute('hbloom', new THREE.BufferAttribute(bloom, 1))
  const mesh = new THREE.Points(geo, material)
  mesh.frustumCulled = false
  function commit() {
    geo.attributes.position.needsUpdate = true
    geo.attributes.hcol.needsUpdate = true
    geo.attributes.hsize.needsUpdate = true
    geo.attributes.hphs.needsUpdate = true
  }
  return { mesh, pos, col, size, phase, commit }
}

// Buffer de líneas DINÁMICO: contornos redibujados cada frame (membrana/citoesqueleto).
export function createLineBuffer(maxSegments, material) {
  const pos = new Float32Array(maxSegments * 6)
  const col = new Float32Array(maxSegments * 6)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const mesh = new THREE.LineSegments(geo, material)
  mesh.frustumCulled = false
  let cur = 0
  function begin() { cur = 0 }
  function push(x1, y1, z1, x2, y2, z2, c1, c2) {
    if (cur >= maxSegments) return
    const p = cur * 6, c = cur * 6
    pos[p] = x1; pos[p+1] = y1; pos[p+2] = z1; pos[p+3] = x2; pos[p+4] = y2; pos[p+5] = z2
    col[c] = c1[0]; col[c+1] = c1[1]; col[c+2] = c1[2]
    col[c+3] = c2[0]; col[c+4] = c2[1]; col[c+5] = c2[2]
    cur++
  }
  function commit() {
    geo.setDrawRange(0, cur * 2)
    geo.attributes.position.needsUpdate = true
    geo.attributes.color.needsUpdate = true
  }
  return { mesh, begin, push, commit }
}
