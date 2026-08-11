# Diseño del mundo CÉLULA (`cell`)

**Fecha:** 2026-08-11
**Estado:** diseño **aprobado** (decisiones cerradas en §9 el 2026-08-11). La capa pura de
motilidad ya está implementada (`src/sim/membrane.js`, `src/sim/motility.js`); el render (F1)
espera la extracción de `engine/*` que lidera la sesión de ciudad.
**Alcance:** un cuarto mundo del registro, hermano de `land` / `water` / `city`, cuyo tema central
es **cómo se mueve una célula**.
**Base técnica:** el motor tal como está hoy sobre `main` (merge `93eae1c`) —
`src/render/stage.js` (el escenario compartido ya extraído), `src/render/scene.js` (1630 líneas,
el bosque), `src/worlds/registry.js`, `src/main.js`, `src/sim/*`, `src/audio/engine.js`.
**Base biológica:** biología celular estándar (motilidad mesenquimal/ameboide, tráfico vesicular,
ciclo celular, fagocitosis). Referencias visuales: `digizyme.com/cst_landscapes.html` (paisajes
celulares de Goodsell/Iwasa — densidad molecular, todo lleno, nada flota en vacío),
`ebi.ac.uk/empiar` y `ebi.ac.uk/biostudies/BioImages` (crio-EM y microscopía real: la referencia
de *forma* de organelos), `free3d.com/3d-models/cell` (modelos, útiles solo como bocetos de
silueta — no se importan mallas, todo se genera por código como en los otros mundos).

> Convención del doc: cada decisión abierta se presenta con **opciones + recomendación marcada**.
> Los números biológicos son valores reales de literatura, redondeados; están ahí para calibrar
> proporciones y velocidades, no para simular física.

---

## 0. Resumen ejecutivo

- **El mundo es un macrófago reptando sobre un sustrato, visto desde arriba.** La isla del bosque
  se reemplaza por una **membrana deformable** que avanza. Todo lo demás del motor (vista aérea
  3/4, autorotación, jaulas wireframe, estelas, HUD, events log) se mantiene tal cual.
- **Los individuos con nombre son organelos**: mitocondrias, vesículas de transporte, lisosomas,
  endosomas, autofagosomas, más los **invasores** (bacterias, viriones) que entran por el borde.
- **El ATP no es un agente: es el enjambre de latidos.** El `swarm` Kuramoto que hoy hace parpadear
  a las luciérnagas y dispara las notas pasa a ser el pool de cuantos de ATP: nacen en las
  mitocondrias, viajan, se consumen. El acoplamiento de fases tiene además una lectura real
  (oscilaciones glucolíticas sincronizadas).
- **La hora del día pasa a ser el ciclo celular** (G1 → S → G2 → M → citocinesis) y el clima pasa a
  ser el **medio** (rico en nutrientes, hambre, hipoxia, estrés oxidativo, inflamación, acidosis).
- **Costo técnico honesto:** la primera capa del engine compartido (`src/render/stage.js`) ya está
  en `main` y el mundo célula se monta sobre ella, no sobre una copia del bosque. Falta todavía
  (a) la segunda capa de primitivas — puntos/líneas, geometría y movimiento de agente, estelas —
  que **lidera la sesión de CIUDAD** hacia `engine/*`: hay que coordinar firmas, no duplicar; y
  (b) parametrizar por mundo las tablas de `ecosystem` y `narrator`, que hoy son constantes de
  módulo. Detalle en §8.

---

## 1. Concepto: qué bioma es

### Opción A — Interior de la célula (paisaje citoplasmático)

La cámara está *dentro* de una célula quieta. El terreno es el citoplasma: retículo endoplásmico,
Golgi, núcleo como montaña central. Los agentes son organelos que circulan.

- ✅ Es el encaje más directo con el motor actual: isla fija, agentes deambulando dentro.
- ✅ Máxima densidad visual (es lo que hace bonito el estilo Goodsell/Digizyme).
- ❌ **No responde a la pregunta del usuario.** Aquí la célula no se mueve; se mueve su tráfico
  interno. La motilidad celular queda fuera de cuadro por completo.

### Opción B — Una célula reptando sobre un sustrato, vista cenital ⭐ **recomendada**

Es la vista de un microscopio de contraste de fase o TIRF: una célula aplanada sobre vidrio,
vista desde arriba, avanzando. **La membrana es la isla** — pero deja de ser un disco fijo: se
deforma (lamelipodio al frente, cola de retracción atrás) y se traslada.

- ✅ **Responde exactamente a lo que se pide**: la motilidad es el sujeto, no un detalle.
- ✅ **Contiene a la opción A**: como la célula está aplanada y se ve desde arriba, el interior
  (núcleo, ER, Golgi, organelos en tránsito) sigue siendo el terreno. B = A + movimiento.
- ✅ La vista aérea 3/4 con autorotación que ya tiene el motor es *literalmente* la vista de
  microscopía de una célula adherida. No hay que reinventar la cámara.
- ✅ Da un antagonista natural: el sustrato tiene un gradiente químico y hay invasores en él.
- ❌ Es el que más código nuevo pide: contorno deformable, protrusión/retracción, sustrato que
  se desliza, quimiotaxis. Es el costo de la feature pedida, no accidental.

### Opción C — Un tejido: monocapa de varias células

Un epitelio o un ensayo de cierre de herida. Cada célula es un individuo; lo interesante es la
migración colectiva.

- ✅ Muchos "individuos" con comportamiento coordinado — muy en el espíritu de murmur.
- ✅ Motilidad colectiva real y espectacular (dedos de migración, líderes y seguidores).
- ❌ A esa escala **desaparecen los organelos, el ATP y las bacterias**: cada célula sería un
  punto. Se pierde todo lo que el usuario preguntó explícitamente.
- ❌ Compite conceptualmente con `land`: "muchos bichos deambulando por un plano" ya existe.

### Recomendación

**Opción B.** Y las otras dos no se descartan, se agendan como capas posteriores:

- La riqueza de A se obtiene gratis dentro de B (el interior de la célula es el terreno).
- C entra después como **borde del mundo**: en el rim del sustrato se asoman fragmentos de células
  vecinas (contornos parciales, sin interior). Da contexto de tejido sin pagar el costo de C.

**Identidad de la célula: un macrófago.** Es la elección que hace creíbles todos los elementos
que se pidieron a la vez:

| Elemento pedido | Por qué un macrófago lo justifica |
|---|---|
| Motilidad marcada | Migra a 5–20 µm/min (un fibroblasto hace ~0.5 µm/min: sería estático en pantalla) |
| Quimiotaxis | Es su función: persigue gradientes de fMLP/C5a hacia el foco de infección |
| Bacterias como conflicto | **Las fagocita**: el conflicto es la célula cazando, igual que los cazadores del bosque |
| Virus como amenaza | Los macrófagos sí se infectan (VIH, dengue): la amenaza silenciosa que la fagocitosis no cubre |
| Lisosomas protagonistas | Su compartimento lítico es enorme y activo — no es un detalle de fondo |
| Estrés oxidativo | El estallido respiratorio (ROS) es literalmente su arma |
| Apoptosis | Cierre narrativo creíble tras infección o daño sostenido |

