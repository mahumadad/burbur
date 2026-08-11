// Paleta exacta observada en murmur (ningún verde: los agentes siempre contrastan con el pasto).
export const PALETTE = {
  white: 0xeef2ff,
  cyan: 0x10e6cf,
  pink: 0xff5fb0,
  magenta: 0xff1f8f,
  cyanEye: 0x16f0d8,
  orange: 0xff7a14,
  cyanSat: 0x35e6d2,
  yellow: 0xffe21a,
  blue: 0x2b48ff,
  bond: 0xffb15a,
}

export const CONFIG = {
  world: {
    radius: 85,          // radio de la isla (el del original)
    groundY: 0,
    dustCount: 3200,     // polvo del borde
  },
  // Mundo AGUA (pond). Valores de paridad del bundle de murmur (spec §4) + la
  // "riqueza tipo bosque" (densidad extra con la misma paleta) y los peces.
  pond: {
    lagoonRadius: 64,      // mt — radio de la laguna
    waterLevel: -3.4,      // ht — nivel del agua (relativo a groundY)
    lobeDepth: 11,         // gt — profundidad de los lóbulos del lecho
    hazeCount: 4200,       // Bt — niebla aditiva exclusiva de agua (radio mt*1.28)
    dustCount: 8500,       // Ut — polvo de borde
    reedBase: 736,         // Vt — juncos base (round(16*grass)*46)
    reedRichness: 3.0,     // factor de densidad extra sobre la base
    waterReflection: true, // híbrido on; false = reflejo falso (sin Reflector)
    fish: {
      schools: 3, perSchool: 30, spread: 0.82, yMin: -13.5, yMax: -3.9,
      maxSpeed: 0.06, sep: 0.9, align: 0.5, cohesion: 0.4,
      sepRadius: 0.05, neighborRadius: 0.14, wander: 0.5, turn: 2.0,
    },
  },
  // Deambular libre: estados move/rest + separación mutua.
  wander: {
    density: 0.66,
    wanderTurn: 2.2,     // deriva del ángulo (rad/s)
    wanderPush: 0.055,   // empuje continuo
    kickMin: 0.085,      // impulso al pasar a 'move'
    kickRange: 0.085,
    separation: 0.16,
    sepRadius: 0.10,
    drag: 0.965,
    maxSpeed: 0.095,
    softR: 0.58,         // cuenca amplia: dejan casi todo el disco libre
    centerPull: 1.0,     // fuerza suave (no los amontona al centro)
    bound: 0.84,         // tope duro
    obstaclePush: 3.5,   // fuerza para bordear árboles
    // Campo de flujo: corrientes coherentes que varían lento.
    flowFreq: 5.1,
    flowPush: 0.042,
    // Atracción a caminos. 0 = ignorarlos; alto = encauzar (calles de ciudad).
    pathPull: 0.055,     // bosque: los caminos son sendas preferidas, no rieles
    pathRadius: 0.14,
  },
  fireflies: {
    count: 18,           // agentes visibles (murmur usa 15)
    couplingK: 2.2,
    neighborRadius: 3.5,
    omegaMean: 1.1,
    omegaSpread: 0.18,
    bounds: { x: 12, y: 7, z: 10 },
    driftSpeed: 0.4,
  },
  paths: {
    loopCount: 3,
    minRadius: 0.34,
    maxRadius: 0.72,
    samples: 46,
  },
  events: {
    baseRate: 0.62,      // eventos/seg base (bosque ≈ 37/min a plena actividad)
    ambientProb: 0.35,   // fracción de sonidos sin agente (texturas)
  },
  // Bichitos voladores que van de flor en flor; algunos agentes los cazan.
  bugs: {
    count: 90,
    speed: 0.10,         // velocidad de vuelo (coords normalizadas/seg)
    arrive: 0.02,        // distancia para posarse en la flor
    hoverMin: 0.6, hoverMax: 2.2,  // segundos posado
    jitter: 0.45,        // zigzag del vuelo
    height: 3.4,         // altura de vuelo sobre el suelo
    bob: 0.9,            // cabeceo vertical
    fleeRadius: 0.06,    // huyen si un cazador entra aquí
    hunters: 3,          // agentes que cazan
    huntRadius: 0.22,    // radio de detección del cazador
    huntPull: 0.12,      // fuerza con que persigue
    catchRadius: 0.02,   // distancia para atrapar
    respawn: 2.5,        // segundos hasta reaparecer
  },
  behaviors: {
    perchers: 5, sky: 2,
    perchSpeed: 0.14, perchArrive: 0.03,
    perchMin: 4, perchMax: 9, riseRate: 1.6,
    skyHeight: 26,
  },
  ecosystem: {
    dayLengthSec: 540,   // día completo en 9 min → 45 s por fase
    weatherMinSec: 55,
    weatherMaxSec: 130,
  },
  ambient: {
    windPeriodSec: 23,
    cricketBaseRate: 6,
    owlChancePerSec: 0.03,
  },
  audio: {
    masterLimitDb: -3,
    flashPolyphony: 8,
    droneRootHz: 43.65,  // F1: más grave y oscuro (vibe Enter the Void, sub-bajos)
    volumes: { drone: -11.5, bed: -18, flash: -10 },  // el drone pesa más
  },
  // Mundo CÉLULA: un macrófago reptando sobre un sustrato, visto desde arriba.
  // Ver docs/superpowers/specs/2026-08-11-diseno-mundo-celula.md
  cell: {
    membrane: {
      verts: 128, baseR: 0.78, harmonics: 3, harmAmp: 0.05, harmSpeed: 0.12,
      protrusionAmp: 0.30, protrusionWidth: 0.85, tailPinch: 0.16,
      filoRate: 1.1, filoAmp: 0.15, filoWidth: 0.09, filoTtl: 2.2,
      blebRate: 2.2, blebAmp: 0.20, blebWidth: 0.30, blebRise: 0.12, blebFall: 0.9,
      relax: 0.16,
    },
    motility: {
      turnRate: 0.7, bias: 1.2, noise: 0.8,
      maxSpeed: 0.14, protrusionGain: 1.6, atpFloor: 0.3,
    },
    // Sustrato: se dibuja como un TILE periódico que se repite y hace wrap, así
    // nunca se acaba por mucho que la célula avance (antes se deslizaba fuera de
    // cuadro y todo parecía estático). Las fibras de matriz (ECM) dan la
    // dirección que un campo de puntos suelto no da: sin ellas no se ve el avance.
    substrate: {
      tile: 70,               // lado del tile (unidades de mundo)
      dotsPerTile: 150,
      fibersPerTile: 22,
      fiberDir: 0.6,          // orientación dominante de las fibras (rad)
      fiberSpread: 0.5,       // variación angular
    },
    // ~44 microtúbulos visibles (una célula real tiene cientos; ver spec §4.2bis).
    rails: {
      count: 44, originX: 0.06, originZ: -0.04,
      minLen: 0.28, maxLen: 0.72,
      growRate: 0.045, shrinkRate: 0.26, catastrophe: 0.12, rescue: 0.4,
    },
    atp: { capacity: 26, speed: 0.42, arrive: 0.02, gainPerQuantum: 0.09, drain: 0.32 },
    // Tráfico direccional (M3): kinesina lleva lo secretor (vesículas) hacia
    // afuera, dineína lo digestivo (lisosomas/endosomas) hacia el centro.
    traffic: { bias: 0.06, innerR: 0.12, outerR: 0.66 },
    // Motores caminando por los rieles (M5): puntos que recorren los
    // microtúbulos en ambos sentidos.
    motors: { count: 40, speed: 0.13, detachChance: 0.12, cargoChance: 0.5 },
    // Fusión y fisión mitocondrial (M9): la red se fusiona si dos quedan
    // cerca un rato, y se separa pasado un tiempo — igual que in vivo.
    mito: { fuseRadius: 0.07, fuseDelay: 0.6, fusedMin: 8, fusedMax: 20 },
    invaders: {
      // cullRadius ajustado: con margen ancho el pool se satura y dejan de
      // llegar invasores nuevos. Que se vayan pronto mantiene la rotación.
      capacity: 6, spawnRadius: 1.25, cullRadius: 1.5,
      bacteriumSpeed: 0.26, virionSpeed: 0.05,
      runMin: 0.8, runMax: 1.4, tumbleMin: 0.08, tumbleMax: 0.14,
      spawnEvery: 7,          // segundos entre llegadas
    },
    // Los organelos van SOBRE riel: pathPull alto, como las calles de la ciudad.
    wander: {
      density: 0.7, wanderTurn: 2.0, wanderPush: 0.022,
      kickMin: 0.05, kickRange: 0.06, separation: 0.05, sepRadius: 0.07,
      drag: 0.955, maxSpeed: 0.075, softR: 0.50, centerPull: 0.9, bound: 0.72,
      obstaclePush: 3.0,
      flowFreq: 4.2, flowPush: 0.075,   // el streaming domina sobre el paseo
      // Riel de verdad, pero no soldadura: con pathPull muy alto los organelos
      // se pegan a la línea exacta y parecen cuentas en un alambre.
      pathPull: 0.22, pathRadius: 0.20,
    },
    // Densidades según los modelos de referencia (spec §4.2bis): el realismo
    // es densidad molecular, no pocas formas grandes.
    ribosomes: 6400,
    substrateDots: 2600,
    cortexStrands: 190,
    lamelliMesh: 130,       // malla dendrítica del lamelipodio (segmentos máx)
    adhesions: 30,
    nucleusR: 0.30,
    pores: 46,              // poros nucleares visibles (reales: miles)
    channels: 22,           // proteínas de canal montadas en la membrana
    glycans: 16,            // glicoproteínas (espirales del glicocálix)
    ifLoops: 12,            // filamentos intermedios: jaula alrededor del núcleo
    mtBeads: 8,             // cuentas de tubulina α/β visibles por microtúbulo
    height: 3.2,            // altura de la lámina celular sobre el sustrato
  },
  // Mundo MICELIO: la red que crece y se come su propio tronco.
  // Ver docs/superpowers/specs/2026-08-11-diseno-mundo-micelio.md
  fungus: {
    // Tronco más chico y más esbelto que antes: así entra ENTERO en cuadro con
    // hojarasca alrededor (antes llenaba la pantalla y no se leía como tronco).
    // logCurve: curvatura del eje (rad por unidad de u) → tronco curvo tipo
    // banana, no un cilindro recto (referencia alikim: medio toro, arc = PI).
    // ARCO: el tronco se arquea como un puente — el centro se eleva (`logArch`,
    // la "guata" hacia arriba) y las dos puntas se HUNDEN en la tierra
    // (`logBury`), dejando un túnel debajo donde anidan los bichos. `logCurve`
    // es la curva horizontal (banana), aquí suave para no competir con el arco.
    // Tronco BAJO y grueso tirado en el suelo (referencia alikim), apenas
    // curvado: `logArch` chico = leve guata arriba (un huequito, no un portal);
    // `logBury` chico = las puntas se hunden un poco. `logCurve` suave.
    substrate: { logAngle: 0.6, logCurve: 0.35, logArch: 0.1, logBury: 0.06, logHalfLength: 0.52, logRadius: 0.2, barkFrac: 0.18, sapwoodFrac: 0.42, carcasses: 4, litterDensity: 1, gridSize: 48, hardness: { bark: 1.4, sapwood: 0.6, heartwood: 1.8 } },
    // Ajustado al look de placa de cultivo (referencia del usuario): más puntas
    // = borde más plumoso; más ramificación + autotropismo = rosetón radial que
    // se esparce parejo; más widthGain = rizomorfos (cordones) marcados.
    // Rosetón de placa: `radial` orienta las puntas hacia afuera del inóculo
    // (crecimiento radial, no garabato). `tipSpeed` bajo + poco pre-crecido =
    // la colonia se toma el tronco DE A POCO, que es lo que se quiere ver.
    // Denso: muchas puntas y ramificación alta, pasos cortos.
    mycelium: {
      maxNodes: 2600, maxEdges: 2800, maxTips: 260,
      stepLen: 0.020, tipSpeed: 0.038, turnRate: 1.6, noise: 0.55,
      tropism: 0.55, autotropism: 0.9, radial: 2.6, branchRate: 1.6,
      fuseRadius: 0.009, widthGain: 0.95, widthDecay: 0.035, flowDecay: 0.35,
      pruneBelow: 0.1, pruneRate: 0.5, bound: 0.62,
    },
    // Cuánto esfuerzo de forrajeo aplica cada punta por segundo. Es lo que
    // agota el sustrato y, por lo tanto, lo que hace que la red se remodele.
    eatRate: 2.2,
    // Fructificación (spec §7): se GANA cazando nitrógeno. Un nematodo cazado
    // suma `trapNitrogen`; al juntar `nitrogenThreshold` + choque de frío +
    // humedad, empujan los cuerpos fructíferos. Duraciones en segundos reales.
    fruiting: {
      nitrogenThreshold: 5, nitrogenCost: 5, trapNitrogen: 1.4,
      shockDelta: 2.5, shockWindow: 30, moistureMin: 0.25,
      co2Max: 0.62, lightMin: 0.5,
      primordiaDuration: 6, expandingDuration: 9, sporulatingDuration: 12, senescentDuration: 6,
      sporeRate: 26, deformedSporeFactor: 0.2,
    },
    // Trampa de nematodos (Pleurotus es nematófago): si un nematodo pasa sobre
    // el micelio a menos de esto, queda atrapado. Es lo que da el nitrógeno.
    trapRadius: 0.05,
    fauna: 10,              // agentes visibles de fauna del suelo
    litter: 900,            // puntos de hojarasca
    logDither: 11000,        // puntos de textura del tronco
  },
  render: {
    grassBlades: 112000,  // hojas como líneas de 2 segmentos
    flowerPatches: 95,
    berryClusters: 30,
    hazeCount: 5200,
    hazeColor: [0.12, 0.35, 1.0],  // azul frío (bosque); ciudad usaría naranja
    hazeAlpha: 0.15,
    // Cámara / lente
    fisheye: 0.6,        // fov = 50 + fisheye*72 = 93°
    chroma: 0.25,
    vigSize: 1.0,
    squareFrame: false,  // true = recuadro cuadrado (modo device 466x466)
    tintStrength: 0.3,   // cuánto vira el color con la hora (el brillo va aparte)
    // Profundidad de campo falsa
    dofFocus: 95,
    dofAperture: 0.2,
    // Estelas
    trailLen: 34,
    trailSize: 3.4,
    agentLineWidth: 0.9,  // grosor de las jaulas (px de dispositivo)
  },
}
