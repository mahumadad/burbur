import * as THREE from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { createStage } from './stage.js'
import { createDraw, createPointCloud } from './engine/points.js'
import { fbm } from './noise.js'
import { tideLevel } from '../sim/tide.js'
import { anemoneOpen } from '../sim/anemone.js'
import { createLimpet, updateLimpet, LIMPET_CFG } from '../sim/limpet.js'
import { createAgentKit } from './engine/agents3d.js'
import { createTrails } from './engine/trails.js'
import { createSchools, updateSchools, scatterFish } from '../sim/fish.js'
import { createRoamers, updateRoamers } from '../sim/wander.js'
import { buildSpecies } from './pond/species.js'
import { createSeastar, updateSeastar, SEASTAR_CFG } from '../sim/seastar.js'
import { HASH_NOISE_FBM, CAUSTIC_FIELD, GERSTNER, PROC_NORMAL } from './engine/waterChunks.js'

// Mundo POZA DE MAREA: una poza rocosa de la costa chilena vista DESDE ABAJO
// DEL AGUA — la primera cámara volteada del proyecto. Una taza de roca con un
// portillo bajo por donde entra el mar; la cámara vive dentro de la cavidad, a
// media agua, mirando en diagonal hacia la superficie.
// Ver docs/superpowers/specs/2026-08-13-mundo-poza-marea-design.md
export function createTidepool(container, cfg, agentNames = []) {
  const rc = cfg.render
  const P = cfg.tidepool
  const q = Math.random

  const W = P.water
  // Uniforms compartidos por TODOS los materiales de agua (techo, lecho, roca):
  // un solo objeto `{value}` por uniform, referenciado desde cada shader, para
  // que actualizarlo una vez por frame alcance a todos. Ver spec §3.
  const waterShared = {
    uTime: { value: 0 },
    uLight: { value: 1 },
    uSurfaceY: { value: P.surfaceMax },
    uCausticTint: { value: new THREE.Vector3(...W.causticColor) },
    uCausticScale: { value: W.causticScale },
    uCausticSpeed: { value: W.causticSpeed },
  }
  // Inyecta la cáustica procedural en un MeshBasicMaterial de geometría (lecho o
  // roca): agrega el varying de posición-mundo y suma la red de luz, atenuada por
  // la profundidad y apagada de noche.
  function injectCaustics(mat, strength = 0.5) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = waterShared.uTime
      shader.uniforms.uLight = waterShared.uLight
      shader.uniforms.uSurfaceY = waterShared.uSurfaceY
      shader.uniforms.uCausticTint = waterShared.uCausticTint
      shader.uniforms.uCausticScale = waterShared.uCausticScale
      shader.uniforms.uCausticSpeed = waterShared.uCausticSpeed
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n varying vec3 vWorldPosC;')
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\n vWorldPosC = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          '#include <common>\n varying vec3 vWorldPosC;\n uniform float uTime, uLight, uSurfaceY, uCausticScale, uCausticSpeed;\n uniform vec3 uCausticTint;\n' + HASH_NOISE_FBM + CAUSTIC_FIELD)
        .replace('#include <dithering_fragment>',
          `#include <dithering_fragment>
           float depthAtten = clamp(1.0 - (uSurfaceY - vWorldPosC.y) / 30.0, 0.15, 1.0);
           float cau = caustics(vWorldPosC.xz * uCausticScale, uTime * uCausticSpeed);
           gl_FragColor.rgb += uCausticTint * cau * depthAtten * uLight * ${strength.toFixed(3)};`)
    }
    mat.customProgramCacheKey = () => 'tidepool-caustic-' + strength
    return mat
  }

  // ─── EL FILTRO SUBMARINO ──────────────────────────────────────────────────
  // Lo que el ojo hace bajo el agua: el azul se come el rojo con la distancia,
  // la luz de la superficie se abre en abanico, y todo tiembla un poco.
  const seaUniforms = {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uTint: { value: 0.55 },     // fuerza del grado de color
    uWobble: { value: 0.0016 }, // refracción
    uLight: { value: 1 },       // cuánta luz hay arriba (apaga los rayos de noche)
    uChromatic: { value: W.chromatic },
    uSnellPos: { value: new THREE.Vector2(0.5, 0.86) },  // pos en pantalla de la ventana (se actualiza)
  }
  const seaPass = new ShaderPass({
    uniforms: seaUniforms,
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform float uTime, uTint, uWobble, uLight, uChromatic;
      uniform vec2 uSnellPos;
      void main(){
        // Refracción: la imagen tiembla como vista a través del agua.
        vec2 uv = vUv;
        uv.x += sin(uv.y * 22.0 + uTime * 1.3) * uWobble;
        uv.y += cos(uv.x * 18.0 - uTime * 1.1) * uWobble;
        // Dispersión cromática hacia los bordes (el agua separa rojo y azul).
        vec2 dir = uv - 0.5;
        float ca = uChromatic * dot(dir, dir);
        float r = texture2D(tDiffuse, clamp(uv + dir * ca, 0.0, 1.0)).r;
        float g = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).g;
        float b = texture2D(tDiffuse, clamp(uv - dir * ca, 0.0, 1.0)).b;
        vec3 col = vec3(r, g, b);
        // God-rays: marcha hacia la ventana de Snell proyectada.
        vec2 delta = (uv - uSnellPos) * (0.06 / float(${W.rayCount}));
        vec2 p = uv;
        float shaft = 0.0;
        for (int i = 0; i < ${W.rayCount}; i++) {
          p -= delta;
          shaft += texture2D(tDiffuse, clamp(p, 0.0, 1.0)).g;
        }
        shaft /= float(${W.rayCount});
        col += vec3(0.20, 0.46, 0.52) * shaft * shaft * 0.85 * uLight;
        // Tinte TURQUESA que se ahonda con la distancia (agua clara, no azul oscuro).
        float d = length(vUv - 0.5) * 1.42;
        vec3 water = vec3(0.14, 0.52, 0.52);
        col = mix(col, col * water * 2.2, clamp(d * uTint, 0.0, 0.7));
        gl_FragColor = vec4(col, 1.0);
      }`,
  })

  // La cámara arranca dentro de la taza, algo descentrada, mirando hacia arriba.
  const stage = createStage(container, {
    ...cfg,
    stage: {
      // orbR cerca del muro: con la cámara pegada a un borde, la roca de ese lado
      // llena el marco (nítida, oscura) y la del frente queda como silueta en el
      // glow turquesa — la composición de "estoy adentro de la poza".
      camera: { orbR: 27, theta: 0.9, phi: 1.78, target: [0, -18, 0] },
      // La cámara mira al BENTOS (target y=-20) tirando un poco HACIA ARRIBA, para
      // que la superficie brillante quede de techo. maxDist acotado: alejarse más
      // metía todo en la niebla. Banda polar ancha (target hondo → sumergida con
      // margen). Azimut libre.
      orbit: { minDist: 8, maxDist: 30, minPolar: Math.PI * 0.42, maxPolar: Math.PI * 0.60 },
      breathe: { baseY: -18, ampY: 1.5 },
      // Agua TURQUESA CLARA: niebla turquesa MUY tenue (si sube, tiñe de turquesa
      // las rocas lejanas y se ven "del color del agua"), fondo turquesa profundo.
      fog: { color: 0x1f8f88, density: 0.004 },
      background: 0x0e5f63,
      addPass: (composer) => composer.insertPass(seaPass, 1),
    },
  })
  const { scene } = stage
  // Cielo/agua que cambian con el DÍA: de día, turquesa brillante y soleado; de
  // noche, oscuro. El fondo y la niebla se interpolan por el brillo del ecosistema
  // (eco.gain) para que se VEA amanecer y anochecer.
  const DAY_BG = new THREE.Color(0x3fb8c2), NIGHT_BG = new THREE.Color(0x05141c)
  const DAY_FOG = new THREE.Color(0x2aa89a), NIGHT_FOG = new THREE.Color(0x08222a)
  const draw = createDraw(rc)
  const { pushPoint, pushLine, uniforms: pointUniforms } = draw
  // El DOF del shader de puntos viene calibrado para los mundos AÉREOS (foco a
  // ~95 de distancia). Bajo el agua todo está cerca (10–40), así que ese foco
  // lejano inflaba cada punto en un disco enorme y borroso (plancton, burbujas,
  // bolones parecían pelotas gigantes). Acercamos el foco y bajamos la apertura
  // → puntos nítidos y del tamaño real.
  pointUniforms.uFocus.value = 22
  pointUniforms.uAperture.value = 0.05

  // ─── LA TAZA: pared anular de roca + lecho ────────────────────────────────
  // Roca mojada de la costa: gris-carbón OSCURO (volcánico), como las fotos.
  const ROCK_LO = [0.025, 0.030, 0.038]
  const ROCK_HI = [0.11, 0.12, 0.14]
  {
    const R = P.bowlRadius
    const geo = new THREE.CylinderGeometry(R * 1.5, R * 0.55, P.wallTop - P.bedY, 96, 24, true)
    const pos = geo.attributes.position
    // 1) Desplazamiento: relieve grande + dentado fino (la silueta no puede ser lisa).
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      const bump = (fbm(x * 0.09 + 4, z * 0.09 - 2, 3) - 0.5) * 5.5
        + (fbm(x * 0.35 + 21, (z + y) * 0.35, 2) - 0.5) * 2.2
      const ang = Math.atan2(z, x)
      // El PORTILLO: un sector del borde queda más bajo, y por ahí entra el mar.
      let dAng = Math.abs(ang - P.portillo.ang)
      if (dAng > Math.PI) dAng = Math.PI * 2 - dAng
      const gate = Math.max(0, 1 - dAng / P.portillo.width)
      const rr = Math.hypot(x, z) || 1
      pos.setX(i, x + (x / rr) * bump)
      pos.setZ(i, z + (z / rr) * bump)
      pos.setY(i, y - gate * gate * P.wallTop * 1.4)
    }
    geo.translate(0, (P.wallTop + P.bedY) / 2, 0)
    // 2) Sombreado por NORMALES horneado en el vertex-color: las facetas que miran
    // a la luz (arriba) se aclaran, las grietas se hunden en sombra. Esto es lo
    // que hace que la pared se LEA como roca y no como bruma sin forma.
    geo.computeVertexNormals()
    const nrmA = geo.attributes.normal
    const cols = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      const lit = Math.max(0, nrmA.getX(i) * 0.25 + nrmA.getY(i) * 0.9 + nrmA.getZ(i) * 0.22)
      const t = Math.max(0, Math.min(1, (y - P.bedY) / (P.wallTop - P.bedY)))
      const mott = 0.45 + fbm(x * 0.5 + 11, (y + z) * 0.5, 3) * 0.9
      const shade = (0.35 + 0.95 * lit) * mott
      let r = (ROCK_LO[0] + (ROCK_HI[0] - ROCK_LO[0]) * t) * shade
      let g = (ROCK_LO[1] + (ROCK_HI[1] - ROCK_LO[1]) * t) * shade
      let b = (ROCK_LO[2] + (ROCK_HI[2] - ROCK_LO[2]) * t) * shade
      // Parches ROJIZOS de algas incrustantes en la mitad alta (como la foto).
      const alg = fbm(x * 0.33 + 40, z * 0.33 - y * 0.2, 3)
      if (alg > 0.60 && t > 0.3) {
        const m = Math.min(1, (alg - 0.60) * 5)
        r = r + (0.34 * shade - r) * m
        g = g + (0.09 * shade - g) * m
        b = b + (0.07 * shade - b) * m
      }
      cols[i * 3] = r; cols[i * 3 + 1] = g; cols[i * 3 + 2] = b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    // Pared: cáusticas MUY débiles (0.12) para que la roca quede OSCURA (no lavada
    // de turquesa). El fondo pálido sí las lleva fuertes.
    scene.add(new THREE.Mesh(geo, injectCaustics(new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: true,
    }), 0.12)))
  }
  // Lecho de la poza.
  {
    const geo = new THREE.PlaneGeometry(P.bowlRadius * 3, P.bowlRadius * 3, 60, 60)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    const cols = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      // Relieve del lecho: dunas suaves de baja frecuencia + rugosidad fina, para
      // que el fondo tenga geografía y no sea un plato liso.
      pos.setY(i, P.bedY + (fbm(x * 0.035 + 2, z * 0.035 - 4, 2) - 0.5) * 8.0
        + (fbm(x * 0.11 + 9, z * 0.11 + 5, 3) - 0.5) * 3.0)
      // ARENA VOLCÁNICA OSCURA, a juego con la roca (costa de basalto): gris
      // profundo con mottling. Las cáusticas fuertes (0.6) resaltan encima.
      const s = 0.5 + fbm(x * 0.2, z * 0.2, 2) * 0.5
      cols[i * 3] = 0.055 + s * 0.085
      cols[i * 3 + 1] = 0.065 + s * 0.095
      cols[i * 3 + 2] = 0.07 + s * 0.105
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    // Fondo pálido: cáusticas FUERTES (la red de luz sobre la arena).
    scene.add(new THREE.Mesh(geo, injectCaustics(new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: true,
    }), 0.6)))
  }
  // Bolones sueltos por el fondo.
  for (let i = 0; i < 120; i++) {
    const a = q() * 6.2832, r = Math.sqrt(q()) * P.bowlRadius * 0.98
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    pushPoint(x, P.bedY + 0.4 + q() * 0.9, z, [0.18, 0.2, 0.22], 0.4 + q() * 1.1, 0)
  }
  // ─── PARED DE ROCA: unas pocas masas GRANDES pegadas al borde de la taza (NO en
  // el centro), que se leen como la pared rocosa que rodea la poza —como las fotos—.
  // Suben desde el lecho por la pared hacia la superficie. Al estar en la periferia
  // (radio ≥ el de la cámara) nunca quedan entre la cámara y el centro: dan roca
  // visible sin tapar el medio (el error de los islotes sueltos anteriores).
  // Se GUARDAN en `rockMasses` para poder encostrarlas de fauna del intermareal.
  const rockMasses = []
  {
    const N = 7
    for (let i = 0; i < N; i++) {
      const a = (i / N) * 6.2832 + q() * 0.5
      const r = (0.74 + q() * 0.2) * P.bowlRadius
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r
      const rx = 8 + q() * 8, rz = 6 + q() * 6
      const ry = 14 + q() * 14                     // altas: trepan la pared
      rockMasses.push({ cx, cy: P.bedY + ry * 0.5, cz, rx, ry, rz, rot: a })
      const geo = new THREE.IcosahedronGeometry(1, 4)
      const gp = geo.attributes.position
      const seed = q() * 100
      // 1) Desplazar: masa grande + dentado fino (silueta rugosa, no huevo liso).
      for (let k = 0; k < gp.count; k++) {
        const px = gp.getX(k), py = gp.getY(k), pz = gp.getZ(k)
        const d = 1 + (fbm(px * 1.4 + seed, pz * 1.4 - py + seed, 3) - 0.5) * 0.8
          + (fbm(px * 4.5 + seed, (pz - py) * 4.5, 2) - 0.5) * 0.28
        gp.setXYZ(k, px * d * rx, py * d * ry, pz * d * rz)
      }
      // 2) Sombreado por normales horneado en color (facetas a la luz claras,
      // grietas en sombra) + parches rojizos de algas incrustantes arriba.
      geo.computeVertexNormals()
      const bn = geo.attributes.normal
      const cols = new Float32Array(gp.count * 3)
      for (let k = 0; k < gp.count; k++) {
        const wy = gp.getY(k)
        const lit = Math.max(0, bn.getX(k) * 0.25 + bn.getY(k) * 0.9 + bn.getZ(k) * 0.22)
        const t = Math.max(0, Math.min(1, (wy + ry) / (2 * ry)))
        const mott = 0.45 + fbm(gp.getX(k) * 0.3 + seed, gp.getZ(k) * 0.3 - wy * 0.2, 3) * 0.9
        const shade = (0.3 + 1.0 * lit) * mott
        let r = (0.05 + t * 0.13) * shade * 0.95
        let g2 = (0.05 + t * 0.13) * shade
        let b = (0.05 + t * 0.13) * shade * 1.12
        const alg = fbm(gp.getX(k) * 0.4 + seed + 7, gp.getZ(k) * 0.4 + wy * 0.15, 3)
        if (alg > 0.62 && t > 0.4) {
          const m = Math.min(1, (alg - 0.62) * 5)
          r += (0.34 * shade - r) * m; g2 += (0.09 * shade - g2) * m; b += (0.07 * shade - b) * m
        }
        cols[k * 3] = r; cols[k * 3 + 1] = g2; cols[k * 3 + 2] = b
      }
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
      const mesh = new THREE.Mesh(geo, injectCaustics(new THREE.MeshBasicMaterial({
        vertexColors: true, side: THREE.DoubleSide, fog: true,
      }), 0.12))   // roca oscura: cáusticas muy débiles
      mesh.position.set(cx, P.bedY + ry * 0.5, cz)
      mesh.rotation.y = a
      scene.add(mesh)
    }
  }

  stage.setResizeHook((m) => { pointUniforms.uProj.value = m.proj })

  // ─── TECHO DE AGUA: la superficie vista DESDE ABAJO ───────────────────────
  // Calca el shader de agua de la laguna (render/pond.js) pero leído por su cara
  // inferior: lo que allá era brillo del sol acá es la ventana de Snell — el
  // disco claro justo encima — y el resto de la superficie devuelve la luz del
  // fondo por reflexión total. Las cáusticas son la misma malla senoidal.
  const RIPPLES = 18
  // Genera el cuerpo GLSL que suma las N olas Gerstner de la config. Los
  // parámetros son estáticos, así que se hornean como constantes (sin arrays de
  // uniforms). `choppiness` (uniform) escala la amplitud en runtime.
  function gerstnerSumGLSL(waves) {
    let body = 'vec3 gerstnerSum(vec2 p, float t, float chop, out vec3 nrm){\n  nrm = vec3(0.0);\n  vec3 disp = vec3(0.0);\n'
    for (const w of waves) {
      const dx = Math.cos(w.dir).toFixed(4), dz = Math.sin(w.dir).toFixed(4)
      body += `  disp += gerstnerWave(p, t, vec2(${dx}, ${dz}), ${w.wavelength.toFixed(2)}, ${w.amp.toFixed(3)} * chop, ${w.steepness.toFixed(3)}, nrm);\n`
    }
    body += '  nrm = normalize(vec3(nrm.x, 1.0, nrm.z));\n  return disp;\n}'
    return body
  }
  const waterUniforms = {
    uTime: waterShared.uTime,          // compartido con lecho/roca
    uLight: waterShared.uLight,        // compartido
    uRipples: { value: Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uAgitate: { value: 0 },
    uChop: { value: W.choppiness },
    uSkyTint: { value: new THREE.Vector3(...W.skyTint) },
    uDeep: { value: new THREE.Vector3(0.02, 0.10, 0.16) },
    uCausticTint: { value: new THREE.Vector3(...W.causticColor) },
    uSnell: { value: W.snellSharpness },
    uFoamT: { value: W.foamThreshold },
    uFoamI: { value: W.foamIntensity },
    uPortillo: { value: new THREE.Vector2(Math.cos(P.portillo.ang), Math.sin(P.portillo.ang)) },
  }
  let waterMesh = null
  {
    const geo = new THREE.PlaneGeometry(P.bowlRadius * 3.2, P.bowlRadius * 3.2, 160, 160)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      vertexShader: `
        #define N ${RIPPLES}
        precision highp float;
        uniform float uTime, uAgitate, uChop;
        varying vec2 vWXZ; varying vec3 vView; varying vec3 vWNrm; varying float vCrest;
        ${HASH_NOISE_FBM}
        ${GERSTNER}
        ${PROC_NORMAL}
        ${gerstnerSumGLSL(W.gerstner)}
        void main() {
          vec2 p = position.xz;
          vWXZ = p;
          vec3 nrm;
          // Piso de amplitud en reposo (0.5): sin oleaje la superficie igual
          // ondula con volumen; la agitación (uAgitate) la levanta más.
          float chop = uChop * (0.5 + uAgitate * 1.0);
          vec3 disp = gerstnerSum(p, uTime, chop, nrm);
          vec3 pos = position + disp;
          vCrest = disp.y;
          // Normal fina del rizado (mini-oleaje) combinada con la de Gerstner.
          // Dos escalas: una media y una MÁS FINA, para que se lea el rizado chico.
          vec3 rn = rippleNormal(p, uTime, 1.3 + uAgitate);
          vec3 rn2 = rippleNormal(p * 2.7 + 5.0, uTime * 1.4, 1.0);
          vWNrm = normalize(nrm + vec3(rn.x + rn2.x * 0.6, 0.0, rn.z + rn2.z * 0.6));
          // Dirección de vista (fragmento → cámara). cameraPosition SOLO está
          // disponible en el vertex de un ShaderMaterial, así que se calcula acá
          // y se pasa interpolada al fragment.
          vec3 world = (modelMatrix * vec4(pos, 1.0)).xyz;
          vView = cameraPosition - world;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }`,
      fragmentShader: `
        #define N ${RIPPLES}
        precision highp float;
        uniform float uTime, uAgitate, uLight, uSnell, uFoamT, uFoamI;
        uniform vec4 uRipples[N];
        uniform vec3 uSkyTint, uDeep, uCausticTint;
        uniform vec2 uPortillo;
        varying vec2 vWXZ; varying vec3 vView; varying vec3 vWNrm; varying float vCrest;
        ${HASH_NOISE_FBM}
        ${CAUSTIC_FIELD}
        void main() {
          vec3 n = normalize(vWNrm);
          vec3 v = normalize(vView);   // fragmento → cámara (mira hacia arriba)
          float cosI = clamp(abs(dot(n, v)), 0.0, 1.0);
          // Sol BAJO-lateral (no cenital): al no venir de frente, los flancos de
          // cada ola se separan en claro/oscuro y el relieve se lee aun mirando la
          // superficie casi de canto, que es como la ve la cámara sumergida.
          vec3 L = normalize(vec3(0.42, 0.82, -0.30));
          float ndl = clamp(dot(n, L), 0.0, 1.0);
          // Ventana de Snell ANCHA y suave: mirando casi vertical se ve el cielo.
          // El resto de la superficie NO es oscura vista desde abajo — es un ESPEJO
          // rizado y brillante del fondo iluminado, para que el techo SIEMPRE se
          // lea aunque no lo mires de frente. uSnell mueve el ancho del disco.
          float lo = 0.30 + 0.12 / uSnell;
          float win  = smoothstep(lo,        0.82, cosI);
          // Dispersión cromática en el borde: corre el umbral por canal.
          float winR = smoothstep(lo - 0.05, 0.82, cosI);
          float winB = smoothstep(lo + 0.05, 0.82, cosI);
          // Cáusticas en la cara inferior (tiñen también el espejo del techo).
          float cau = caustics(vWXZ * 0.09, uTime * 0.6);
          // Techo LUMINOSO: el espejo plateado tiene que ser claramente MÁS claro
          // que la niebla azul de fondo, si no se funde y desaparece. Ventana de
          // Snell casi blanca-cielo; el resto, plata-teal brillante siempre.
          // RELIEVE = motor del volumen. Combina la PENDIENTE de la ola (cuánto
          // inclina la normal hacia/desde el sol) con la ALTURA real (vCrest):
          // las caras al sol y las crestas van claras, los flancos de espalda y los
          // senos van oscuros. Rango GRANDE (0..1) para que se lea como olas
          // rodando, no como un tinte parejo sobre una lámina plana.
          float slope = dot(n.xz, L.xz);          // + si la cara mira al sol
          float relief = clamp(0.46 + slope * 1.9 + vCrest * 0.22, 0.0, 1.0);
          // Gradiente fuerte seno→cresta: azul profundo en los valles, plata-cielo
          // en las crestas. Esto solo ya esculpe el volumen del techo.
          vec3 trough = uDeep * 1.25;
          // Cresta plata-teal, MENOS blanca y con poco peso de cáustica: subir el
          // cau la volvía lóbulos "de plumavit" vistos desde abajo. Queda lisa.
          vec3 crestC = mix(vec3(0.28, 0.55, 0.64), vec3(0.60, 0.82, 0.92), clamp(cau * 0.35 + 0.35, 0.0, 1.0));
          vec3 body = mix(trough, crestC, relief);
          // Ventana de Snell: el cielo asoma donde la normal encara a la cámara.
          vec3 sky = uSkyTint * (1.12 + 0.30 * n.y);
          vec3 col = vec3(mix(body.r, sky.r, winR), mix(body.g, sky.g, win), mix(body.b, sky.b, winB));
          // Cáustica del techo MUY tenue: la red lacé, subida, aplanaba el relieve.
          // Queda como un velo, no como la textura dominante.
          col += uCausticTint * cau * uLight * 0.12;
          // Destello especular sobre las crestas encaradas al sol y a la cámara:
          // los puntos de luz que corren por el relieve al ondular. Dos anchos —
          // chispa fina + brillo suave — para que las crestas canten.
          vec3 hlf = normalize(L + v);
          float nh = clamp(dot(n, hlf), 0.0, 1.0);
          float spec = pow(nh, 28.0);
          float glint = pow(nh, 9.0);
          col += vec3(0.58, 0.80, 0.94) * spec * uLight * 0.8;
          col += vec3(0.12, 0.26, 0.32) * glint * uLight * 0.28;
          // MINI-OLEAJE: rizado fino y rápido de la superficie (líneas de luz
          // chiquitas que corren), más marcado cerca de la ventana de Snell.
          float mini = caustics(vWXZ * 0.34 + 7.0, uTime * 1.2);
          col += vec3(0.08, 0.20, 0.24) * mini * (0.2 + win * 0.5) * uLight;
          // Ondas de estela (bichos que rozan la superficie).
          float wake = 0.0;
          for (int i = 0; i < N; i++) {
            vec4 r = uRipples[i];
            if (r.w <= 0.001) continue;
            float d = distance(vWXZ, r.xy);
            float ring = sin((d - r.z) * 1.9) * exp(-abs(d - r.z) * 0.42);
            wake += max(0.0, ring) * smoothstep(9.0, 0.0, abs(d - r.z)) * r.w;
          }
          col += wake * vec3(0.30, 0.58, 0.92);
          // Espuma: en crestas altas y en el anillo del portillo donde rompe.
          float portDist = length(normalize(vWXZ + 1e-4) - uPortillo);
          float breakZone = smoothstep(1.2, 0.2, portDist);
          float foam = smoothstep(uFoamT, uFoamT + 0.25, vCrest) + breakZone * uAgitate;
          foam *= (0.4 + 0.6 * fbm(vWXZ * 0.5 + uTime, 2)) * uFoamI;
          col += vec3(foam);
          col *= uLight * 0.8 + 0.2;    // de noche baja, pero el techo no a negro
          // Alpha ALTA de base: el techo se lee como una lámina sólida y rizada,
          // no como un vidrio casi invisible.
          float a = clamp(0.6 + win * 0.28 + cau * 0.22 * uLight + wake * 0.4 + foam * 0.5, 0.0, 0.97);
          gl_FragColor = vec4(col, a);
        }`,
    })
    waterMesh = new THREE.Mesh(geo, mat)
    waterMesh.renderOrder = 1
    scene.add(waterMesh)
  }

  // Ondas en la superficie: pool FIFO, igual que la laguna.
  let rippleHead = 0
  function spawnRipple(x, z, str) {
    waterUniforms.uRipples.value[rippleHead].set(x, z, 0.5, str)
    rippleHead = (rippleHead + 1) % RIPPLES
  }
  function updateRipples(step) {
    for (const r of waterUniforms.uRipples.value) {
      if (r.w <= 0.001) continue
      r.z += 8 * step
      r.w = Math.max(0, r.w - 0.34 * step)
    }
  }

  // ─── LA ROCA VIVA ─────────────────────────────────────────────────────────
  // Un punto de la PARED anular a la altura (0 = fondo, 1 = borde) y azimut dados.
  function wallAt(h, a) {
    const y = P.bedY + (P.wallTop - P.bedY) * h
    const t = (y - P.bedY) / (P.wallTop - P.bedY)
    const r = P.bowlRadius * (0.55 + 0.95 * t) - 1.2
    return { x: Math.cos(a) * r, y, z: Math.sin(a) * r, ang: a }
  }
  // Un punto en la pared, a la altura pedida y azimut al azar.
  function wallPoint(h) { return wallAt(h, q() * 6.2832) }
  // Un punto en el LECHO CENTRAL (disco completo), a la altura del fondo con su
  // relieve. Es para POBLAR el centro de la poza —donde mira la cámara— y que no
  // quede pelado: wallPoint solo cubre las paredes (r≥~20), así que sin esto el
  // medio quedaba vacío.
  function bedSpot() {
    const a = q() * 6.2832, r = Math.sqrt(q()) * P.bowlRadius * 0.95
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    const y = P.bedY + (fbm(x * 0.035 + 2, z * 0.035 - 4, 2) - 0.5) * 8.0 + 0.5
    return { x, y, z, ang: a }
  }
  // Un punto sobre la CARA de un peñasco `m` a fracción de altura h (0 = pie,
  // 1 = cima) y azimut theta. Se apoya en el elipsoide suave de la masa y se
  // empuja un pelo hacia afuera para que la criatura se lea PEGADA a la piedra,
  // no flotando frente a ella. La banda vive en los flancos altos (no el ápice).
  function massFace(m, h, theta) {
    const ly = (h * 1.55 - 0.7) * m.ry                       // flancos, sesgo arriba
    const horiz = Math.max(0.34, Math.sqrt(Math.max(0, 1 - (ly / m.ry) ** 2)))
    const push = 1.04
    const lx = Math.cos(theta) * m.rx * horiz * push
    const lz = Math.sin(theta) * m.rz * horiz * push
    const c = Math.cos(m.rot), s = Math.sin(m.rot)           // deshace rotation.y
    let x = m.cx + lx * c + lz * s
    let z = m.cz - lx * s + lz * c
    // La cara EXTERIOR del peñasco queda oculta tras su propia masa (mesh opaco):
    // si el punto cayó afuera, lo reflejamos a la cara INTERIOR —la que mira la
    // cámara— por el centro de la masa. Sigue en la superficie, a la misma altura.
    if (Math.hypot(x, z) > Math.hypot(m.cx, m.cz)) { x = 2 * m.cx - x; z = 2 * m.cz - z }
    return { x, y: m.cy + ly, z, ang: theta + m.rot }
  }
  // Reparte encostre en CÚMULOS sobre la roca viva: se queda un rato en una misma
  // mancha (pared anular o peñasco) soltando vecinos, y luego salta a otra —así se
  // ven MANOJOS a distintas alturas, no un espolvoreo parejo. Denso cerca de la
  // línea de agua (donde de verdad viven), ralo hacia el fondo. `wallBias` = cuánto
  // va a la pared vs. las masas; [hLo,hHi] acota la banda de altura de la especie.
  function makeCruster(wallBias, hLo, hHi) {
    let left = 0, seed = null, onWall = false
    const band = () => hLo + (hHi - hLo) * Math.sqrt(q())    // sqrt → sesgo arriba
    return function next() {
      if (left <= 0 || (onWall && rockMasses.length === 0)) {
        onWall = q() < wallBias || rockMasses.length === 0
        seed = onWall
          ? { a: q() * 6.2832, h: band() }
          : { m: rockMasses[(q() * rockMasses.length) | 0], theta: q() * 6.2832, h: band() }
        left = 2 + (q() * 5 | 0)                             // 2–6 por mancha
      }
      left--
      const h = Math.min(0.99, Math.max(0.02, seed.h + (q() - 0.5) * 0.16))
      return onWall
        ? wallAt(h, seed.a + (q() - 0.5) * 0.3)
        : massFace(seed.m, h, seed.theta + (q() - 0.5) * 0.5)
    }
  }

  // ANÉMONAS: corona de tentáculos que se abre y cierra con la marea.
  const anemones = []
  const anemoneCloud = createPointCloud(P.anemones * 9, draw.pointMaterial)
  const anemoneCrust = makeCruster(0.45, 0.28, 0.78)   // banda baja: gustan de sombra
  for (let i = 0; i < P.anemones; i++) {
    // ENCOSTRAN la roca —pared anular y peñascos— en manojos: la ortiga de mar
    // que abre y cierra con la marea (nada en el lecho central: van pegadas a las
    // piedras, que es donde de verdad viven).
    const p = anemoneCrust()
    anemones.push({ ...p, phase: q() * 6.2832 })
    for (let k = 0; k < 9; k++) {
      const j = (i * 9 + k) * 3
      // Rojo ladrillo de la ortiga de mar, con el disco más oscuro. Disco basal
      // ANCHO para que se lea como anémona (no un punto pelado) aun recogida.
      anemoneCloud.col[j] = k === 0 ? 0.42 : 0.86
      anemoneCloud.col[j + 1] = k === 0 ? 0.10 : 0.22
      anemoneCloud.col[j + 2] = k === 0 ? 0.12 : 0.26
      anemoneCloud.size[i * 9 + k] = k === 0 ? 0.8 : 0.34
    }
  }
  scene.add(anemoneCloud.mesh)
  function updateAnemones(agitation) {
    for (let i = 0; i < anemones.length; i++) {
      const an = anemones[i]
      const open = anemoneOpen(tide, agitation)
      const b = i * 9
      // Disco basal, siempre pegado a la roca.
      anemoneCloud.pos[b * 3] = an.x
      anemoneCloud.pos[b * 3 + 1] = an.y
      anemoneCloud.pos[b * 3 + 2] = an.z
      // Tentáculos: se despliegan en corona al abrirse. Recogidos NO colapsan al
      // disco —guardan una corona mínima— para que la forma de anémona se lea
      // siempre, no un punto rojo suelto.
      for (let k = 1; k < 9; k++) {
        const a = (k / 8) * 6.2832 + an.phase
        const spread = 0.6 + open * 0.95
        const p = (b + k) * 3
        anemoneCloud.pos[p] = an.x + Math.cos(a) * spread
        anemoneCloud.pos[p + 1] = an.y + 0.2 + open * 0.5
        anemoneCloud.pos[p + 2] = an.z + Math.sin(a) * spread
      }
    }
    anemoneCloud.commit()
  }

  // LAPAS: pastorean con el agua y vuelven a su cicatriz antes de quedar secas.
  const limpets = []
  const limpetCloud = createPointCloud(P.limpets, draw.pointMaterial)
  const limpetCrust = makeCruster(0.5, 0.42, 0.92)
  for (let i = 0; i < P.limpets; i++) {
    const p = limpetCrust()
    limpets.push({ l: createLimpet(p.x, p.z), y: p.y })
    // Cono grisáceo de la Fissurella; leve variación para que no se lean clónicas.
    const g = 0.5 + q() * 0.12
    limpetCloud.col[i * 3] = g + 0.04; limpetCloud.col[i * 3 + 1] = g; limpetCloud.col[i * 3 + 2] = g - 0.03
    limpetCloud.size[i] = 0.32 + q() * 0.1
  }
  scene.add(limpetCloud.mesh)
  function updateLimpets(step) {
    for (let i = 0; i < limpets.length; i++) {
      const L = limpets[i]
      updateLimpet(L.l, tide, step, LIMPET_CFG, q)
      limpetCloud.pos[i * 3] = L.l.x
      limpetCloud.pos[i * 3 + 1] = L.y
      limpetCloud.pos[i * 3 + 2] = L.l.z
    }
    limpetCloud.commit()
  }

  // PICOROCOS: al sumergirse sacan los cirros y BARREN el agua, rítmicos.
  const barnacles = []
  const barnacleCloud = createPointCloud(P.barnacles * 4, draw.pointMaterial)
  const barnacleCrust = makeCruster(0.5, 0.55, 0.98)   // alto: viven en la franja seca
  for (let i = 0; i < P.barnacles; i++) {
    const p = barnacleCrust()
    barnacles.push({ ...p, phase: q() * 6.2832, rate: 2.2 + q() * 1.4 })
    for (let k = 0; k < 4; k++) {
      const j = (i * 4 + k) * 3
      barnacleCloud.col[j] = k === 0 ? 0.72 : 0.9
      barnacleCloud.col[j + 1] = k === 0 ? 0.70 : 0.86
      barnacleCloud.col[j + 2] = k === 0 ? 0.64 : 0.8
      barnacleCloud.size[i * 4 + k] = k === 0 ? 0.5 : 0.16
    }
  }
  scene.add(barnacleCloud.mesh)
  function updateBarnacles() {
    for (let i = 0; i < barnacles.length; i++) {
      const b = barnacles[i]
      const base = i * 4
      barnacleCloud.pos[base * 3] = b.x
      barnacleCloud.pos[base * 3 + 1] = b.y
      barnacleCloud.pos[base * 3 + 2] = b.z
      // El barrido solo existe bajo el agua: emergido, el cono se cierra.
      const sweep = tide < 0.3 ? 0 : (0.5 + 0.5 * Math.sin(clock * b.rate + b.phase)) * tide
      for (let k = 1; k < 4; k++) {
        const p = (base + k) * 3
        const reach = sweep * (0.35 + k * 0.22)
        barnacleCloud.pos[p] = b.x + Math.cos(b.ang + k) * reach
        barnacleCloud.pos[p + 1] = b.y + 0.3 + reach * 0.6
        barnacleCloud.pos[p + 2] = b.z + Math.sin(b.ang + k) * reach
      }
    }
    barnacleCloud.commit()
  }

  // BANCOS DE CHORITOS: manojos azul-negros APRETADOS pegados a la roca (pared y
  // peñascos), no una nube suelta. También son la despensa de la estrella de sol.
  const musselPatches = []
  const musselCrust = makeCruster(0.45, 0.4, 0.9)
  for (let i = 0; i < P.mussels.patches; i++) {
    const p = musselCrust()
    musselPatches.push({ x: p.x, z: p.z, count: P.mussels.perPatch })
    for (let k = 0; k < P.mussels.perPatch; k++) {
      // Racimo apretado; el azul-negro varía un punto entre valvas.
      const b = 0.14 + q() * 0.06
      pushPoint(p.x + (q() - 0.5) * 1.8, p.y + (q() - 0.5) * 1.6, p.z + (q() - 0.5) * 1.8,
        [b * 0.6, b * 0.5, b], 0.18 + q() * 0.16, 0)
    }
  }
  // CHITONES y CARACOLES: costra estática que remata la roca viva. Chitón =
  // óvalo gris-pardo achatado; caracol (Tegula/caracol negro) = perla oscura.
  // Baratos (un punto cada uno), en cúmulos sobre pared y peñascos.
  {
    const crust = makeCruster(0.5, 0.35, 0.9)
    for (let i = 0; i < P.chitons; i++) {
      const p = crust()
      if (q() < 0.6) {
        // Chitón: placa gris-parda, ancha y baja.
        const s = 0.24 + q() * 0.1
        pushPoint(p.x, p.y, p.z, [0.30 + s, 0.26 + s * 0.8, 0.22 + s * 0.6], 0.34 + q() * 0.14, 0)
      } else {
        // Caracol: concha oscura, chica y redonda.
        pushPoint(p.x, p.y, p.z, [0.18, 0.15, 0.17], 0.2 + q() * 0.12, 0)
      }
    }
  }

  // ALGAS: COCHAYUYO (Durvillaea antarctica). No son hojas planas anchas: cada
  // mata es un pequeño DISCO de fijación pegado a la roca/lecho, un ESTIPE grueso
  // que sube, y de él nace un MANOJO de correas largas, gruesas y redondeadas que
  // se arquean y ondulan con la corriente. Se dibujan como cadenas densas de
  // discos (volumen) reescritas cada frame — el mismo patrón que rayos/plancton:
  // así el balanceo puede crecer hacia la punta (la base queda anclada). El
  // gradiente va olivo oscuro en la base → dorado en la punta, con una franja
  // clara por el centro (segunda cadena más fina, el brillo de goma mojada).
  const STRAPS = 5           // correas por mata
  const NODES = 10           // discos por correa
  const ALGAE_PER = 3 + STRAPS * NODES * 2   // holdfast + 2 estipe + (cuerpo+brillo)
  const algaeCloud = createPointCloud(P.algae * ALGAE_PER, draw.pointMaterial)
  const algaeNodes = []      // { i, rx, ry, rz, w, ph } — rest + peso de vaivén + fase
  const ALGAE_CAP = P.surfaceMin - 1.2   // las puntas nunca asoman sobre el agua
  const HOLD = [0.10, 0.08, 0.05]        // disco de fijación (marrón oscuro)
  const STIPE_C = [0.11, 0.13, 0.05]     // estipe (olivo muy oscuro)
  const OLIVE = [0.14, 0.18, 0.05]       // base de la correa
  const GOLD = [0.46, 0.38, 0.15]        // punta dorada (contenida, no protagonista)
  const SHEEN = [0.58, 0.54, 0.34]       // realce húmedo del centro, discreto
  let algaeGI = 0
  function addAlgaNode(rx, ry, rz, w, ph, col, size) {
    const j = algaeGI * 3
    algaeCloud.pos[j] = rx; algaeCloud.pos[j + 1] = ry; algaeCloud.pos[j + 2] = rz
    algaeCloud.col[j] = col[0]; algaeCloud.col[j + 1] = col[1]; algaeCloud.col[j + 2] = col[2]
    algaeCloud.size[algaeGI] = size
    algaeNodes.push({ i: algaeGI, rx, ry, rz, w, ph })
    algaeGI++
  }
  for (let i = 0; i < P.algae; i++) {
    // La mayoría arraiga en el lecho; algunas en la pared baja de la taza.
    const base = q() < 0.28 ? wallPoint(q() * 0.14) : bedSpot(0.9)
    const mataPh = q() * 6.2832
    // Una de cada ~4 es una mata VIEJA: disco más ancho, estipe más alto y correas
    // bastante más largas. Las matas de cochayuyo no son todas del mismo porte.
    const big = q() < 0.26
    const scale = big ? 1.7 + q() * 0.8 : 0.85 + q() * 0.35
    // Disco de fijación + estipe grueso del que salen las correas.
    addAlgaNode(base.x, base.y, base.z, 0, mataPh, HOLD, 1.2 * (big ? 1.5 : 1))
    const topY = base.y + 1.6 * scale
    addAlgaNode(base.x, base.y + 0.7 * scale, base.z, 0.04, mataPh, STIPE_C, 1.0 * (big ? 1.35 : 1))
    addAlgaNode(base.x, topY, base.z, 0.06, mataPh, STIPE_C, 0.95 * (big ? 1.3 : 1))
    for (let s = 0; s < STRAPS; s++) {
      const az = q() * 6.2832
      const strapLen = (5 + q() * 5.5) * scale
      const reach = (2 + q() * 2.5) * (big ? 1.4 : 1) // cuánto se arquea hacia afuera
      const ph = mataPh + s * 0.9
      for (let k = 0; k < NODES; k++) {
        const u = (k + 1) / NODES
        const out = reach * u * u       // la correa se abre hacia la punta
        const rx = base.x + Math.cos(az) * out + (q() - 0.5) * 0.3
        const rz = base.z + Math.sin(az) * out + (q() - 0.5) * 0.3
        const ry = Math.min(topY + strapLen * (0.9 * u + 0.1 * Math.sin(u * Math.PI)), ALGAE_CAP)
        const w = 0.12 + 0.88 * u        // la base casi no se mueve; la punta, mucho
        // Cuerpo grueso: olivo → dorado a lo largo de la correa.
        const body = [
          OLIVE[0] + (GOLD[0] - OLIVE[0]) * u,
          OLIVE[1] + (GOLD[1] - OLIVE[1]) * u,
          OLIVE[2] + (GOLD[2] - OLIVE[2]) * u,
        ]
        addAlgaNode(rx, ry, rz, w, ph, body, (0.78 - 0.44 * u) * (big ? 1.45 : 1))
        // Franja húmeda por el centro: cadena más fina y clara, más dorada arriba.
        const g = 0.5 + 0.5 * u
        addAlgaNode(rx, ry, rz, w, ph, [SHEEN[0] * g, SHEEN[1] * g, SHEEN[2] * g], 0.32 - 0.18 * u)
      }
    }
  }
  scene.add(algaeCloud.mesh)
  // Vaivén: una onda que viaja por la correa (la punta se retrasa respecto a la
  // base) más el empuje de la corriente que entra por el portillo. La base, con
  // peso ~0, queda clavada al holdfast.
  function updateAlgae(agitation) {
    const t = clock
    const lean = agitation * 1.6
    for (let n = 0; n < algaeNodes.length; n++) {
      const nd = algaeNodes[n]
      const w = nd.w
      const s = t * 0.9 + nd.ph
      const j = nd.i * 3
      algaeCloud.pos[j] = nd.rx + Math.sin(s + w * 2.2) * 0.85 * w + CURRENT_X * lean * w
      algaeCloud.pos[j + 1] = Math.min(nd.ry + Math.sin(s * 1.3 + w * 3.0) * 0.16 * w, ALGAE_CAP)
      algaeCloud.pos[j + 2] = nd.rz + Math.cos(s * 0.85 + w * 2.2) * 0.85 * w + CURRENT_Z * lean * w
    }
    algaeCloud.commit()
  }

  draw.finalizeLines(scene, new THREE.LineBasicMaterial({ vertexColors: true, fog: true }))
  draw.finalizePoints(scene)

  // ─── FAUNA MÓVIL ──────────────────────────────────────────────────────────
  const kit = createAgentKit(rc)
  const n = cfg.fireflies.count
  const LR = P.bowlRadius * 0.92
  const agents = []
  const trailColors = []
  // Los slots vienen tipados por `slotClass` del registry: 0–1 cazadores lentos,
  // 2–13 el cardumen, 14–17 el bentos que camina. La clase decide cómo se mueve.
  for (let i = 0; i < n; i++) {
    const role = i < 2 ? 'predator' : i < 14 ? 'fish' : 'benthos'
    const kind = role === 'fish' ? 'strider' : role === 'predator' ? 'orb' : 'pins'
    const { group, params } = buildSpecies(kind, kit)
    const baseScale = role === 'predator' ? 1.5 + q() * 0.4 : 0.85 + q() * 0.4
    group.scale.setScalar(baseScale)
    scene.add(group)
    agents.push({
      group, role, baseScale, idx: i,
      cage: params.rollMul > 0 ? group.children[0] : null,
      spinY: params.spinY, homeY: q(), phase: q() * 6.2832,
    })
    trailColors.push(role === 'predator' ? 0xff8a3a : role === 'fish' ? 0x9fe8ff : 0x8fd07a)
  }
  const trails = createTrails(scene, n, trailColors, rc, draw.pointMaterial, 0.2)
  const worldPos = new Float32Array(n * 3)

  // El cardumen: boids en la columna de agua (mismo motor que la laguna).
  const school = createSchools(P.fish, q)
  // El bentos camina el fondo: roamers normalizados escalados al radio de la taza.
  const benthos = createRoamers(cfg.wander, n, q)
  let simTime = 0

  function moveFauna(step) {
    simTime += step
    updateSchools(school, P.fish, step, q)
    updateRoamers(benthos, cfg.wander, step, q, simTime, null, null, null)
    let fishSlot = 0
    for (let i = 0; i < n; i++) {
      const a = agents[i]
      if (a.role === 'fish') {
        // Cada slot de pez sigue a un individuo del cardumen.
        const f = school.fish[fishSlot % school.fish.length]
        fishSlot++
        worldPos[i * 3] = f.x * LR
        worldPos[i * 3 + 1] = Math.min(f.y, surfaceY - 1.2)
        worldPos[i * 3 + 2] = f.z * LR
      } else {
        // Bentos y cazadores: pegados al fondo, con un cabeceo mínimo.
        const r = benthos[i]
        worldPos[i * 3] = r.x * LR
        worldPos[i * 3 + 1] = P.bedY + 0.8 + Math.sin(clock * 0.6 + a.phase) * 0.2
        worldPos[i * 3 + 2] = r.z * LR
      }
    }
  }

  // ─── DEPREDACIÓN ──────────────────────────────────────────────────────────
  // Dos tempos: la estrella de sol repta sin parar (lenta, siempre) y el
  // chungungo cae de golpe (rápido, raro, solo con la poza llena).
  const stars = []
  for (let i = 0; i < 2; i++) {
    const a = q() * 6.2832, r = q() * P.bowlRadius * 0.5
    stars.push(createSeastar(Math.cos(a) * r, Math.sin(a) * r))
  }
  function huntSeastars(step, predations) {
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i]
      const ate = updateSeastar(s, musselPatches, step, SEASTAR_CFG)
      // El slot i (0–1) es un cazador: la estrella MANDA su posición.
      worldPos[i * 3] = s.x
      worldPos[i * 3 + 2] = s.z
      if (ate >= 0) {
        const dx = s.x, dz = s.z
        const dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'right' : 'left') : (dz > 0 ? 'ahead' : 'behind')
        predations.push({ hunterIdx: i, dir })
        spawnRipple(s.x, s.z, 0.4)
      }
    }
  }

  // El chungungo: cae desde la superficie, agarra algo y sube. No ocupa slot del
  // censo (nunca se le asigna nombre); es un visitante, y por eso impresiona.
  const otter = { active: 0, x: 0, z: 0, took: false, group: null }
  {
    const { group } = buildSpecies('burst', kit)
    group.scale.setScalar(2.2)
    group.visible = false
    scene.add(group)
    otter.group = group
  }
  function updateOtter(step, predations) {
    if (otter.active > 0) {
      otter.active -= step
      const k = 1 - otter.active / P.otter.diveDur      // 0 → 1
      // Zambullida: baja, toca el fondo a mitad de camino y vuelve a subir.
      const depth = Math.sin(Math.min(1, k) * Math.PI)
      otter.group.position.set(otter.x, surfaceY - depth * (surfaceY - P.bedY - 2), otter.z)
      if (!otter.took && k > 0.45) {
        otter.took = true
        predations.push({ hunterIdx: null, dir: 'above', agent: 'chungungo', agentType: 'otter' })
        spawnRipple(otter.x, otter.z, 1.2)
      }
      if (otter.active <= 0) { otter.group.visible = false }
      return
    }
    // Solo aparece con la poza bien llena, y rara vez.
    if (tide < P.otter.minTide) return
    if (q() > P.otter.chancePerSec * step) return
    const a = q() * 6.2832, r = q() * P.bowlRadius * 0.6
    otter.x = Math.cos(a) * r; otter.z = Math.sin(a) * r
    otter.active = P.otter.diveDur
    otter.took = false
    otter.group.visible = true
    spawnRipple(otter.x, otter.z, 1.4)
  }

  // ─── LA COLUMNA DE AGUA ───────────────────────────────────────────────────
  // PLANCTON: la nieve marina a la deriva. Su densidad la manda la SURGENCIA:
  // agua fría y rica = floración. De noche destella (noctiluca).
  const plankton = []
  const planktonCloud = createPointCloud(P.plankton, draw.pointMaterial)
  for (let i = 0; i < P.plankton; i++) {
    const a = q() * 6.2832, r = Math.sqrt(q()) * P.bowlRadius
    plankton.push({
      x: Math.cos(a) * r, z: Math.sin(a) * r,
      y: P.bedY + q() * (P.surfaceMax - P.bedY),
      vy: 0.04 + q() * 0.09, phase: q() * 6.2832, flash: 0,
    })
    planktonCloud.size[i] = 0.07 + q() * 0.1
  }
  scene.add(planktonCloud.mesh)
  // CORRIENTE: el mar entra por el portillo y empuja toda la columna hacia
  // adentro. Es lo que hace que el agua se lea como agua y no como aire quieto:
  // con marejada, todo lo que flota se va para el mismo lado.
  const CURRENT_X = -Math.cos(P.portillo.ang)
  const CURRENT_Z = -Math.sin(P.portillo.ang)
  function currentPush(agitation) {
    return (0.25 + agitation * 2.6)   // unidades/s hacia el interior de la taza
  }

  function updatePlankton(step, bloom, night, agitation) {
    const push = currentPush(agitation) * step
    for (let i = 0; i < plankton.length; i++) {
      const p = plankton[i]
      // Deriva: sube muy lento y se mece con la corriente.
      p.y += p.vy * step
      if (p.y > surfaceY - 0.5) p.y = P.bedY + 0.5
      const drift = Math.sin(clock * 0.4 + p.phase) * 0.03
      p.x += drift; p.z += Math.cos(clock * 0.35 + p.phase) * 0.03
      // …y la corriente que entra por el portillo lo arrastra a todo parejo.
      p.x += CURRENT_X * push
      p.z += CURRENT_Z * push
      // Al salirse de la taza reaparece del lado del portillo (columna cerrada).
      if (Math.hypot(p.x, p.z) > P.bowlRadius) {
        p.x = -CURRENT_X * P.bowlRadius * 0.95 + (q() - 0.5) * 6
        p.z = -CURRENT_Z * P.bowlRadius * 0.95 + (q() - 0.5) * 6
      }
      // Noctiluca: de noche el plancton agitado suelta un destello azul, RARO.
      if (night && p.flash <= 0 && q() < 0.0006) p.flash = 1
      if (p.flash > 0) p.flash = Math.max(0, p.flash - step * 1.6)
      const j = i * 3
      planktonCloud.pos[j] = p.x
      planktonCloud.pos[j + 1] = p.y
      planktonCloud.pos[j + 2] = p.z
      // Motas TENUES azul-grisáceas (leve tinte verde con surgencia); al destellar,
      // pop azul-blanco de noctiluca. Base baja para que no sean una nube verde.
      planktonCloud.col[j] = 0.09 + p.flash * 0.45
      planktonCloud.col[j + 1] = 0.15 + bloom * 0.20 + p.flash * 0.7
      planktonCloud.col[j + 2] = 0.22 + p.flash * 1.0
    }
    planktonCloud.commit()
  }

  // BURBUJAS: MUY pocas y finas, DISPERSAS por el fondo (no columnas fijas). Suben
  // con bamboleo y se van al llegar a la superficie. Casi solo aparecen con oleaje
  // (el mar entrando por el portillo); en calma son un goteo mínimo.
  const bubbles = []
  const bubbleCloud = createPointCloud(P.bubbles, draw.pointMaterial)
  for (let i = 0; i < P.bubbles; i++) {
    bubbles.push({ x: 0, z: 0, y: -9999, vy: 0, wob: q() * 6.2832 })
    // Azul pálido tenue (no blanco brillante): acompañan sin tapar.
    bubbleCloud.col[i * 3] = 0.42; bubbleCloud.col[i * 3 + 1] = 0.58; bubbleCloud.col[i * 3 + 2] = 0.66
    bubbleCloud.size[i] = 0.04 + q() * 0.06
  }
  scene.add(bubbleCloud.mesh)
  let bubbleHead = 0
  function updateBubbles(step, agitation) {
    // Casi todo el ritmo lo pone el oleaje; un mínimo goteo de base.
    const rate = 0.4 + agitation * 5
    if (q() < rate * step) {
      const b = bubbles[bubbleHead]
      bubbleHead = (bubbleHead + 1) % bubbles.length
      // Punto de origen DISPERSO: sesgo hacia el portillo con oleaje, si no en
      // cualquier grieta del fondo. Nunca una columna fija.
      let vx, vz
      if (q() < 0.35 + agitation * 0.4) {
        vx = Math.cos(P.portillo.ang) * P.bowlRadius * 0.8
        vz = Math.sin(P.portillo.ang) * P.bowlRadius * 0.8
      } else {
        const a = q() * 6.2832, r = Math.sqrt(q()) * P.bowlRadius * 0.9
        vx = Math.cos(a) * r; vz = Math.sin(a) * r
      }
      b.x = vx + (q() - 0.5) * 2.5
      b.z = vz + (q() - 0.5) * 2.5
      b.y = P.bedY + q() * 3
      b.vy = 3.0 + q() * 3.0
      b.wob = q() * 6.2832
    }
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i]
      if (b.y > -9000) {
        b.y += b.vy * step
        // Bamboleo fino en espiral al subir (más natural que un empuje lateral).
        b.x += Math.sin(clock * 3 + b.wob) * 0.03
        b.z += Math.cos(clock * 2.6 + b.wob) * 0.03
        if (b.y > surfaceY - 0.3) { b.y = -9999; spawnRipple(b.x, b.z, 0.14) }
      }
      bubbleCloud.pos[i * 3] = b.x
      bubbleCloud.pos[i * 3 + 1] = b.y
      bubbleCloud.pos[i * 3 + 2] = b.z
    }
    bubbleCloud.commit()
  }

  // RAYOS DE SOL: los god-rays volumétricos los hace la PASADA SUBMARINA del
  // composer (marcha de luz hacia la ventana de Snell proyectada). El viejo
  // sistema de puntos en línea vertical se sacó: se leía como columnas de bolas.

  // ─── PÁJARO: un pilpilén/gaviota que cruza el cielo POR ENCIMA de la superficie.
  // Visto desde abajo es una silueta oscura que pasa contra el techo brillante —
  // da escala y vida. Va como 5 puntos (cuerpo + alas) que baten y cruzan, y
  // aparece de a ratos. renderOrder alto → se dibuja sobre el agua.
  const birdCloud = createPointCloud(5, draw.pointMaterial)
  for (let k = 0; k < 5; k++) {
    birdCloud.col[k * 3] = 0.03; birdCloud.col[k * 3 + 1] = 0.04; birdCloud.col[k * 3 + 2] = 0.06
    birdCloud.size[k] = k === 0 ? 0.9 : 0.55
    birdCloud.pos[k * 3 + 1] = -9999
  }
  birdCloud.mesh.renderOrder = 3
  scene.add(birdCloud.mesh)
  const bird = { active: 0, x: 0, z: 0, dir: 0, cool: 3 + q() * 6 }
  function updateBird(step, t) {
    if (bird.active <= 0) {
      bird.cool -= step
      if (bird.cool <= 0) {
        const a = q() * 6.2832
        bird.x = Math.cos(a) * P.bowlRadius * 1.15
        bird.z = Math.sin(a) * P.bowlRadius * 1.15
        bird.dir = a + Math.PI + (q() - 0.5)     // cruza hacia el lado opuesto
        bird.active = 6 + q() * 4
      } else { birdCloud.commit(); return }
    }
    bird.active -= step
    bird.x += Math.cos(bird.dir) * 9 * step
    bird.z += Math.sin(bird.dir) * 9 * step
    const by = P.surfaceMax + 3.5
    const flap = Math.sin(t * 9.0) * 1.4
    const fx = Math.cos(bird.dir), fz = Math.sin(bird.dir)
    const wx = -fz, wz = fx                      // eje de las alas (perpendicular)
    const P0 = birdCloud.pos
    P0[0] = bird.x; P0[1] = by; P0[2] = bird.z                                   // cuerpo
    P0[3] = bird.x + wx * 1.2; P0[4] = by + flap * 0.4; P0[5] = bird.z + wz * 1.2 // ala int
    P0[6] = bird.x - wx * 1.2; P0[7] = by + flap * 0.4; P0[8] = bird.z - wz * 1.2
    P0[9] = bird.x + wx * 2.4; P0[10] = by + flap; P0[11] = bird.z + wz * 2.4     // puntas
    P0[12] = bird.x - wx * 2.4; P0[13] = by + flap; P0[14] = bird.z - wz * 2.4
    if (bird.active <= 0) { bird.cool = 5 + q() * 10; for (let k = 0; k < 5; k++) P0[k * 3 + 1] = -9999 }
    birdCloud.commit()
  }

  // ─── API del builder ──────────────────────────────────────────────────────
  let clock = 0
  let tide = 0
  let surfaceY = P.surfaceMax
  function update(swarm, dt, eco) {
    const step = dt || 0.016
    clock += step
    pointUniforms.uT.value = clock
    if (eco) {
      // DÍA/NOCHE visible: cielo y agua se aclaran con el sol y oscurecen de noche.
      const dayF = Math.max(0, Math.min(1, (eco.gain - 0.6) / 0.7))
      scene.background.lerpColors(NIGHT_BG, DAY_BG, dayF)
      scene.fog.color.lerpColors(NIGHT_FOG, DAY_FOG, dayF)
      // Columna de agua LUMINOSA: de día, lo lejano se funde a turquesa claro
      // (luz dispersada en el agua — es lo que te mete "adentro"); de noche casi
      // no hay glow. La roca cercana queda nítida; la lejana, silueta turquesa.
      scene.fog.density = 0.005 + dayF * 0.007 + eco.fog * 0.010
      tide = tideLevel(eco.phaseIndex, eco.phaseT)
      // El techo sube y baja con la marea: en bajamar se acerca a la cámara y la
      // poza se vuelve un charco chico; en pleamar se aleja y hay columna de agua.
      surfaceY = P.surfaceMin + (P.surfaceMax - P.surfaceMin) * tide
      if (waterMesh) waterMesh.position.y = surfaceY
      // De noche no hay cáusticas: sin sol arriba, la red de luz no existe.
      waterShared.uTime.value = clock
      waterShared.uSurfaceY.value = surfaceY
      waterShared.uLight.value = Math.min(1, eco.gain * 0.85)
      // Agitación del oleaje (el `rain` del estado de OLEAJE).
      waterUniforms.uAgitate.value = eco.rain * 0.8
      // La estación de este mundo es la SURGENCIA; el HUD lee esta etiqueta.
      eco.seasonLabel = surgeLabel(eco.seasonT)
    }
    updateRipples(step)
    const agitation = eco ? eco.rain : 0
    updateAnemones(agitation)
    updateLimpets(step)
    updateBarnacles()
    updateAlgae(agitation)
    const light = eco ? Math.min(1, eco.gain * 0.85) : 1
    seaUniforms.uTime.value = clock
    seaUniforms.uLight.value = light
    // Con turbidez alta el azul se cierra más rápido: se ve menos lejos.
    if (eco) seaUniforms.uTint.value = 0.42 + eco.fog * 0.5
    // La ventana de Snell está justo ARRIBA de la cámara: proyectar un punto en
    // world sobre la superficie, encima del ojo, a coordenadas de pantalla.
    _snell.set(stage.camera.position.x, surfaceY, stage.camera.position.z).project(stage.camera)
    seaUniforms.uSnellPos.value.set(_snell.x * 0.5 + 0.5, _snell.y * 0.5 + 0.5)
    const night = light < 0.35
    // Surgencia: agua fría y rica = floración de plancton (frío = más vida).
    const bloom = eco ? 1 - Math.abs(((eco.seasonT + 0.5) % 1) - 0.25) * 2 : 0.5
    updatePlankton(step, Math.max(0, bloom), night, agitation)
    updateBubbles(step, agitation)
    updateBird(step, clock)
    // La corriente también arrastra al cardumen: con marejada el banco se corre
    // hacia adentro de la taza en vez de nadar como si el agua estuviera quieta.
    if (agitation > 0.05) {
      const drag = currentPush(agitation) * step * 0.012
      for (const f of school.fish) { f.vx += CURRENT_X * drag; f.vz += CURRENT_Z * drag }
    }
    const predations = []
    moveFauna(step)
    // La estrella pisa la posición de sus slots antes de que se dibujen.
    huntSeastars(step, predations)
    updateOtter(step, predations)
    for (let i = 0; i < n; i++) {
      const a = agents[i]
      a.group.position.set(worldPos[i * 3], worldPos[i * 3 + 1], worldPos[i * 3 + 2])
      if (a.spinY) a.group.rotation.y += a.spinY * step
      const pulse = 1 + (swarm ? swarm.flash[i] : 0) * 0.35
      if (a.cage) a.cage.scale.setScalar(pulse)
      else a.group.scale.setScalar(a.baseScale * pulse)
      // Los peces que rozan la superficie la pican.
      if (a.role === 'fish' && worldPos[i * 3 + 1] > surfaceY - 2.4 && q() < 0.02) {
        spawnRipple(worldPos[i * 3], worldPos[i * 3 + 2], 0.5)
      }
    }
    trails.update(worldPos)
    updateLabel()
    stage.render(step)
    return predations
  }
  // Frío = surgencia = comida. La etiqueta invierte el sentido del año del bosque.
  function surgeLabel(seasonT) {
    const s = (seasonT + 0.5) % 1   // el pico de surgencia va opuesto al verano
    if (s < 0.25) return 'surgencia fuerte'
    if (s < 0.5) return 'surgencia'
    if (s < 0.75) return 'aguas calmas'
    return 'aguas pobres'
  }

  const _proj = new THREE.Vector3()
  const _snell = new THREE.Vector3()  // temporal: proyección de la ventana de Snell a pantalla
  let ptrX = null, ptrY = null, _lx = 0, _ly = 0
  // El lente fisheye mueve la posición VISUAL del agente respecto de su NDC
  // lógico; sin deshacer esa distorsión, la etiqueta no cae donde se ve el bicho.
  const _fk = Math.min(rc.fisheye, 0.62)
  function lensNDC(px, py) {
    let sx = px, sy = py
    for (let it = 0; it < 3; it++) {
      const rn = Math.hypot(sx, sy) / 1.4142
      const f = (1 - _fk) + _fk * rn * rn
      sx = px / f; sy = py / f
    }
    return [sx, sy]
  }
  function setPointer(x, y) { ptrX = x; ptrY = y }

  function updateLabel() {
    let bestI = -1
    if (ptrX !== null) {
      let bestD = 0.14
      for (let i = 0; i < n; i++) {
        _proj.set(worldPos[i * 3], worldPos[i * 3 + 1] + 1.5, worldPos[i * 3 + 2]).project(stage.camera)
        if (_proj.z > 1) continue
        const [vx, vy] = lensNDC(_proj.x, _proj.y)
        const d = Math.hypot(vx - ptrX, vy - ptrY)
        if (d < bestD) { bestD = d; bestI = i; _lx = vx; _ly = vy }
      }
    }
    if (bestI >= 0 && agentNames[bestI]) {
      const { w, h, ox, oy } = stage.metrics
      stage.labelEl.style.left = ox + (_lx * 0.5 + 0.5) * w + 'px'
      stage.labelEl.style.top = oy + (-_ly * 0.5 + 0.5) * h + 'px'
      stage.labelEl.textContent = agentNames[bestI]
      stage.labelEl.style.opacity = '1'
    } else {
      stage.labelEl.style.opacity = '0'
    }
  }

  function scare(strength = 1) {
    scatterFish(school, strength * 1.5, q)
    for (const r of benthos) {
      const m = Math.hypot(r.x, r.z) || 1e-3
      const k = (0.6 + Math.random() * 0.9) * strength
      r.vx += (r.x / m) * k; r.vz += (r.z / m) * k
    }
    waterUniforms.uAgitate.value = Math.min(1.6, 0.9 + strength * 0.6)
    for (let i = 0; i < 6; i++) {
      const a = q() * 6.2832, rr = Math.sqrt(q()) * P.bowlRadius * 0.8
      spawnRipple(Math.cos(a) * rr, Math.sin(a) * rr, 0.8 + strength * 0.4)
    }
  }

  return {
    update, scare, setPointer,
    flash: stage.flash, resize: stage.resize, dispose: stage.dispose,
    camera: stage.camera, controls: stage.controls,
  }
}