Un fibroblasto daría un mundo más quieto y sin depredación; una ameba (*Dictyostelium*) daría una
motilidad aún más espectacular pero pierde el marco inmune y los invasores. El macrófago es el que
maximiza eventos narrables por unidad de código.

---

## 2. Los agentes

Se conserva la distinción del bosque entre **agentes visibles** (los ~18 con jaula wireframe,
nombre y estela — `pop.visible`), **censo invisible** (aparece en el log pero no en pantalla —
`pop.census`), y **props/partículas** (masa visual sin identidad: pasto, bichitos, polvo).

### 2.1 Agentes visibles — con jaula, nombre, estela y voz

| Agente | Tipo (`agentType`) | Nº típico | Movimiento | Base biológica |
|---|---|---|---|---|
| **mitochondrion** | `organelle` | 4–5 | Se desplaza por microtúbulos, lento; se detiene donde hay demanda de ATP. Se **fusiona y fisiona** con otras | 1–3 µm, red dinámica; la fusión/fisión ocurre en minutos |
| **transport vesicle** | `organelle` | 3–4 | El más rápido y direccional: Golgi → membrana **hacia afuera** (kinesina) | 50–100 nm; ~0.5–1 µm/s sobre el riel |
| **lysosome** | `organelle` | 2–3 | Se mueve **hacia el centro** (dineína); patrulla la periferia y vuelve | Compartimento ácido (pH ~4.5) |
| **early endosome** | `organelle` | 2 | Nace en la membrana (endocitosis), migra al centro, madura a tardío | El "correo entrante" |
| **autophagosome** | `organelle` | 0–2 | **Solo aparece con hambre o daño**; engulle material y busca un lisosoma | Autofagia inducida por ayuno — encaja con el estado `serum starved` |
| **peroxisome** | `organelle` | 1 | Deriva casi sin dirección, movimiento browniano | Da variedad de movimiento: no todo va sobre rieles |
| **bacterium** | `invader` | 0–2 | **Run-and-tumble**: carreras rectas ~1 s + volteretas ~0.1 s | *E. coli* 2×0.5 µm, ~20–30 µm/s. Movimiento visiblemente ajeno al resto |
| **virion** | `invader` | 0–3 | **Difusión pura** hasta tocar la membrana, luego se pega y entra | 50–150 nm; no tiene motor propio — se mueve por choques |

**Por qué los motores (kinesina/dineína) no son agentes visibles:** individualmente son 10 nm y hay
millones. Como jaulas con nombre serían ruido; como partículas caminando sobre los rieles son la
textura que hace legible el transporte. Van en §2.3.

**Direccionalidad como lenguaje visual (detalle real y muy legible):** kinesina camina hacia el
extremo **+** del microtúbulo (la periferia), dineína hacia el **−** (el centro). Entonces el
tráfico tiene dos sentidos claros sobre los mismos rieles: **lo secretor va hacia afuera, lo
digestivo va hacia adentro**. Un espectador entiende el flujo sin leer una etiqueta.

### 2.2 Censo invisible — sin jaula, con voz en el log

Equivalen a `static_object` del bosque: no se mueven pero suenan y se narran.

`nucleus` · `nucleolus` · `Golgi apparatus` · `rough ER` · `smooth ER` · `centrosome (MTOC)` ·
`actin cortex` · `focal adhesion` · `proteasome` · `ribosome cluster` · `ion pump` ·
`nuclear pore` · `stress fiber`

Todos son **estructuras** (`agentType: 'structure'`), salvo `focal adhesion` que además nace y
muere en pantalla (§3.4) y da eventos propios.

### 2.3 Props y partículas — masa visual, sin identidad

| Prop | Equivale en el bosque a | Rol |
|---|---|---|
| **Cuantos de ATP** | Las luciérnagas / el `swarm` | Ver §2.4 — el corazón del mundo |
| **Motores caminando** (kinesina/dineína) | Los bichitos (`bugs`) que van de flor en flor | Puntos que recorren los rieles entre "estaciones"; se puede reusar `behaviors.js` casi tal cual, cambiando *flores* por *nodos del citoesqueleto* |
| **Ribosomas** | El polvo / los hongos | Miles de puntos densos sobre el ER rugoso — la firma visual del estilo Goodsell |
| **Filamentos de actina cortical** | El pasto | Hebras cortas y densas en el borde, con degradado vertical (el mismo shader) |
| **Microtúbulos** | Los senderos (`paths`) | Rieles radiales desde el centrosoma; aquí `pathPull` es **alto** (como las calles de la ciudad) |
| **Adhesiones focales** | Las flores (POI) + las estelas | Nacen bajo el lamelipodio, quedan fijas al sustrato, mueren en la cola |
| **ROS** (especies reactivas) | La lluvia | Solo con `oxidative stress`: puntos que impactan y dañan |
| **Moléculas del medio** | El polvo del borde | Fuera de la membrana, densidad de fondo |

### 2.4 El ATP: el hallazgo de diseño

**El ATP no debe ser un agente. Debe ser el `swarm`.**

Hoy `src/sim/fireflies.js` mantiene un enjambre de osciladores Kuramoto: cada individuo tiene una
fase, se acoplan con sus vecinos, y **cada vez que una fase cruza 2π se emite un flash** que
`main.js` convierte en una nota (`audio.triggerFlash`). Ese mecanismo ya está construido, probado
(`test/fireflies.test.js`) y es lo que produce la música del mundo.

Reinterpretado en la célula:

- Un **cuanto de ATP** = un punto brillante amarillo (`PALETTE.yellow`).
- **Se genera** en una mitocondria: el flash ocurre *en la posición de la mitocondria*, no en un
  punto arbitrario del volumen. Visualmente: la mitocondria late y suelta un destello.
- **Viaja** hacia un consumidor (un motor caminando, una bomba iónica de la membrana, el frente de
  polimerización de actina) y **se consume** al llegar: segundo destello, más apagado.
- **El acoplamiento de fases tiene base real**: las oscilaciones glucolíticas de una población
  celular se sincronizan (fenómeno documentado en levadura, período de minutos). Que las
  mitocondrias tiendan a latir juntas no es licencia poética.
- **El presupuesto de ATP es la variable de estado del mundo**: con hipoxia baja, la protrusión se
  frena, los motores caminan más lento, la célula casi se detiene. Con nutrientes altos, todo
  acelera. Es un único número que acopla economía, movimiento y sonido — exactamente lo que el
  bosque hace con `activity`.

Números para calibrar: una célula contiene ~10⁹ moléculas de ATP y **recicla su pool entero cada
1–2 minutos**. Un cuanto en pantalla puede representar ~10⁶ moléculas; con 18 cuantos vivos y un
recambio de ~10 s en pantalla, la proporción "se consume tan rápido como se produce" se lee bien.

---

