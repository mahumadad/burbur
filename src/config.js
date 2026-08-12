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
    // Ciclo celular (spec 2026-08-11-ciclo-y-division-celula.md §4): un
    // macrófago vive casi siempre en G0 y solo entra en ciclo con señal
    // mitogénica SOSTENIDA (nutrientes o inflamación) + energía. Es un
    // acontecimiento OCASIONAL, no un reloj. Ver sim/cellCycle.js. Tiempos
    // afinados para que se vea "de vez en cuando" (1ra división ~2.6 min de
    // mediana, intervalo ~1.6 min) con la mitosis bien visible (~20 s).
    cycle: {
      atpMin: 0.4,             // umbral de energía para entrar en ciclo
      mitogenicMedia: ['nutrient rich', 'inflamed'],  // prolifera con nutrientes o inflamación
      readinessRate: 0.12,     // ~8 s de señal sostenida para decidirse
      readinessDecay: 0.12,    // se desarma tan rápido como se arma
      g1: 10, s: 10, g2: 6, m: 14, cyto: 6,   // s por etapa (M+CYTO=20s visibles)
      refractory: 40,          // pausa entre divisiones
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
    // Balance corregido: con los valores viejos (gain 0.09, drain 0.32) la
    // producción (~0.14/s) no cubría la demanda a tensión normal (~0.18/s), así
    // que el presupuesto se drenaba a 0 — la célula nunca acumulaba señal para
    // el ciclo, y la motilidad quedaba débil. Ahora la producción supera la
    // demanda en medio bueno (el presupuesto sube y se sostiene) y solo se hunde
    // con hipoxia/ayuno (atpProdMul 0.4), que es cuando DEBE ampollarse.
    atp: { capacity: 26, speed: 0.42, arrive: 0.02, gainPerQuantum: 0.12, drain: 0.20 },
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
  // Mundo NEURONA: una microred cortical vista desde arriba. Los somas están
  // fijos; lo que se mueve es la señal. Ver
  // docs/superpowers/specs/2026-08-11-diseno-mundo-neurona.md
  neuron: {
    // Cableado de la red (sim/netwire.js): 12 neuronas (10 piramidales + 2
    // interneuronas) + 6 astrocitos. Topología dependiente de la distancia.
    network: {
      neurons: 12, inhibitory: 2, glia: 6, lambda: 0.5,
      degreeMin: 1, degreeMax: 4, interDegreeMin: 4, interDegreeMax: 6,
      interLocalR: 0.85, spread: 0.9, minSep: 0.26,
      axonPoints: 9, axonBend: 0.28, axonNoise: 0.02, nodes: 5,
    },
    somaR: 0.05,        // radio del soma (normalizado)
    height: 3.0,        // altura de la lámina neural sobre el plano
    // Propagación del potencial de acción (sim/spikes.js): al disparar una
    // neurona sale un pulso por cada axón saliente. El mielinizado va más rápido
    // (conducción saltatoria: salta de nodo en nodo) que el amielínico. Al llegar
    // al terminal empuja la fase de la postsináptica (+ excita / − inhibe), así
    // la actividad se PROPAGA visiblemente por la red.
    spikes: {
      neurons: 12,
      myelinatedSpeed: 1.7, unmyelinatedSpeed: 0.42, refractory: 0.16,
      fireThresh: 0.82,        // umbral de swarm.flash[i] para lanzar el pulso
      exciteBump: 0.85, inhibitBump: 0.6,   // empujón de fase a la postsináptica
      cap: 80, trail: 5,       // pool de pulsos en vuelo + puntos de estela
    },
    // Flujo CONTINUO de energía por cada axón: el murmullo de fondo que hace que
    // la red se lea VIVA (no como un diagrama). Los spikes reales corren encima.
    flow: { perAxon: 15, speed: 0.13, size: 0.95 },
    // Estado cerebral (sim/brainstate.js): el eje del mundo. Traduce el estado de
    // sueño y el neuromodulador en sincronía, ritmo, estados UP/DOWN, husos y la
    // convulsión. `syncPull` es la fuerza con que la red se acerca a su sincronía
    // objetivo cada frame. Tiempos en segundos.
    brain: {
      riskRate: 0.10, seizeExc: 2.6, seizeInh: 0.2, seizeDur: 9, postictalDur: 5,
      downMin: 0.7, downMax: 1.6, downDur: 0.4, spindleGap: 2.6, spindleDur: 1.0,
      syncPull: 1.6,
    },
    // Shock del botón AGITAR: una descarga que enciende TODO el sistema a la vez
    // (`dur` segundos de fogonazo) y después resetea y calma la red.
    shock: { dur: 0.7, flash: 1.0 },
    // Arbor dendrítico: árbol ramificado en el plano, congelado en el build.
    dendrite: { levels: 3, branches: 3, len: 0.16, lenDecay: 0.62, spread: 1.2, jitter: 0.22, spines: 4 },
    neuropil: 3800,     // puntos de fondo (la maraña de procesos que no se dibuja)
    capillarySegs: 44,  // segmentos de la línea serpenteante del capilar
    glia: { arms: 8, armLen: 0.11 },   // radios de la estrella del astrocito
    // Los astrocitos son los únicos que se desplazan, y muy lento (§3.1).
    wander: {
      density: 0.5, wanderTurn: 1.2, wanderPush: 0.010,
      kickMin: 0.02, kickRange: 0.03, separation: 0.06, sepRadius: 0.14,
      drag: 0.94, maxSpeed: 0.022, softR: 0.72, centerPull: 0.5, bound: 0.9,
      obstaclePush: 0, flowFreq: 3.0, flowPush: 0.008, pathPull: 0, pathRadius: 0.1,
    },
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
    // logSink: fracción del radio que queda ENTERRADA (el tronco se hunde en el
    // suelo, no apoyado encima). logBury: cuánto más se hunde la punta QUEBRADA
    // — moderado a propósito: con la punta muy hundida el quiebre asomaba apenas
    // un casquete y las astillas no tenían dónde verse.
    // logLift: cuánto se LEVANTA la punta cortada (+eje) para que su disco de
    // anillos apoye entero sobre el suelo, en vez de hundirse como la quebrada.
    substrate: { logAngle: 0.6, logCurve: 0.35, logArch: 0.07, logBury: 0.10, logLift: 0.05, logSink: 0.4, logHalfLength: 0.52, logRadius: 0.2, barkFrac: 0.18, sapwoodFrac: 0.42, carcasses: 4, litterDensity: 1, gridSize: 48, hardness: { bark: 1.4, sapwood: 0.6, heartwood: 1.8 } },
    // Ajustado al look de placa de cultivo (referencia del usuario): más puntas
    // = borde más plumoso; más ramificación + autotropismo = rosetón radial que
    // se esparce parejo; más widthGain = rizomorfos (cordones) marcados.
    // Rosetón de placa: `radial` orienta las puntas hacia afuera del inóculo
    // (crecimiento radial, no garabato). `tipSpeed` bajo + poco pre-crecido =
    // la colonia se toma el tronco DE A POCO, que es lo que se quiere ver.
    // Denso: muchas puntas y ramificación alta, pasos cortos.
    // Denso de verdad: el mat algodonoso de la referencia son MILES de hifas
    // finas, no un puñado de trazos. Los topes altos los banca la grilla
    // espacial de sim/mycelium.js (sin ella la vecindad era O(puntas × nodos)).
    mycelium: {
      maxNodes: 12000, maxEdges: 15000, maxTips: 700,
      stepLen: 0.020, tipSpeed: 0.038, turnRate: 1.6, noise: 0.55,
      // `radial` BAJO sobre la madera. El tronco es largo y angosto, así que
      // "hacia afuera del inóculo" es casi siempre "a lo largo del eje": con el
      // sesgo radial alto la colonia se estiraba en una LÍNEA sobre la cresta en
      // vez de tomarse la cara de arriba. Sobre el tronco manda el autotropismo
      // (se aparta de sí misma y cubre); el rosetón radial se reserva para la
      // tierra, vía `soil.radial`.
      tropism: 0.55, autotropism: 1.3, radial: 0.7, branchRate: 1.8,
      fuseRadius: 0.009, widthGain: 0.95, widthDecay: 0.10, flowDecay: 0.35,
      // `bound` amplio: la colonia forrajea hacia AFUERA y sigue expandiéndose
      // hasta llenar el disco (el suelo forrajeable de decay.js llega a 1.25).
      // Con un tope chico se plantaba en un radio fijo; ahora el frente avanza,
      // agota lo que pisa y abandona el interior, como una colonia real.
      pruneBelow: 0.1, pruneRate: 1.0, bound: 1.18,
      // Brote lateral: la red saca frentes nuevos del costado de hifas ya
      // hechas. Sin esto, en cuanto todas las puntas se fusionan la colonia se
      // queda sin frentes y el mundo se congela para siempre.
      lateralRate: 40,
      // Guerra entre colonias. Dos hongos incompatibles se reconocen ANTES de
      // tocarse y se frenan: queda una franja de nadie con una barrera
      // pigmentada — la "zone line" oscura de la madera podrida. Es competencia
      // por interferencia entre dos organismos, no reacción-difusión.
      antagonism: 1.8, barrierRate: 14,
      // Al llegar al canto del tronco, esta fracción de las puntas dobla y sigue
      // comiendo por la PANZA en vez de salir a la tierra.
      wrapChance: 0.45,
      // GRAVEDAD DE FLANCO: sobre la MADERA la punta deriva hacia el canto (la
      // dirección en que crece el offset perpendicular al eje), así BAJA por los
      // costados del tronco en vez de apiñarse en la cresta y escaparse axial al
      // suelo. Sin esto el 65% de la red se amontonaba en el 40% superior del
      // ancho y los flancos quedaban pelados. En la tierra no aplica.
      flankGravity: 1.6,
      // En TIERRA el micelio crece distinto: más rápido, mucho más ramificado y
      // más radial — el abanico algodonoso que se abre alrededor del tronco.
      // `speed` por debajo de 1: en la tierra el avance radial va MÁS LENTO que
      // sobre la madera, para que el abanico se abra despacio y se lo vea crecer.
      soil: { speed: 0.85, branch: 1.3, radial: 2.2, noise: 1.3 },
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
    // Bajo a propósito: la textura de la corteza la lleva la MALLA ILUMINADA
    // (placas + fisuras + luz rasante). Con el dither alto, estos puntos sin
    // iluminar se pintaban encima y aplanaban todo el relieve.
    logDither: 3800,        // puntos de textura del tronco
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
