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
  function injectCaustics(mat) {
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
           gl_FragColor.rgb += uCausticTint * cau * depthAtten * uLight * 0.9;`)
    }
    mat.customProgramCacheKey = () => 'tidepool-caustic'
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
        col += vec3(0.18, 0.42, 0.5) * shaft * shaft * 0.55 * uLight;
        // Tinte azul-verdoso que se ahonda con la distancia al centro.
        float d = length(vUv - 0.5) * 1.42;
        vec3 water = vec3(0.04, 0.34, 0.44);
        col = mix(col, col * water * 2.2, clamp(d * uTint, 0.0, 0.85));
        gl_FragColor = vec4(col, 1.0);
      }`,
  })

  // La cámara arranca dentro de la taza, algo descentrada, mirando hacia arriba.
  const stage = createStage(container, {
    ...cfg,
    stage: {
      camera: { orbR: 28, theta: 0.9, phi: 1.62, target: [0, -20, 0] },
      // La cámara mira casi NIVELADA al BENTOS (target en y=-20, sobre el fondo),
      // que llena el cuadro como en la referencia, con la superficie brillante
      // como techo arriba. Como el target es hondo, la banda polar puede ser ancha
      // sin que la cámara salga del agua (minPolar) ni cruce el lecho (maxPolar).
      // Azimut libre para orbitar la poza.
      orbit: { minDist: 10, maxDist: 32, minPolar: Math.PI * 0.42, maxPolar: Math.PI * 0.60 },
      breathe: { baseY: -20, ampY: 1.5 },
      fog: { color: 0x0a2733, density: 0.026 },
      background: 0x061a24,
      addPass: (composer) => composer.insertPass(seaPass, 1),
    },
  })
  const { scene } = stage
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
  // Roca mojada de la costa: gris-carbón frío, no arena.
  const ROCK_LO = [0.05, 0.06, 0.07]
  const ROCK_HI = [0.26, 0.28, 0.31]
  {
    const R = P.bowlRadius
    const geo = new THREE.CylinderGeometry(R * 1.5, R * 0.55, P.wallTop - P.bedY, 96, 24, true)
    const pos = geo.attributes.position
    const cols = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      // Relieve: la roca no es un cono liso.
      const bump = (fbm(x * 0.09 + 4, z * 0.09 - 2, 3) - 0.5) * 5.5
      const ang = Math.atan2(z, x)
      // El PORTILLO: un sector del borde queda más bajo, y por ahí entra el mar.
      let dAng = Math.abs(ang - P.portillo.ang)
      if (dAng > Math.PI) dAng = Math.PI * 2 - dAng
      const gate = Math.max(0, 1 - dAng / P.portillo.width)
      const rr = Math.hypot(x, z) || 1
      pos.setX(i, x + (x / rr) * bump)
      pos.setZ(i, z + (z / rr) * bump)
      pos.setY(i, y - gate * gate * P.wallTop * 1.4)
      // Más oscuro hacia el fondo (menos luz llega abajo).
      const t = Math.max(0, Math.min(1, (y - P.bedY) / (P.wallTop - P.bedY)))
      for (let k = 0; k < 3; k++) cols[i * 3 + k] = ROCK_LO[k] + (ROCK_HI[k] - ROCK_LO[k]) * t
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    geo.translate(0, (P.wallTop + P.bedY) / 2, 0)
    scene.add(new THREE.Mesh(geo, injectCaustics(new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: true,
    }))))
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
      const s = 0.5 + fbm(x * 0.2, z * 0.2, 2) * 0.5
      cols[i * 3] = ROCK_LO[0] * s * 3.2
      cols[i * 3 + 1] = ROCK_LO[1] * s * 3.4
      cols[i * 3 + 2] = ROCK_LO[2] * s * 3.6
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    scene.add(new THREE.Mesh(geo, injectCaustics(new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: true,
    }))))
  }
  // Bolones sueltos por el fondo.
  for (let i = 0; i < 120; i++) {
    const a = q() * 6.2832, r = Math.sqrt(q()) * P.bowlRadius * 0.98
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    pushPoint(x, P.bedY + 0.4 + q() * 0.9, z, [0.18, 0.2, 0.22], 0.4 + q() * 1.1, 0)
  }
  // ─── FORMACIONES DE ROCA: peñascos e islotes que suben del lecho, para que la
  // poza tenga geografía (repisas, stacks altos, bolones grandes) y no una taza
  // lisa. Icoesferas deformadas por fbm — como los lóbulos del pond — con las
  // cáusticas inyectadas (la luz del techo también les cae encima).
  {
    const ROCKN = 28
    for (let i = 0; i < ROCKN; i++) {
      const a = q() * 6.2832
      // Repartidas por el disco, dejando algo de aire en el centro bajo la cámara.
      const r = (0.28 + Math.sqrt(q()) * 0.64) * P.bowlRadius
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r
      const tall = q() < 0.4
      const rx = (tall ? 3 : 4) + q() * (tall ? 3 : 6)
      const rz = rx * (0.7 + q() * 0.6)
      const ry = tall ? 10 + q() * 16 : 3 + q() * 6      // stacks altos vs bolones
      const geo = new THREE.IcosahedronGeometry(1, 3)
      const gp = geo.attributes.position
      const seed = q() * 100
      const cols = new Float32Array(gp.count * 3)
      for (let k = 0; k < gp.count; k++) {
        const px = gp.getX(k), py = gp.getY(k), pz = gp.getZ(k)
        const d = 1 + (fbm(px * 1.6 + seed, pz * 1.6 - py + seed, 3) - 0.5) * 0.7
        const wx = px * d * rx, wy = py * d * ry, wz = pz * d * rz
        gp.setXYZ(k, wx, wy, wz)
        // Gris-carbón húmedo con gradiente vertical (más claro arriba, hacia la luz).
        const t = Math.max(0, Math.min(1, (wy + ry) / (2 * ry)))
        const g = 0.06 + t * 0.22 + (fbm(px * 3 + seed, pz * 3, 2) - 0.5) * 0.08
        cols[k * 3] = g * 0.9; cols[k * 3 + 1] = g; cols[k * 3 + 2] = g * 1.12
      }
      geo.computeVertexNormals()
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
      const mesh = new THREE.Mesh(geo, injectCaustics(new THREE.MeshBasicMaterial({
        vertexColors: true, side: THREE.DoubleSide, fog: true,
      })))
      mesh.position.set(cx, P.bedY + ry * 0.55, cz)
      mesh.rotation.y = q() * 6.2832
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
          float chop = uChop * (0.35 + uAgitate);
          vec3 disp = gerstnerSum(p, uTime, chop, nrm);
          vec3 pos = position + disp;
          vCrest = disp.y;
          // Normal fina del rizado combinada con la de Gerstner.
          vec3 rn = rippleNormal(p, uTime, 0.6 + uAgitate);
          vWNrm = normalize(nrm + vec3(rn.x, 0.0, rn.z));
          // Dirección de vista (fragmento → cámara). cameraPosition SOLO está
          // disponible en el vertex de un ShaderMaterial, así que se calcula acá
          // y se pasa interpolada al fragment.
          vec3 world = (modelMatrix * vec4(pos, 1.0)).xyz;
          vView = cameraPosition - world;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }`,
      fragmentShader: `
        #define N ${RIPPLES}
        precision mediump float;
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
          vec3 sky = uSkyTint * (1.05 + 0.30 * n.y);
          vec3 sheen = mix(vec3(0.28, 0.52, 0.60), vec3(0.72, 0.94, 1.0), clamp(cau * 0.85 + 0.25, 0.0, 1.0));
          vec3 tir = sheen * (0.80 + 0.35 * cosI);
          vec3 col = vec3(mix(tir.r, sky.r, winR), mix(tir.g, sky.g, win), mix(tir.b, sky.b, winB));
          col += uCausticTint * cau * uLight * 0.35;
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
  // Un punto en la pared de la taza, a la altura pedida (0 = fondo, 1 = borde).
  function wallPoint(h) {
    const a = q() * 6.2832
    const y = P.bedY + (P.wallTop - P.bedY) * h
    const t = (y - P.bedY) / (P.wallTop - P.bedY)
    const r = P.bowlRadius * (0.55 + 0.95 * t) - 1.2
    return { x: Math.cos(a) * r, y, z: Math.sin(a) * r, ang: a }
  }

  // ANÉMONAS: corona de tentáculos que se abre y cierra con la marea.
  const anemones = []
  const anemoneCloud = createPointCloud(P.anemones * 9, draw.pointMaterial)
  for (let i = 0; i < P.anemones; i++) {
    const p = wallPoint(0.15 + q() * 0.55)
    anemones.push({ ...p, phase: q() * 6.2832 })
    for (let k = 0; k < 9; k++) {
      const j = (i * 9 + k) * 3
      // Rojo ladrillo de la ortiga de mar, con el disco más oscuro.
      anemoneCloud.col[j] = k === 0 ? 0.42 : 0.86
      anemoneCloud.col[j + 1] = k === 0 ? 0.10 : 0.22
      anemoneCloud.col[j + 2] = k === 0 ? 0.12 : 0.26
      anemoneCloud.size[i * 9 + k] = k === 0 ? 0.55 : 0.3
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
      // Tentáculos: se despliegan en corona al abrirse; recogidos son una perla.
      for (let k = 1; k < 9; k++) {
        const a = (k / 8) * 6.2832 + an.phase
        const spread = 0.25 + open * 1.15
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
  for (let i = 0; i < P.limpets; i++) {
    const p = wallPoint(0.3 + q() * 0.55)
    limpets.push({ l: createLimpet(p.x, p.z), y: p.y })
    limpetCloud.col[i * 3] = 0.62; limpetCloud.col[i * 3 + 1] = 0.58; limpetCloud.col[i * 3 + 2] = 0.48
    limpetCloud.size[i] = 0.34
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
  for (let i = 0; i < P.barnacles; i++) {
    const p = wallPoint(0.25 + q() * 0.6)
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

  // BANCOS DE CHORITOS: la despensa de la estrella de sol (Task 14).
  const musselPatches = []
  for (let i = 0; i < P.mussels.patches; i++) {
    const p = wallPoint(0.2 + q() * 0.4)
    musselPatches.push({ x: p.x, z: p.z, count: P.mussels.perPatch })
    for (let k = 0; k < P.mussels.perPatch; k++) {
      pushPoint(p.x + (q() - 0.5) * 3.4, p.y + (q() - 0.5) * 2.6, p.z + (q() - 0.5) * 3.4,
        [0.10, 0.09, 0.16], 0.2 + q() * 0.16, 0)
    }
  }

  // ALGAS: pradería DENSA de hojas ANCHAS (cintas, no hairlines) que se MECEN con
  // la corriente. Cada mata es un abanico de blades; una de cada ~5 es una correa
  // alta de cochayuyo/huiro que sube hacia la luz. Cada blade es una tira de
  // triángulos que se afina hacia la punta, con gradiente verde base→punta. El
  // vaivén lo hace el vertex shader (offset por altura + fase de la mata).
  const ALGAE_LO = [0.05, 0.14, 0.04], ALGAE_HI = [0.34, 0.60, 0.18]
  const KELP_LO = [0.09, 0.12, 0.05], KELP_HI = [0.46, 0.42, 0.14]
  const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  {
    const pos = [], col = [], sway = [], phs = [], idx = []
    let vb = 0
    function pushBlade(bx, bz, byy, h, width, leanX, leanZ, lo, hi) {
      const segs = 6, ph = q() * 6.2832
      // Perpendicular en XZ a la inclinación, para dar ancho a la cinta.
      let px = leanX, pz = leanZ
      const pl = Math.hypot(px, pz) || 1; px = -pz / pl; pz = leanX / pl  // perp normalizada
      for (let s = 0; s <= segs; s++) {
        const f = s / segs
        const arch = (0.3 + 0.4) * h * f * f * 0.5   // se recuesta hacia la punta
        const cx = bx + leanX * arch
        const cy = byy + h * f * (1.0 - 0.1 * f)
        const cz = bz + leanZ * arch
        const w = width * (1.0 - f) * 0.5            // se afina hacia la punta
        const c = mixC(lo, hi, f)
        pos.push(cx + px * w, cy, cz + pz * w, cx - px * w, cy, cz - pz * w)
        col.push(c[0], c[1], c[2], c[0], c[1], c[2])
        const amt = f * f * Math.min(h * 0.09, 3.2)  // la punta se mece más
        sway.push(amt, amt); phs.push(ph, ph)
        if (s < segs) { idx.push(vb, vb + 1, vb + 2, vb + 1, vb + 3, vb + 2) }
        vb += 2
      }
    }
    for (let i = 0; i < P.algae; i++) {
      const tall = q() < 0.2
      const base = wallPoint(q() * 0.42)
      const blades = tall ? 2 + (q() * 3 | 0) : 7 + (q() * 12 | 0)
      const bendDir = q() * 6.2832
      const leanX = Math.cos(bendDir), leanZ = Math.sin(bendDir)
      const lo = tall ? KELP_LO : ALGAE_LO, hi = tall ? KELP_HI : ALGAE_HI
      for (let b = 0; b < blades; b++) {
        const h = tall ? 16 + q() * 18 : 4 + q() * 9
        const rr = (tall ? 0.6 : 2.0) * q(), aa = q() * 6.2832
        const bx = base.x + Math.cos(aa) * rr, bz = base.z + Math.sin(aa) * rr
        const width = tall ? 1.8 + q() * 1.4 : 0.5 + q() * 0.6
        pushBlade(bx, bz, base.y, h, width, leanX, leanZ, lo, hi)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3))
    geo.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(sway), 1))
    geo.setAttribute('phase', new THREE.BufferAttribute(new Float32Array(phs), 1))
    geo.setIndex(idx)
    const algaeUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog])
    algaeUniforms.uTime = waterShared.uTime          // ya se actualiza cada frame
    const algaeMat = new THREE.ShaderMaterial({
      uniforms: algaeUniforms, fog: true, side: THREE.DoubleSide,
      vertexShader: `
        uniform float uTime;
        attribute vec3 color; attribute float sway; attribute float phase;
        varying vec3 vColor;
        #include <fog_pars_vertex>
        void main(){
          vColor = color;
          vec3 p = position;
          p.x += sin(uTime * 1.1 + phase) * sway;
          p.z += cos(uTime * 0.9 + phase * 1.3) * sway * 0.8;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          #include <fog_vertex>
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: `
        precision mediump float;
        varying vec3 vColor;
        #include <fog_pars_fragment>
        void main(){
          gl_FragColor = vec4(vColor, 1.0);
          #include <fog_fragment>
        }`,
    })
    scene.add(new THREE.Mesh(geo, algaeMat))
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

  // RAYOS DE SOL: cuñas de luz que bajan de la superficie entre las piedras.
  // Puntos aditivos en línea, que es como el proyecto dibuja la luz.
  const rays = []
  const rayCloud = createPointCloud(P.rays * 16, draw.pointMaterial)
  for (let i = 0; i < P.rays; i++) {
    const a = q() * 6.2832, r = q() * P.bowlRadius * 0.7
    rays.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, tilt: (q() - 0.5) * 0.5, phase: q() * 6.2832 })
    for (let k = 0; k < 16; k++) rayCloud.size[i * 16 + k] = 1.4 - (k / 16) * 0.8
  }
  scene.add(rayCloud.mesh)
  function updateRays(light) {
    for (let i = 0; i < rays.length; i++) {
      const R = rays[i]
      const sway = Math.sin(clock * 0.5 + R.phase) * 1.2
      for (let k = 0; k < 16; k++) {
        const f = k / 15
        const j = (i * 16 + k) * 3
        rayCloud.pos[j] = R.x + sway * f + R.tilt * f * 8
        rayCloud.pos[j + 1] = surfaceY - f * (surfaceY - P.bedY) * 0.85
        rayCloud.pos[j + 2] = R.z + sway * f * 0.5
        // Se apagan con la profundidad y con la luz del día.
        const v = light * (1 - f) * 0.5
        rayCloud.col[j] = v * 0.5; rayCloud.col[j + 1] = v * 0.85; rayCloud.col[j + 2] = v
      }
    }
    rayCloud.commit()
  }

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
      // Turbidez: el sedimento en suspensión come visibilidad.
      scene.fog.density = 0.018 + eco.fog * 0.03
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
    updateRays(light)
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