## 3. Motilidad — el núcleo del mundo

El ciclo de migración real tiene cuatro pasos que se solapan. El diseño los modela como cuatro
sistemas que corren en paralelo, cada uno con una lectura visual distinta.

### 3.1 Polarización — la célula decide dónde está el frente

Una célula migratoria establece un eje: al frente, actina ramificada empujando (vía Rac/PIP3);
atrás, actomiosina contrayendo (vía RhoA). No es un timón: es una **decisión bioquímica que se
mantiene por minutos y se puede reorientar**.

Modelo: un ángulo `frontAngle` con inercia alta y ruido bajo, empujado hacia la dirección del
gradiente químico. La reorientación no es instantánea — la célula "duda" antes de girar, que es
justo lo que se ve en un video real.

### 3.2 Protrusión — la membrana como contorno deformable

La membrana deja de ser un círculo. Es un **polígono de ~128 vértices en coordenadas polares**:

```
r(θ, t) = r₀ · (1 + armónicos lentos)      ← forma base, respira
        + protrusión(θ)                     ← lamelipodio: gaussiana ancha centrada en frontAngle
        + filopodios(θ)                     ← 2–5 picos finos, exploratorios, efímeros
        + blebs(θ)                          ← ampollas: pulsos rápidos, ver abajo
        − retracción(θ)                     ← cola: se estrecha en la dirección opuesta
```

- **Lamelipodio**: ancho angular ~60–90°, amplitud proporcional al ATP disponible. Se **ondula**
  (*ruffling*: ondas que corren lateralmente por el borde frontal) — detalle muy característico
  del video real y barato de implementar como fase que corre sobre θ.
- **Filopodios**: dedos finos que salen, tantean y se reabsorben en 1–3 s. Son los que dan la
  sensación de que la célula *explora*.
- **Blebbing** (motilidad ameboide): cuando la corteza de actina se despega localmente, la presión
  hidrostática infla una ampolla en ~0.1 s que se reabsorbe en ~1 s. Se activa cuando la
  contractilidad es alta, el ATP es bajo, o hay estrés. **Alternar lamelipodio ↔ blebbing según el
  estado es la forma más clara de mostrar que hay más de una manera de moverse.**
- **Redondeo mitótico**: durante la fase M la célula **se redondea y deja de reptar** (fenómeno
  real y dramático). El contorno colapsa a un círculo, la migración se detiene, y al terminar la
  citocinesis se re-polariza. Da un ritmo narrativo al "día" del mundo.

### 3.3 Traslación — decisión de cámara

Si la célula avanza, o se mueve ella o se mueve el mundo bajo ella.

**Opción 1 — La célula se traslada y la cámara la sigue.** Fiel, pero pelea con dos cosas que ya
funcionan: `OrbitControls` con `autoRotate` alrededor del origen, y la cuenca `softR/centerPull` de
`wander.js` que asume mundo centrado en (0,0).

**Opción 2 — La célula queda centrada y el sustrato se desliza bajo ella ⭐ recomendada.** El
avance se comunica por tres canales a la vez:
1. El **sustrato se desliza** hacia atrás (fibras de matriz, textura, marcas — solo un offset).
2. La **forma polarizada** (lamelipodio adelante, cola atrás) dice hacia dónde.
3. Las **adhesiones focales** nacen adelante, se quedan fijas *al sustrato* y por tanto desfilan
   hacia atrás relativas a la célula hasta desprenderse en la cola. **Este es el indicador de
   velocidad más honesto**: es exactamente lo que se mide en un experimento real.

Es más barato, no toca la cámara ni la cuenca de `wander.js`, y produce la misma lectura. Se
recomienda la 2.

### 3.4 Adhesión y retracción — el ciclo se cierra

- Bajo el lamelipodio nacen **adhesiones focales** (puntos brillantes alargados, orientados en el
  eje de tracción). Maduran (crecen, se estabilizan), y al llegar a la cola **se desprenden**.
- Las **fibras de estrés** son líneas largas que cruzan el cuerpo conectando adhesiones opuestas —
  el "esqueleto de tensión" visible.
- La retracción de la cola es abrupta: la adhesión se suelta y el borde salta hacia adelante. A
  veces deja **fibras de retracción** (hilos finos que quedan atrás y se rompen) — un detalle
  pequeño con mucho retorno visual.
- **Velocidad de la célula = protrusión × adhesión.** Con adhesión demasiado baja, patina (protruye
  pero no avanza); con adhesión demasiado alta, se ancla. Esta es la curva bifásica real del modelo
  motor-clutch, y da una palanca de "clima" con consecuencia visible inmediata.

### 3.5 Streaming citoplasmático — reutilizar lo que ya existe

`src/sim/wander.js:29` ya tiene un **campo de flujo sinusoidal que varía lento en el tiempo** y
hace que los individuos deriven en corrientes coherentes. Eso es, literalmente, ciclosis. No hay
que escribir nada nuevo, solo re-balancear el config:

| Parámetro | Bosque | Célula | Por qué |
|---|---|---|---|
| `flowPush` | 0.042 | **alto** | En el citoplasma la corriente domina sobre la decisión individual |
| `wanderPush` | 0.055 | **bajo** | Los organelos no "deciden" pasear: derivan y son arrastrados |
| `pathPull` | 0.055 | **alto** | Los microtúbulos sí son rieles, no sendas sugeridas (como las calles de la ciudad) |
| `separation` | 0.16 | **bajo** | El citoplasma está abarrotado: se rozan, no se evitan |

Un añadido propio y muy visible: **flujo retrógrado de actina**. Cerca del borde frontal, la red de
actina fluye *hacia atrás* mientras el borde avanza (se ve clarísimo en TIRF). Es un término de
flujo local, en dirección opuesta a la protrusión, aplicado solo en la banda periférica frontal.

### 3.6 Quimiotaxis — la célula persigue algo

Una fuente de quimioatrayente en el sustrato (una bacteria, un foco inflamatorio). El mecanismo
real no es "apuntar y avanzar": es un **paseo aleatorio sesgado** — la célula compara concentración
entre su frente y su cola (un gradiente de ~2 % a lo largo de 20 µm basta) y sesga la probabilidad
de mantener el rumbo. Modelarlo así, y no como persecución directa, es lo que hace que se vea viva.

Cuando la fuente se alcanza (la bacteria es fagocitada) aparece otra en otro punto del sustrato, y
la célula reorienta con toda la lentitud del caso.

---

## 4. Cómo se ve

### 4.1 Continuidad con la estética del proyecto

Se mantienen sin excepción las reglas de `2026-08-10-lenguaje-visual.md`:

- **Diorama flotando en negro**, viñeta fuerte, fisheye 93°, aberración cromática, DOF falso.
- **Wireframe + puntos por vértice**: `WireframeGeometry`/`EdgesGeometry` con `LineMaterial` de
  grosor constante en pantalla, y nubes de puntos con tamaño en unidades de mundo.
- **Dos registros superpuestos**: el registro "orgánico" (aquí: el interior denso y abarrotado, al
  estilo Digizyme — nada de vacío entre estructuras) contra el registro "esquemático" (las jaulas
  de los organelos flotando sobre él). La tensión entre ambos es la identidad del proyecto y aquí
  funciona incluso mejor que en el bosque: **una célula real *es* un diagrama denso**.
- **Sin relleno** en las jaulas; **marcador interno** de rumbo; **estela punteada** apoyada en el
  plano.

### 4.2 Geometría por elemento

| Elemento | Construcción |
|---|---|
| **Membrana** | Doble contorno paralelo muy junto (la bicapa) + un punto por vértice (cabezas de fosfolípidos). El frente activo se dibuja más brillante y con más puntos |
| **Núcleo** | Esfera wireframe grande y translúcida + anillos pequeños en su superficie (poros nucleares) + líneas enredadas dentro (cromatina). En fase M la cromatina **se condensa en cromosomas** discretos |
| **Nucleolo** | Nube densa de puntos dentro del núcleo |
| **ER rugoso** | Red poligonal de láminas alrededor del núcleo + miles de puntos encima (ribosomas) |
| **Golgi** | 4–6 arcos apilados y ligeramente curvos, cerca del núcleo |
| **Mitocondria** | Cápsula alargada wireframe con **líneas transversales internas** (las crestas). Es la silueta que se reconoce al instante |
| **Vesícula** | Icosaedro pequeño wireframe. Nota grata: la cubierta real de clatrina se llama **"cage"** en la literatura — el mismo nombre que la jaula del motor |
| **Lisosoma** | Esfera wireframe con relleno granular de puntos densos |
| **Autofagosoma** | Doble membrana: dos esferas concéntricas wireframe |
| **Microtúbulos** | Líneas radiales desde el centrosoma, con extremos que **crecen y se colapsan** (inestabilidad dinámica: crece lento, se derrumba de golpe) |
| **Actina cortical** | Hebras cortas y densas tangenciales al borde interno, con degradado vertical — el shader del pasto, reorientado |
| **Fibras de estrés** | Pocas líneas largas y gruesas cruzando el cuerpo entre adhesiones |
| **Adhesión focal** | Segmento corto y brillante, orientado en el eje de tracción; brilla al madurar, se apaga al soltarse |
| **Bacteria** | Bastón wireframe + flagelo helicoidal que rota visiblemente |
| **Virión** | Icosaedro diminuto con espículas radiales. Casi invisible por tamaño real — se le da un halo tenue |

### 4.2bis Estructuras reales — recetas extraídas de modelos 3D (2026-08-11)

El usuario aportó 4 modelos 3D reales y pidió estructuras "más reales y complejas". Siguiendo la
regla del proyecto (**no adivinar a ojo — extraer de la fuente**), se parsearon los archivos:

| Archivo | Qué se extrajo | Lección |
|---|---|---|
| `animal-cell-20-annotated` (.blend) | **2015 esferas instanciadas**, 7 curvas Bézier, roundcubes, textura de Golgi | El realismo es sobre todo **densidad molecular**: miles de puntitos, no pocas formas grandes |
| `cell-membrane` (.fbx, parseado nodo a nodo) | 1 esfera de **84 240 vértices** (campo de cabezas lipídicas) + **espirales** (glicoproteínas) + **toros** (canales) + **hexágonos** (balsas) + base | La membrana real no es una línea: es un campo de cabezas + **proteínas transmembrana** que la tachonan |
| `Citoesqueleto` (.usdz) | Texturas nombradas: `alfabeta` (dímeros de tubulina), `cilindrosazules` (microtúbulos), `trenza/trena` (actina trenzada), `muelle` (filamento intermedio), `estrellas` (áster), `pliegues`, `bolitas` | Cada filamento tiene firma visual propia: MT = cilindro con cuentas α/β; actina = **trenza de 2 hebras**; FI = **muelle** |
| `Mitochondria` (.usdz, 10.4 MB) | Un solo mesh esculpido con crestas | La mitocondria se lee por sus **crestas transversales onduladas**, no por barras rectas |

Anclas cuantitativas (literatura/Allen Cell Explorer; HCA es transcriptómica, no morfología):
célula extendida ~40 µm, núcleo ~1/3 del diámetro (✅ ya), **poros nucleares miles** (visibles:
decenas, no 14), **microtúbulos cientos** irradiando del centrosoma (visibles: ~44, no 16),
centrosoma = **2 centriolos ortogonales** de 9 tripletes, Golgi = cinta de **5–7 cisternas** con
vesículas brotando del borde, ER **continuo con la envoltura nuclear**: láminas rugosas cerca +
red tubular con **uniones de 3 vías** hacia la periferia, ribosomas ~10⁷ (el `.blend` usa 2015
esferas: subimos los puntos), lamelipodio = malla dendrítica ramificada a ~70° (Arp2/3),
filamentos intermedios = jaula ondulada alrededor del núcleo.

Recetas de render (todas dentro del look matrix — líneas finas + puntos):

1. **Membrana**: bicapa (2 contornos) + cabezas + **canales** (circulitos montados sobre el
   contorno, del toro del FBX) + **glicoproteínas** (espirales cortas hacia afuera, el glicocálix).
2. **Núcleo**: **doble envoltura** (2 esferas wireframe casi pegadas), ~46 poros como anillos
   estáticos, cromatina densa, nucleolo.
3. **ER**: láminas plegadas junto al núcleo (continuas con la envoltura) + red tubular poligonal
   con uniones de 3 vías; ribosomas sobre las láminas y libres.
4. **Golgi**: cinta de 6 cisternas × 5 capas con jitter + **vesículas brotando** en los bordes.
5. **Microtúbulos**: par de líneas casi paralelas (se lee cilindro) + **cuentas alternadas** α/β
   (2 tonos) que siguen al riel al crecer/colapsar; **centrosoma** = 2 barriles ortogonales de
   9 líneas + material pericentriolar (puntos).
6. **Actina cortical**: cada hebra = **2 sub-hebras trenzadas** (sinusoides en contrafase);
   lamelipodio = malla ramificada ±35° respecto del radio, densidad ∝ protrusión.
7. **Filamentos intermedios**: 10–14 lazos ondulados en jaula alrededor del núcleo.
8. **Mitocondria (agente)**: cápsula (anillos en los extremos + 4 largueros curvos) con
   **crestas en zigzag** transversales dentro.

### 4.3 Paleta

Se reutiliza `PALETTE` de `src/config.js` sin inventar colores nuevos — es la paleta exacta de
murmur, compartida por los tres mundos, y el proyecto tiene la regla de no meter verde (los agentes
siempre contrastan con el sustrato).

| Elemento | Color | Lectura |
|---|---|---|
| Membrana (contorno) | `white` `#EEF2FF` | Neutra, define el límite |
| Frente activo / lamelipodio | `cyan` `#10E6CF` | Donde pasa la acción |
| Actina cortical | `cyanSat` `#35E6D2` | Textura de borde |
| Microtúbulos | `blue` `#2B48FF` | Rieles, tenues, al fondo |
| Mitocondria (cuerpo / crestas) | `orange` `#FF7A14` / `yellow` `#FFE21A` | Energía = cálido |
| **Cuantos de ATP** | `yellow` `#FFE21A` | El latido del mundo |
| Vesícula de transporte | `pink` `#FF5FB0` | Carga en tránsito |
| Lisosoma | `pink` `#FF5FB0` + interior `magenta` | Compartimento ácido |
| Núcleo / cromatina | `white` / `bond` `#FFB15A` | Centro de gravedad |
| Adhesiones focales | `bond` `#FFB15A` | Anclaje al sustrato |
| **Invasores** | `magenta` `#FF1F8F` **+ parpadeo** | Ver nota abajo |
| Fibras de estrés | `bond` `#FFB15A` tenue | Tensión mecánica |

**Nota sobre los invasores:** `magenta` queda cerca del `pink` de vesículas/lisosomas. La
diferenciación se resuelve por **movimiento y ritmo**, no solo por color: la bacteria hace
run-and-tumble (nada que ver con el resto), el virión difunde a tirones, y ambos **parpadean** en
un ciclo lento que ningún organelo tiene. Alternativa si en pantalla no basta: usar el rojo
`#FF1F17` que el bundle original ya reserva para aristas de agente (documentado en
`2026-08-11-mapa-otros-mundos.md` §2) exclusivamente para invasores.

**Color de acento del mundo** (el `--accent` del HUD, el de la tabla `hg`): los tres existentes son
pasteles suaves — `#b6d184` land, `#aacdff` water, `#fab75e` city. Para célula se propone
**`#c9a6ff`** (violeta pastel): no colisiona con ninguno, y el violeta es la convención de tinción
en histología. Es un color nuevo, no del bundle — queda marcado como decisión propia.

---

## 5. Clima y estados equivalentes

`src/sim/ecosystem.js` produce hoy: `phase` (12 fases horarias), `weather` (5 estados),
`temperature`, `activity`, `tension`, `rain`, `fog`, `light`, `gain`. El mundo célula **conserva
la misma estructura y los mismos campos** y solo cambia el contenido de las tablas.

### 5.1 Las 12 "fases del día" → el ciclo celular

| # | Fase | Actividad | Tensión | Lectura visual |
|---|---|---|---|---|
| 0 | `G1 early` | media | baja | La célula crece, migra tranquila |
| 1 | `G1` | media-alta | baja | Migración plena, tráfico normal |
| 2 | `G1/S checkpoint` | **alta** | media | Pausa breve, el núcleo se ilumina |
| 3 | `S phase` | alta | media | Replicación: el núcleo brilla y late |
| 4 | `S late` | alta | media | " |
| 5 | `G2` | media | media | Crecimiento, la célula se ensancha |
| 6 | `G2/M checkpoint` | baja | **alta** | Todo se frena, tensión máxima |
| 7 | `prophase` | baja | alta | **La célula se redondea, deja de reptar**; la cromatina se condensa |
| 8 | `metaphase` | muy baja | **muy alta** | Cromosomas alineados en el ecuador; huso mitótico visible |
| 9 | `anaphase` | **pico** | alta | Los cromosomas se separan de golpe — el clímax del día |
| 10 | `telophase` | alta | media | Se reforman dos núcleos |
| 11 | `cytokinesis` | alta | baja | El anillo contráctil estrangula; **evento de división** |

Es el equivalente exacto al `dawn chorus` del bosque: un ciclo con un clímax reconocible. Tras la
citocinesis, la célula se re-polariza y vuelve a G1 — el mundo reinicia.

**Licencia de escala declarada:** el ciclo real dura ~24 h y la mitosis ~1 h; aquí caben en los
540 s de `dayLengthSec`. La motilidad y el tráfico, en cambio, corren a velocidad casi real
(1–4×). Son dos relojes distintos y es deliberado — el bosque hace exactamente lo mismo (el día
son 9 minutos pero los pájaros vuelan a velocidad de pájaro).

### 5.2 Los 5 "climas" → el medio

| Estado | act | tension | Efecto en el mundo |
|---|---|---|---|
| `nutrient rich` | 1.00 | 0.05 | ATP abundante, protrusión amplia, tráfico denso. El "dry still" |
| `serum starved` | 0.70 | 0.25 | ATP escaso, protrusión corta, **aparecen autofagosomas** |
| `hypoxic` | 0.55 | 0.35 | ATP muy bajo, las mitocondrias se apagan, **cambia a blebbing** (no alcanza para lamelipodio) |
| `oxidative stress` | 0.60 | 0.55 | **ROS**: puntos que impactan y dañan. Las mitocondrias se fragmentan |
| `inflamed` | 1.15 | 0.45 | Migración rápida, **más invasores**, ondas de Ca²⁺ frecuentes |
| `acidic (low pH)` | 0.65 | 0.40 | Todo lento, los lisosomas se activan, la membrana se ampolla |

(Son 6; el bosque usa 5 — el motor no impone el número.)

### 5.3 Reasignación de los campos existentes

| Campo del core | En el bosque | En la célula |
|---|---|---|
| `temperature` | °C del aire | **°C literal**: 37 homeostasis, 39–40 fiebre (todo acelera), 33 hipotermia (todo se frena). Es correcto biológicamente y **no obliga a tocar el HUD** |
| `rain` | Lluvia | **Densidad de partículas del medio barriendo** la célula (flujo de fluido); con `oxidative stress` son ROS que impactan |
| `fog` | Niebla | Densidad del medio: cuánto se difumina el sustrato lejano |
| `light` / `gain` | Color de la luz del día | Tinte según la fase del ciclo: frío en G1/S, cálido y brillante en mitosis |
| `activity` | Actividad de la fauna | **Presupuesto de ATP** — la variable que acopla todo |
| `tension` | Tensión del ecosistema | Tensión mecánica + estrés celular; modula el drone igual que hoy |
| `flash()` + trueno | Relámpago | **Onda de Ca²⁺**: destello que barre la célula (5–30 µm/s, la cruza en 1–3 s) + retumbo grave. Se dispara con `inflamed` o al fagocitar |

El **pH** no reemplaza a `temperature`: entra como estado de medio (`acidic`). Mostrarlo como campo
propio del HUD requeriría que `createHud` acepte etiqueta y unidad por mundo — mejora deseable pero
no bloqueante; queda anotada en §8.4.

---

## 6. Sonido

Todo con Tone.js sintetizado, sin samples, igual que hoy. La regla estética: **el mundo es
pequeño, así que todo sube en frecuencia y se vuelve más cristalino** que el bosque.

### 6.1 Reutilizando el grafo existente

| Pieza actual | En la célula |
|---|---|
| `drone` (voces graves detuned + filtro con LFO) | Zumbido del citoplasma / potencial de membrana. Más grave, más lento, más movimiento de filtro |
| `bed` (ruido rosa filtrado, modulado por `setWind`) | **Ruido browniano del citosol**, modulado por la intensidad del streaming citoplasmático |
| `triggerFlash` (nota por cada flash del swarm) | **Una nota corta por cada cuanto de ATP** — el mecanismo ya está y encaja perfecto |
| `setMood(tension)` | Igual: el drone se pone resonante con la tensión |
| `thunder()` | Onda de Ca²⁺: barrido descendente + sub |
| `drip()` | **Exocitosis**: el "plop" de una vesícula fusionándose con la membrana |
| `rattle()` (shake) | Igual, pero el shake pasa a ser **choque mecánico / estiramiento del sustrato** |

Escala: el bosque usa pentatónica menor (`audio/scale.js`). Para la célula se propone **pentatónica
mayor o modo lidio, una o dos octavas arriba** — más limpio y menos melancólico, coherente con un
mundo de maquinaria en funcionamiento. `flashToFreq` ya existe y solo cambia de rango.

### 6.2 Voces nuevas

| Fuente | Textura |
|---|---|
| **Mitocondria produciendo** | Pulso rítmico grave y suave — el bombeo de protones. Tren de clicks filtrados |
| **Motor caminando** (kinesina) | Tic regular muy tenue. Real: 8 nm por paso, ~100 pasos/s → sonificado a ~8 Hz es audible y rítmicamente hipnótico |
| **Vesícula fusionando** | El `drip` existente, con reverb corto |
| **Lisosoma degradando** | Siseo ácido: ruido pasa-altos con envolvente lenta |
| **Bacteria** | Zumbido de flagelo: ruido pasa-banda modulado (la rotación real es ~100 Hz) |
| **Virión** | **Silencio.** Su llegada se marca con una nota disonante muy aguda y brevísima. La amenaza que no suena es más inquietante que la que suena |
| **Polimerización de actina** | Crepitar finísimo y continuo en el borde frontal, proporcional a la protrusión |
| **Mitosis** | El drone sube durante metafase, **silencio en anafase**, y un golpe grave en la citocinesis |

---

## 7. Events log

El narrador (`src/sim/narrator.js`) es gramatical: plantillas por tipo de evento × léxico por tipo
de agente. La célula necesita su propio léxico, no un motor nuevo. **Se mantiene el inglés**, por
consistencia con los otros tres mundos.

### 7.1 Léxico por tipo de agente

```
organelle:  'pulses, releasing a quantum' / 'docks and unloads its cargo' /
            'slides along a microtubule' / 'stalls, waiting for a motor' /
            'buds off from the Golgi' / 'fuses with a neighbour'
invader:    'tumbles, then runs' / 'drifts against the membrane' /
            'probes for a receptor' / 'slips past the cortex'
structure:  'hums with transcription' / 'stacks another cisterna' /
            'ratchets forward at the edge' / 'holds the tension'
motor:      'steps, and steps again' / 'lets go and rebinds'
signal:     'sweeps across the cytoplasm' / 'fades at the far edge'
```

### 7.2 Eventos ambientales (sin agente)

```
"A ripple runs along the leading edge."
"Somewhere near the cortex, actin gives way."
"A filopodium reaches out, finds nothing, retracts."
"The cytoplasm settles into a slower stream."
"Deep in the nucleus, a pore opens and closes."
```

### 7.3 Eventos narrados de ejemplo

| Tipo | Texto del log |
|---|---|
| `sound` | *The mitochondrion pulses; a quantum of ATP breaks loose to the left.* |
| `sound` | *A transport vesicle slides along a microtubule, up ahead.* |
| `interaction` | *A transport vesicle docks at the Golgi and unloads its cargo.* |
| **Fagocitosis** (`conflict`) | *The lamellipodium folds over the bacterium. The phagosome seals.* |
| **Infección viral** (`conflict`) | *A virion binds the membrane and slips inside, unnoticed.* |
| **Fusión mitocondrial** | *Two mitochondria meet and become one; the network reconnects.* |
| **Onda de calcio** | *A calcium wave sweeps the cytoplasm from the leading edge.* |
| **Producción de ATP** | *The mitochondrial network runs hot; the pool refills.* |
| **Autofagia** | *An autophagosome closes around a spent organelle and goes looking for a lysosome.* |
| **División celular** | *The contractile ring tightens. The cell divides.* |
| **Apoptosis** | *The membrane begins to bleb. The nucleus condenses. Nothing is coming back.* |
| `shift` (ciclo) | *The cycle turns toward S phase; the chromatin loosens.* |
| `shift` (medio) | *Serum runs out. The cytoplasm starts eating itself.* |
| `overview` | *Hypoxia settles over the cytoplasm as G2 deepens.* |
| `residue` | *The lysosome settles, its contents dimming.* |
| `distant` | *Far off at the trailing edge, an adhesion lets go.* |

### 7.4 Nota sobre la apoptosis

Es el evento más fuerte que puede tener el mundo, y debe ser **raro y consecuente**: solo tras
infección viral sostenida o daño oxidativo acumulado. Propuesta: la apoptosis **no mata el mundo**
— es una secuencia de ~20 s (blebbing masivo, condensación nuclear, fragmentación) tras la cual el
mundo se reconstruye con una célula nueva. Como el `dispose`/`build` del registro ya existe, es
casi gratis: la apoptosis es un `switchWorld('cell')` narrado.

---

## 8. Encaje técnico

### 8.1 El contrato del registro

`src/worlds/registry.js:11` define cada mundo como `{ id, label, accent, ready, census, build }`,
donde `build(container, cfg, names)` devuelve `{ update(swarm, dt, eco), resize, flash(v),
scare(strength), dispose }`. El mundo célula entra como una entrada más:

```js
{
  id: 'cell', label: 'Cell ecosystem', accent: '#c9a6ff', ready: true,
  census: CELL_CENSUS,
  build: (container, cfg, names) => createCellScene(container, cfg, names),
}
```

`src/main.js:53` (`buildWorld`) ya arma por mundo: `swarm`, `pop` (censo), `scene` y `events`, y al
cambiar hace `dispose()` del anterior. **Nada de eso hay que tocarlo.** El selector, el acento del
HUD, el shake y el bucle de frames funcionan sin cambios.

### 8.2 Qué se reutiliza tal cual

| Módulo | Uso en la célula |
|---|---|
| **`src/render/stage.js`** | **El escenario compartido, completo**: escena + niebla, cámara aérea 3/4, renderer, órbita con respiración, el lente (fisheye + cromática + viñeta), la etiqueta flotante, el overlay de destello, `resize` y `dispose`. El mundo célula construye su contenido dentro de `stage.scene`, registra `setResizeHook` para sus uniforms y cierra cada frame con `stage.render(step)` |
| `src/sim/wander.js` | Streaming citoplasmático (el campo de flujo **ya es** ciclosis) + move/rest + separación + atracción a rieles. Solo cambia el config |
| `src/sim/fireflies.js` | El swarm Kuramoto pasa a ser el pool de ATP (§2.4) |
| `src/sim/behaviors.js` | `createBugs`/`updateBugs` (ir de POI en POI, huir de cazadores) sirve casi tal cual para los motores caminando entre nodos del citoesqueleto |
| `src/sim/paths.js` | ~~Rieles~~ **No se reutiliza**: genera bucles cerrados con ruido, y los microtúbulos son segmentos radiales con inestabilidad dinámica. Forzarlo habría sido contorsión. En su lugar hay módulo propio, `src/sim/rails.js` — pero su `nearestOnRails` respeta **exactamente** el contrato `{x, z, d2}` de `nearestOnPaths`, así que `updateRoamers` lo consume sin cambios |
| `src/sim/events.js` | El motor de eventos es agnóstico del contenido: solo cambian censo y léxico |
| `src/sim/agents.js` | `createCensus` sirve sin cambios; solo se añade `CELL_CENSUS` |
| `src/render/noise.js` | Ruido para el sustrato y la forma de la membrana |
| `src/audio/engine.js` | Todo el grafo; se añaden voces (§6.2) |
| `src/ui/*` | HUD, log, selector, shake — sin cambios |

### 8.3 Qué es código nuevo

1. **`src/worlds/cell.js`** — el builder `createCellScene(container, cfg, agentNames)`, montado
   sobre `createStage`. Membrana deformable, interior (núcleo/ER/Golgi/citoesqueleto), organelos,
   adhesiones, sustrato deslizante, invasores.
2. **`src/sim/membrane.js`** — puro, testeable: el contorno polar `r(θ,t)` con protrusión,
   filopodios, blebs, retracción y redondeo mitótico. Sin Three.js — como el resto de `src/sim/`.
3. **`src/sim/motility.js`** — puro: polarización, quimiotaxis (paseo sesgado), ciclo
   adhesión→tracción→retracción, velocidad bifásica.
3b. **`src/sim/rails.js`** — puro: microtúbulos radiales desde el centrosoma con inestabilidad
   dinámica (crecen lento, colapsan rápido, se rescatan) y `nearestOnRails` compatible con
   `wander.js`. ✅ implementado, 9 tests.
3c. **`src/sim/atp.js`** — puro: pool de tamaño fijo, los cuantos viajan de la mitocondria al
   consumidor y **solo la entrega repone** el `budget` (0..1) del que cuelga el resto del mundo.
   ✅ implementado, 9 tests.
3d. **`src/sim/invaders.js`** — puro: bacterias con run-and-tumble y viriones con difusión pura,
   que se pegan al cruzar la membrana. No conoce la forma de la célula: pregunta por un predicado
   `inside(x,z)`, así que sirve igual contra un disco de test que contra la membrana real.
   ✅ implementado, 9 tests.
4. **`CELL_CENSUS`** en `src/sim/agents.js` y **`CELL_LEXICON`** en `src/sim/narrator.js`.
   ✅ implementado, 13 tests. Las estructuras se marcan con `static: true` y `createCensus` ya no
   mira solo el tipo `static_object` del bosque, así que el núcleo no sale a deambular.
5. **Perfil de ecosistema** de la célula (12 fases del ciclo + 6 estados de medio).

### 8.4 Los tres cambios que el core sí necesita

Son acotados y retro-compatibles, pero hay que nombrarlos antes de empezar.

**(a) La segunda capa del engine — ya no es tarea de esta rama, pero sí una dependencia.**
La primera capa está resuelta: `createStage(container, cfg)` en `src/render/stage.js` entrega
escena, cámara, renderer, órbita, composer, etiqueta, flash, resize y dispose. El mundo célula la
consume directamente y no necesita nada más de ahí.

Lo que **sigue dentro de `scene.js`** y la célula también necesita:

| Pieza | Qué es | Uso en la célula |
|---|---|---|
| `pointMat` + `pushPoint`/`pushLine` | Shader de puntos tamaño-mundo con DOF falso, y los acumuladores de líneas/puntos | Todo: ribosomas, cuantos de ATP, membrana, citoesqueleto |
| geometría de agente + `updateAgentMotion` | Jaulas (`fatLine`/`edgesOf`/`ringLoop`), rodado/planeo/spin | Los organelos son agentes con jaula |
| `trails` | Estelas | Estelas de organelos sobre los rieles |
| `weather`, `haze` | Lluvia/nieve, neblina aditiva | Partículas del medio, ROS, densidad del medio |

**Firmas CERRADAS con la sesión de ciudad (2026-08-11).** Las implementa y mantiene esa sesión;
**esta rama no edita `engine/*`, solo lo consume** (un único dueño por archivo).

| Módulo | API | Uso en la célula |
|---|---|---|
| `engine/points.js` | `createDraw(rc)` → `pushPoint`/`pushLine`/`pointMaterial`/`uniforms`/`finalize*` | Contenido **estático**: ribosomas, sustrato |
| " | `createPointCloud(count, material)` → `{ mesh, pos, col, size, phase, commit() }` | Contenido **dinámico**: cuantos de ATP |
| " | `createLineBuffer(maxSegments, material)` → `{ mesh, begin(), push(...), commit() }` | **Membrana y citoesqueleto**, que se reescriben cada frame |
| `engine/agents3d.js` | `createAgentKit(rc)` → `fatLine`/`edgesOf`/`ringLoop`/`creature`/`wedge`/`setResolution(w,h)`; `updateAgentMotion(...)` | Geometría de organelo compuesta con los primitivos; movimiento flag-driven (`glide`/`rollMul`/`spinY`) |
| `engine/trails.js` | `createTrails(scene, n, agentColors, rc, pointMaterial)` | Estelas de organelo |
| `engine/haze.js` | `createHaze(scene, {R, G, count, color, alpha, heightFn})` | Densidad del medio |
| `engine/weather.js` | *(forest-shaped, sin generalizar)* | **No se usa.** Las partículas del medio y los ROS barren en XZ, no caen en Y: módulo propio |

Dos precisiones que valen para no planificar sobre supuestos falsos:

- `createLineBuffer` produce `THREE.LineSegments` **planas**, no líneas gruesas (`LineSegments2`
  usa otra geometría). Es lo correcto: membrana y citoesqueleto son del registro *orgánico* del
  lenguaje visual, igual que el terreno y la flora del bosque. Las líneas gruesas quedan para el
  registro *esquemático* — las jaulas de organelo — vía `fatLine` del `agentKit`.
- Ningún módulo de `engine/*` asume contención circular: `R` solo escala velocidad, nunca recorta.
  En célula el límite lo manda `radiusAt`/`containsPoint` de `membrane.js`.

**Esa descomposición hacia `engine/*` la lidera la sesión de CIUDAD.** La consecuencia práctica
para la célula es de coordinación, no de trabajo: **diseñar asumiendo que esos módulos existirán y
acordar las firmas con esa sesión antes de F1**, en vez de copiar `scene.js` (~800 líneas
duplicadas y cada arreglo hecho dos veces). Si al llegar a F1 la extracción no está lista, la
decisión correcta es esperar o hacerla en coordinación — no bifurcar el render.

**(b) Parametrizar el ecosistema por mundo. ✅ HECHO.**
`createEcosystem` arranca con `FOREST_PROFILE` y expone `setProfile(profile)`, que `buildWorld`
llama con el `ecosystem` del mundo. Un perfil trae `{ phases, phaseData, weathers, weatherData }`.
**El reloj no se reinicia** al cambiar de mundo: el tiempo sigue donde estaba.

Detalle que hubo que resolver y no era obvio: al cambiar de perfil, el clima activo puede no
existir en la tabla nueva (`'heavy rain'` no es un medio celular) — sin eso, todo lo derivado
salía `NaN`. `setProfile` reelige un clima válido si el actual no existe.

**(c) Parametrizar el léxico del narrador. ✅ HECHO.**
`narrate(ev, ctx, rand, lex)` recibe el léxico, con default a `FOREST_LEXICON` (el bosque no
cambió). `createEventEngine(pop, cfg)` lo pasa desde `cfg.lexicon`. Un léxico trae `actions`,
`ambient`, `place`, `fallbackType` y **puede reemplazar la plantilla de cualquier tipo de evento**
con una función — así `shift` narra el ciclo celular en vez de la luz, y `conflict` distingue
fagocitar un invasor de aplastar a uno de los propios.

Además, `actions` admite **claves por nombre de agente**, no solo por tipo. Sin eso, el balde
genérico le hacía "apilar una cisterna" al núcleo y "abrirse y cerrarse" a una fibra de estrés:
en el bosque la genericidad no molesta, pero las estructuras de la célula hacen cosas demasiado
distintas entre sí. El bosque no define claves por nombre, así que no le cambia nada.

**Pendiente de cableado (F4):** `main.js:163` llama a `narrate(...)` directamente para los eventos
de conflicto que devuelve `scene.update()`, sin léxico → hoy saldría en vocabulario de bosque. Al
montar el mundo célula hay que pasarle el del mundo activo.

**Menores, opcionales:**
- `main.js:161` asume que los eventos que devuelve `scene.update()` tienen forma `{hunterIdx, dir}`
  y busca `pop.visible[hunterIdx]`. **Si el mundo célula respeta ese shape, no hay que tocar nada.**
  Para eventos más ricos (fagocitosis vs infección vs división) conviene aceptar un `kind`
  opcional: 2 líneas.
- `createHud` fija la etiqueta `TEMPERATURE` y la unidad `°C`. Solo hace falta cambiarlo si se
  decide mostrar pH — no bloqueante (§5.3).
- El disparo del relámpago vive en `main.js:129` condicionado a `eco.rain`. La onda de Ca²⁺ se
  dispara **desde dentro del builder** (que ya tiene su propio `flash` local): cero cambios al host.

### 8.5 Fases sugeridas de implementación

Con criterio de verificación por fase, para que el plan que salga de aquí sea ejecutable.

Los tests se corren con `npx vitest run --exclude '**/.claude/**'` — sin el `--exclude`, vitest
recorre también los worktrees y cuenta 96 tests en vez de 24.

| Fase | Entrega | Verificación |
|---|---|---|
| **F0** | *(ya no es nuestra)* Segunda capa del engine hacia `engine/*`, liderada por la sesión de ciudad. Aquí solo: acordar firmas de puntos/líneas, agentes y estelas | El bosque y la ciudad se ven idénticos tras la extracción; tests verdes |
| **F1** | Célula estática sobre `createStage`: membrana, núcleo, ER/Golgi, microtúbulos, organelos sobre rieles. `ready: true` en el registro | Se cambia de mundo y se ve una célula reconocible; sin errores de consola; `dispose` limpio al volver a `land` |
| **F2** | Motilidad: polarización, lamelipodio, filopodios, blebbing, adhesiones, sustrato deslizante, quimiotaxis. **La capa pura ya está: `src/sim/membrane.js` + `src/sim/motility.js`, 22 tests** — se adelantó porque no depende de `engine/*`. Falta solo el render | Tests puros de `membrane.js`/`motility.js` ✅; visualmente: la célula avanza y persigue el gradiente |
| **F3** | ATP sobre el swarm + sonido propio. **Capa pura lista: `src/sim/atp.js`, 9 tests.** Falta cablearlo al swarm Kuramoto y al audio | Los destellos salen de mitocondrias y se consumen; suenan; el presupuesto de ATP modula la protrusión |
| **F4** | ✅ Perfil de ecosistema (12 fases del ciclo + 6 medios) con `setProfile`, narrador propio cableado, redondeo mitótico y onda de Ca²⁺. **Falta**: los eventos grandes narrados (división, fagocitosis, apoptosis) por el canal de `scene.update()` | El HUD muestra las fases del ciclo ✅; el log narra en vocabulario celular ✅; división/fagocitosis/apoptosis pendientes |
| **F5** | Invasores: bacterias (run-and-tumble) y viriones (difusión) + conflicto. **Capa pura lista: `src/sim/invaders.js`, 9 tests.** Falta el render y la decisión de fagocitosis (la toma el mundo, en el lamelipodio) | Fagocitosis e infección aparecen en el log; el shake dispersa lo que debe |

### 8.6 Qué NO hacer

- **No simular física real** de polimerización de actina ni dinámica molecular. Cinemática con
  aspecto correcto: es un mundo vivo, no un solver.
- **No meter 20 tipos de organelo.** Ocho agentes visibles bien diferenciados por *movimiento* ganan
  a veinte que se distinguen solo por color.
- **No convertirlo en una lámina de libro de texto.** Nada de etiquetas fijas ni flechas
  explicativas: la única etiqueta es la flotante que ya existe, sobre el agente más cercano al
  centro.
- **No romper la paleta.** Los colores salen de `PALETTE`; el único invento es el acento del HUD.

---

## 9. Decisiones tomadas

Cerradas con el usuario el **2026-08-11**. Ya no son opciones: son el marco del que cuelga todo lo
anterior.

1. **La célula es un macrófago.** Descartados fibroblasto (migra a ~0.5 µm/min: se vería estático,
   y no fagocita) y ameba *Dictyostelium* (mejor motilidad, pero sin marco inmune los invasores
   pierden sentido narrativo). Consecuencia: §2.1 y §7 quedan tal como están escritos.
2. **Célula centrada, sustrato deslizante** (§3.3, opción 2). No se toca `OrbitControls` ni la
   cuenca de `wander.js`. Ya implementado: `subX`/`subZ` en `src/sim/motility.js`.
3. **`cell` entra al registro directo con F1 jugable** (`ready: true` recién cuando haya célula
   reconocible en pantalla). Sin stub: el stub tenía sentido para `water`/`city` porque esperaban
   el mapeo del bundle de murmur, y célula no depende de ningún bundle externo.
4. **Se espera la Fase A de `engine/*`** de la sesión de ciudad antes de F1, y mientras tanto se
   avanza F2 en módulos puros. Descartado arrancar F1 con buffers propios provisionales (deuda de
   render que después habría que migrar).
5. **El events log queda en inglés**, por consistencia con los otros tres mundos.
