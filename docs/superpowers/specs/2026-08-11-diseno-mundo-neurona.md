# Diseño del mundo NEURONA (`neuron`)

**Fecha:** 2026-08-11
**Estado:** diseño **propuesto** — pendiente de revisión del usuario. Sin código todavía.
**Alcance:** un sexto mundo del registro, hermano de `land` / `water` / `city` / `cell` / `fungus`,
cuyo tema central es **el impulso eléctrico: cómo viaja, cómo se transmite y qué se mueve**.
**Encuadre ya cerrado por el usuario:** opción **B — una MICRORED de neuronas** conectadas por
sinapsis, con **detalle en las sinapsis**. No es una neurona sola (A) ni un primer plano de una
sinapsis (C).
**Base técnica:** el motor sobre `main` tal como está hoy — `src/render/stage.js` + `src/render/engine/*`
(ya extraídos y en uso por `cell` y `fungus`), `src/worlds/registry.js`, `src/main.js`, `src/sim/*`,
`src/audio/engine.js`. A diferencia de la célula, aquí **no hay dependencia de extracción pendiente**:
el engine compartido ya existe.
**Base biológica:** electrofisiología estándar (potencial de acción, conducción saltatoria,
transmisión sináptica cuántica, estados de sueño). Los números son valores de literatura,
redondeados, para calibrar proporciones — no para simular física.

> Convención del doc (la misma del spec de célula): cada decisión abierta se presenta con
> **opciones + recomendación marcada ⭐**. La sección §10 junta todas las decisiones abiertas.

---

## 0. Resumen ejecutivo

- **El mundo es una microred cortical vista desde arriba.** ~12 neuronas fijas en el plano, unidas
  por axones. Los somas no deambulan: **lo que se mueve es la señal y las moléculas**. Es la
  primera vez en burbur que los individuos con nombre están quietos y el mundo se mueve por dentro.
- **El corazón ya está escrito.** El swarm Kuramoto de `src/sim/fireflies.js` es literalmente un
  modelo de neuronas integrate-and-fire: Mirollo & Strogatz (1990), el paper que formalizó la
  sincronía de las luciérnagas, está escrito sobre **osciladores tipo neurona acoplados por
  pulsos**. Este mundo no reinterpreta el motor: lo devuelve a su origen (§2).
- **Lo que se ve moverse son tres cosas distintas, a propósito** (§4): el **spike** recorriendo el
  axón (rápido, dirigido, a saltos entre nodos de Ranvier); el **neurotransmisor** difundiendo por
  la hendidura (browniano, sin motor); y el **cargo axonal** caminando sobre microtúbulos
  (lento, a pasos, con motor). Tres maneras reales de moverse una molécula, tres texturas visuales.
- **El "día" es el ciclo de sueño**: vigilia → somnolencia → N1 → N2 (husos) → N3 (ondas lentas) →
  REM → despertar. El **"clima" son los neuromoduladores** (acetilcolina, noradrenalina, dopamina,
  adenosina, cafeína, GABA). El **conflicto es la convulsión**: sincronía desbocada (§6, §8).
- **Lo nuevo es poco y acotado**: topología de red, propagación del spike y liberación sináptica —
  tres módulos puros. Todo lo demás (swarm, motores, rieles, membrana, ATP, difusión, registro,
  perfil de ecosistema, léxico) se reutiliza (§9).

---

## 1. Concepto: qué escala es este mundo

El encuadre ya está decidido, pero conviene dejar escritos los tradeoffs — el mundo hereda
consecuencias de esta elección y hay que poder volver a ella.

### Opción A — Una neurona sola, en detalle

Un único individuo enorme llenando el cuadro: soma, arbor dendrítico completo, axón que se pierde
en el borde.

- ✅ Máxima riqueza morfológica: cada espina dendrítica es visible.
- ❌ **No hay red, y sin red no hay sincronía.** El swarm Kuramoto —el motor del proyecto— se queda
  sin trabajo: un solo oscilador no se sincroniza con nadie.
- ❌ Un solo "individuo" contra los 18 slots del censo: el events log se queda sin sujetos.

### Opción B — Microred de neuronas con detalle en las sinapsis ⭐ **elegida por el usuario**

~12 somas repartidos por el plano, unidos por axones. El spike se ve **recorrer** el axón y en cada
terminal se libera un puñado de neurotransmisor que cruza a la neurona siguiente.

- ✅ **Responde a las tres cosas pedidas a la vez**: impulsos eléctricos (los spikes por el axón),
  moléculas moviéndose (difusión, transporte, iones), y neurotransmisores (la hendidura).
- ✅ **Es el mundo donde el swarm se ve**: 12 osciladores acoplados por pulsos con retardo producen
  ondas de sincronía viajeras, silencios colectivos y —si el acoplamiento se dispara— convulsiones.
  Nada de eso hay que programarlo: emerge.
- ✅ Cada neurona es un individuo con nombre, jaula y voz: el censo y el events log funcionan igual
  que en los otros cinco mundos.
- ❌ Escala mixta declarada: un soma mide ~20 µm y una hendidura sináptica ~20 nm — mil veces menos.
  Dibujar ambas a escala real haría invisible la sinapsis. Ver §4.5.

### Opción C — Primer plano de una sola sinapsis

La cámara dentro de la hendidura: vesículas, receptores, moléculas.

- ✅ Es donde de verdad "se ven las moléculas".
- ❌ No hay red, no hay individuos, no hay impulso viajando. Sería una animación, no un mundo vivo.

### Recomendación sobre el detalle sináptico

B necesita resolver cómo mostrar la sinapsis sin romper la vista aérea. Tres formas:

- **Z1 — Zoom real de cámara** a la sinapsis activa. Pelea con `OrbitControls`, marea, y deja el
  resto de la red fuera de cuadro justo cuando la red es el sujeto. ❌
- **Z2 — Escala no uniforme, declarada ⭐ recomendada.** La sinapsis se dibuja **siempre aumentada**:
  la hendidura mide en pantalla lo mismo que un soma. Es la misma licencia que la célula ya se toma
  con el ciclo celular (24 h en 9 min) y que el bosque se toma con el día. No toca la cámara, no
  toca nada, y el usuario puede acercarse con la rueda si quiere.
- **Z3 — Inset 2D** en una esquina con la sinapsis activa. Rompe la regla "nada de láminas de libro
  de texto" del lenguaje visual del proyecto. ❌

Y un realce que hace innecesario el zoom: **detalle bajo demanda**. Todas las sinapsis se dibujan
siempre (bulbo + hendidura), pero solo las que recibieron un spike en los últimos ~2 s despliegan
el detalle fino (vesículas individuales, nube de neurotransmisor, receptores encendidos). El ojo va
solo a donde está pasando algo, y el costo de dibujo se concentra donde importa.

### Identidad del mundo: corteza cerebral local

Igual que la célula eligió ser un macrófago (y eso hizo creíbles fagocitosis, lisosomas y estrés
oxidativo a la vez), aquí conviene declarar **qué trozo de cerebro es**: una **columna cortical
local** (unos cientos de µm de corteza).

| Elemento pedido | Por qué la corteza local lo justifica |
|---|---|
| Impulsos recorriendo axones | Los axones locales miden 100–1000 µm: caben enteros en cuadro |
| Sinapsis visibles | Corteza = neuropilo denso de sinapsis; es su rasgo definitorio |
| Excitación e inhibición | Proporción real 80/20 (piramidales / interneuronas GABA) |
| Ritmos cerebrales | Delta, husos, alfa, gamma son **corticales**: se generan justo ahí |
| Convulsión | La epilepsia focal es un fenómeno cortical local que recluta vecinos |
| Estados de sueño | El hipnograma se lee en el EEG cortical |

Un trozo de médula o de ganglio periférico daría menos ritmos y ninguna sincronía interesante; un
cerebelo daría una arquitectura preciosa pero muy rígida (todo en capas paralelas). La corteza es
la que maximiza eventos narrables por unidad de código.

---

## 2. La idea rectora: el swarm ya es una red de neuronas

Esta sección es el argumento central del mundo, y conviene tenerlo escrito con precisión porque
determina el encaje técnico entero.

`src/sim/fireflies.js` mantiene N osciladores con fase `θᵢ`, frecuencia propia `ωᵢ`, y un
acoplamiento que empuja cada fase hacia la de sus vecinos. **Cuando una fase cruza 2π se emite un
flash y la fase vuelve a 0.** Eso es, punto por punto, un **integrate-and-fire**: la fase es el
potencial de membrana subiendo, el cruce de 2π es el umbral, y el reset a 0 es la
hiperpolarización. El mapeo "disparo → nota" que ya existe en el motor es literalmente sonificación
de spikes.

Hay una diferencia real entre los dos modelos clásicos, y **es exactamente la diferencia que hace
visible a este mundo**:

| | Acoplamiento | Qué se ve |
|---|---|---|
| **Kuramoto** (el de hoy) | Continuo: `sin(θⱼ − θᵢ)` sumado sobre vecinos, todo el tiempo | Nada. La influencia es un término matemático sin cuerpo |
| **Mirollo–Strogatz** (el de este mundo) | **Por pulsos**: cuando `j` dispara, empuja la fase de `i` de golpe | El pulso **es un objeto**: nace, viaja por el axón, tarda, y llega |

El mundo neurona usa el segundo. Consecuencias:

1. **El acoplamiento por proximidad se apaga** (`couplingK: 0` en la config de swarm del mundo).
   Sin esto habría sincronía fantasma: hoy `updateSwarm` acopla por distancia euclídea dentro de un
   volumen invisible de 12×7×10, que en este mundo no significa nada.
2. **Todo el acoplamiento entra por las sinapsis**: al llegar el neurotransmisor a la postsináptica,
   el mundo hace `swarm.phases[j] += w` — positivo con glutamato, negativo con GABA. Es un PSP
   (potencial postsináptico) y es una línea de código.
3. **El retardo es el sujeto.** Entre que `i` dispara y que `j` recibe pasan cientos de ms de
   pantalla: el spike tiene que recorrer el axón, liberar vesículas y difundir la hendidura. Ese
   retardo, con topología dependiente de la distancia (§4.1), es lo que genera **ondas viajeras**
   de actividad en vez de un parpadeo global. No hay que programar la onda: aparece.
4. **`ωᵢ` es la excitabilidad de cada neurona**, y el mundo la modula según el estado cerebral:
   lenta en sueño profundo (delta ~1 Hz), rápida y dispersa en vigilia. `swarm.omegas` es un array
   plano y mutable: se escribe desde el update del mundo, cero cambios al core.
5. **`phaseVariance(phases)` ya existe** en `fireflies.js` y devuelve `1 − R`, donde `R` es el
   parámetro de orden de Kuramoto: **la medida canónica de sincronía**. Sirve tal cual para
   detectar la onda de sincronía, el estado DOWN y la convulsión (§6.3). Está exportada y testeada.

**Corolario honesto:** el mundo neurona no necesita un oscilador nuevo. Necesita **un cuerpo para
el acoplamiento** — axón, terminal, hendidura — y eso es lo que se construye en §4.

---

## 3. Los agentes

Se conserva la distinción del resto de los mundos: **visibles** (jaula wireframe, nombre, voz,
etiqueta al hover — `pop.visible`), **censo invisible** (`static: true`: aparece en el log, no en
pantalla), y **props/partículas** (masa visual sin identidad).

### 3.0 Cuántas neuronas — la decisión abierta principal

`CONFIG.fireflies.count` es **18** y es global: el host construye un swarm de 18 osciladores por
mundo y le pasa 18 nombres al builder. Las opciones son:

| Opción | Composición | Tradeoff |
|---|---|---|
| **8 neuronas** | 8 somas + 10 slots sin uso | Máxima legibilidad, pero desperdicia 10 identidades del censo y la red queda tan chica que la sincronía apenas se lee |
| **12 neuronas + 6 astrocitos ⭐** | 10 piramidales + 2 interneuronas + 6 glía | Cada sinapsis se ve; los 18 slots tienen identidad; la proporción E/I queda en 83/17, casi el 80/20 real |
| **18 neuronas** | 15 piramidales + 3 interneuronas, sin glía | Más red, pero ~45 sinapsis en cuadro: se pierde el detalle sináptico, que es el punto del mundo |
| **~40 neuronas** | Requiere `count` por mundo (cambio de core) | Ondas colectivas espectaculares, pero cada neurona es un punto: se pierde todo lo que el usuario pidió |

**Recomendación: 12 neuronas + 6 astrocitos.** Los astrocitos no son relleno: tienen un rol
mecánico real (recaptan el neurotransmisor de la hendidura y así **apagan** la sinapsis, §4.4) y son
los únicos individuos que se mueven despacio por el fondo, lo que le da al mundo algo que deambule.

La opción de ~40 queda agendada como fase posterior, y su costo está acotado: un `def.swarm.count`
por mundo en el registro (§9.4a) — el mismo cambio que ya hace falta para `couplingK`.

### 3.1 Agentes visibles — jaula, nombre, estela y voz

| Agente | Tipo (`agentType`) | Nº | Comportamiento | Base biológica |
|---|---|---|---|---|
| **piramidal** | `neuron` | 8–10 | Fija. Dispara y manda spikes por su axón; **excitatoria** (glutamato). Axón mielinizado: conducción **a saltos** | Soma triangular, el 80 % de las neuronas corticales |
| **interneurona** (cesta, candelabro, Martinotti) | `interneuron` | 2 | Fija. **Inhibitoria** (GABA); axón local, amielínico, conducción **continua y lenta**; dispara rápido y sostenido | Interneuronas *fast-spiking*: hasta 200 Hz, contra 1–10 Hz de una piramidal |
| **astrocito** | `glia` | 4–6 | El único que se desplaza (muy lento). Sus pies envuelven las sinapsis cercanas y **recaptan** el neurotransmisor | Un astrocito humano envuelve ~10⁵ sinapsis; sus ondas de Ca²⁺ duran **segundos**, no ms |

**Por qué las neuronas no deambulan, y por qué está bien.** Es el único mundo de burbur donde los
individuos con nombre están quietos. Precedente directo: en el micelio la red *es el terreno* y en
la célula la membrana *es la isla*. Aquí las neuronas son el terreno **y** los individuos: tienen
jaula, nombre, etiqueta al hover y voz en el log, pero su posición es fija. Lo que se mueve —y lo
que el usuario pidió ver moverse— son los spikes, las moléculas y el cargo.

**Excitatorias vs inhibitorias: lectura por forma, no por color.** Piramidal = soma triangular
(`frustumCage` del `agentKit`, que ya existe). Interneurona = soma redondo (`ringLoop` + esfera
wireframe). Astrocito = **estrella** de radios finos (es literalmente lo que significa su nombre).
Tres siluetas que se distinguen de un vistazo, como bacteria/virión/organelo en la célula.

### 3.2 Censo invisible — sin jaula, con voz en el log

Todos con `static: true`, con artículo (son también las claves del léxico por nombre, §8.1).

- **Estructura sináptica** (`synapse`): `el cono axónico` · `el botón terminal` · `la hendidura
  sináptica` · `la zona activa` · `la espina dendrítica` · `el nodo de Ranvier` · `la vaina de
  mielina` · `el receptor AMPA` · `el receptor NMDA` · `el receptor GABA-A` · `el canal de sodio` ·
  `el canal de potasio` · `la bomba sodio-potasio`
- **Neurotransmisores y neuromoduladores** (`neurotransmitter`): `el glutamato` · `el GABA` ·
  `la dopamina` · `la acetilcolina` · `la noradrenalina` · `la serotonina` · `la adenosina`
- **Señales de red** (`signal`): `la onda lenta` · `el huso de sueño` · `el complejo K` ·
  `la ráfaga gamma` · `el estado DOWN`
- **Tejido** (`tissue`): `el capilar` · `el neuropilo` · `el líquido extracelular` ·
  `la microglía` · `el oligodendrocito`

### 3.3 Props y partículas — masa visual, sin identidad

| Prop | Equivale en la célula a | Rol |
|---|---|---|
| **Spikes** | Los cuantos de ATP | El sujeto del mundo: pulso brillante recorriendo el axón (§4.2) |
| **Vesículas sinápticas** | Las vesículas de transporte | Puntos dentro del botón terminal; desaparecen al liberarse, se reponen (§4.3) |
| **Neurotransmisor** | Los viriones difundiendo | Nube de puntos que cruza la hendidura por difusión pura (§4.4) |
| **Iones Na⁺ / K⁺** | Los pops de entrega de ATP | Destellos en la membrana durante el spike: Na⁺ entra, K⁺ sale |
| **Cargo axonal** (mitocondrias, vesículas) | Los motores caminando | Puntos que caminan por el axón con kinesina/dineína (§4.6) |
| **Espinas dendríticas** | Los ribosomas | Puntitos densos sobre las dendritas; se encienden al recibir |
| **Neuropilo** | El sustrato / el polvo | Nube de puntos apagados de fondo: la maraña de procesos que no se dibuja |
| **Capilar** | — | Línea serpenteante con glóbulos pasando; da vida al fondo (unidad neurovascular) |

---

## 4. La red — el núcleo del mundo

Cinco sistemas corriendo en paralelo, cada uno con una lectura visual distinta. Este es el trabajo
nuevo del mundo; todo lo de §5 en adelante cuelga de acá.

### 4.1 Topología — quién conecta con quién

Se decide una vez, al construir la escena, y no cambia (la plasticidad queda fuera de alcance).

**Opciones para el grafo:**

- **T1 — Aleatorio uniforme** (Erdős–Rényi): cualquiera con cualquiera. Da una maraña de axones
  cruzados sin estructura legible, y sin relación entre distancia y retardo. ❌
- **T2 — Dependiente de la distancia ⭐ recomendada.** `P(i→j) ∝ exp(−d/λ)`: cada neurona conecta
  sobre todo con sus vecinas y, de vez en cuando, tira un axón largo. Es lo que hace la corteza real
  y es lo que produce **ondas viajeras**: la actividad se propaga de vecino a vecino a velocidad
  finita, con algún atajo que la adelanta.
- **T3 — Mundo pequeño** (Watts–Strogatz sobre un anillo): topología elegante, pero obliga a
  ordenar los somas en círculo y el mundo se ve como un diagrama, no como tejido. ❌

**Parámetros propuestos:** grado saliente medio **2.5** (rango 1–4) → ~30 sinapsis. Las
interneuronas conectan **solo local** y con grado más alto (4–6), porque su trabajo real es callar
al vecindario inmediato. Regla: ninguna neurona sin salida ni sin entrada (la red debe estar
conectada, o hay islas mudas).

**El axón no es una recta.** Es una polilínea de 6–10 puntos con curvatura suave desde el cono
axónico de `i` hasta una dendrita de `j`, con ruido bajo. Que se curve importa: hace legible cuál
axón es cuál cuando dos se cruzan, y le da al spike un recorrido con forma.

### 4.2 Propagación del spike — el impulso eléctrico

Cuando `swarm.flash[i]` cruza el umbral (el mismo mecanismo con que la célula detecta que una
mitocondria latió), se lanza **un spike por cada axón saliente** de `i`.

El spike es un objeto con `t` ∈ 0..1 sobre la polilínea de su axón — **el mismo patrón que
`motors.js`** usa para caminar sobre un riel. Recorre el axón y al llegar a `t = 1` dispara la
liberación (§4.3).

**Dos velocidades y dos texturas, que es un rasgo real y muy legible:**

| | Axón mielinizado (piramidal) | Axón amielínico (interneurona) |
|---|---|---|
| Velocidad real | 10–120 m/s | 0.5–2 m/s |
| Cómo se ve | **Salta** de nodo de Ranvier a nodo: el pulso desaparece bajo la mielina y reaparece encendiendo el nodo siguiente | Se **desliza** continuo y lento por la línea |
| Por qué | Conducción saltatoria: la corriente solo se regenera en los nodos | Sin aislante, la despolarización se regenera punto a punto |

Un espectador entiende sin leer nada que hay dos clases de cable. Es el mismo recurso que en la
célula distingue a la bacteria (run-and-tumble) del virión (difusión): **el movimiento identifica**.

**Detalle real que vale la pena implementar:** el potencial de acción **no nace en el soma**, nace
en el **segmento inicial del axón** (el cono axónico), que es donde se acumulan los canales de sodio.
Visualmente: el destello del disparo aparece un poco *afuera* del soma, en el arranque del axón, y
desde ahí sale. Un detalle de dos líneas con mucho retorno de veracidad.

**Período refractario:** tras disparar, la neurona no puede volver a disparar por ~2 ms reales
(escalados a ~120 ms de pantalla). En el swarm esto ya está implícito en el reset de fase a 0, pero
conviene marcarlo visualmente: el soma queda **apagado** un instante después del disparo. Es lo que
impide que la convulsión sea infinita.

### 4.3 Liberación sináptica — el momento clave

Cuando el spike llega al botón terminal:

1. **Entra calcio.** El terminal destella (`cyanEye`) durante ~100 ms.
2. **¿Se libera o no?** Esta es la pieza que le da vida al mundo: **la transmisión sináptica falla,
   y falla mucho.** La probabilidad de liberación de una sinapsis cortical va de 0.1 a 0.9 según el
   contacto. Con `p ≈ 0.5`, **la mitad de los spikes que llegan no producen nada**: el pulso llega,
   el terminal se ilumina y no pasa nada. Eso no es un bug, es el fenómeno; y narrativamente da uno
   de los mejores eventos del log ("*el spike llega al botón y no pasa nada*").
3. **Si libera**, salen 1–3 vesículas del **pool listo** (real: 5–10 vesículas acopladas a la zona
   activa; cada una con ~5000 moléculas de glutamato). Los puntos desaparecen del terminal.
4. **El pool se agota y se repone.** Con disparo sostenido, el terminal se queda sin vesículas listas
   y la sinapsis **se deprime** — depresión sináptica por corto plazo, real y visible: la neurona
   sigue disparando pero ya no transmite. El pool se recicla en unos segundos (endocitosis).

Esto convierte cada sinapsis en un pequeño sistema con estado, no en un cable. Y da tres eventos
narrables donde antes había uno.

### 4.4 La hendidura — cómo se mueven las moléculas

Liberado el contenido de la vesícula, aparece una nube de ~20–40 puntos en el lado presináptico y
**difunde**: cada paso en dirección independiente del anterior, exactamente el modelo que
`src/sim/invaders.js` ya usa para los viriones (`virionSpeed` + ángulo aleatorio por frame).

Tres destinos posibles, los tres reales, los tres visibles:

- **Alcanza un receptor** en la dendrita postsináptica → el receptor se enciende y se aplica el
  empujón de fase (`+w` glutamato / `−w` GABA). El punto desaparece.
- **Lo recapta un astrocito** → si un pie astrocítico está cerca, barre los puntos que quedan.
  Este es el trabajo real de la glía y es lo que **apaga** la sinapsis para el siguiente spike.
- **Se difunde afuera** (*spillover*) y se pierde en el líquido extracelular.

**Glutamato vs GABA se leen por color y por consecuencia**: el glutamato (`orange`, cálido) hace que
la postsináptica se acerque al umbral y a veces dispare en cadena; el GABA (`cyan`, frío) la aleja y
**se ve** cómo el soma que estaba a punto de disparar se apaga. Cálido excita, frío calma: la
convención se entiende sin leyenda.

**Licencia de escala declarada:** la hendidura real mide 20–40 nm y el neurotransmisor la cruza por
difusión en **microsegundos** — a escala real sería un parpadeo. Aquí la travesía dura ~0.3–0.8 s de
pantalla. Es la misma clase de licencia que el ciclo celular en la célula, y por el mismo motivo:
sin ella, lo que el usuario pidió ver es literalmente invisible.

### 4.5 Escalas simultáneas — cómo conviven soma y sinapsis

El mundo dibuja tres escalas a la vez y hay que declararlo:

| Elemento | Tamaño real | En pantalla |
|---|---|---|
| Soma | ~20 µm | referencia (1×) |
| Axón local | 200–1000 µm | ~4–10× el soma — cabe en cuadro |
| Botón terminal | ~1 µm | ~0.4× el soma (real sería 0.05×) |
| Hendidura | 20–40 nm | ~0.15× el soma (real sería 0.001×) |
| Vesícula | 40 nm | punto visible (real sería invisible) |

La sinapsis está **exagerada ~100×** respecto del soma. Es deliberado y es la decisión Z2 de §1.

### 4.6 Transporte axonal — el tercer movimiento

Sobre el mismo axón que lleva los spikes caminan **mitocondrias y cargo**, en ambos sentidos:
kinesina hacia el terminal (anterógrado), dineína hacia el soma (retrógrado). **`src/sim/motors.js`
sirve tal cual**: ya modela un motor con `t` sobre un riel, dirección, carga, desprendimiento
espontáneo y reenganche. Solo cambia qué es el riel — antes un microtúbulo radial desde el
centrosoma, ahora el axón.

El contraste temporal es el punto: el **spike cruza el axón en menos de un segundo**, y una
**mitocondria tarda un minuto largo** en recorrer lo mismo. Dos cosas moviéndose sobre la misma
línea a velocidades que difieren en dos órdenes de magnitud. Es una de las imágenes más honestas y
más bonitas que puede dar el mundo.

**Detalle real:** las mitocondrias axonales **se paran en las sinapsis** y se quedan ahí — las
sinapsis son donde se gasta la energía. Con `motors.js` esto es una condición de parada en los
nodos sinápticos, no un módulo nuevo.

### 4.7 La energía — `atp.js` sin cambios

La bomba sodio-potasio gasta **la mitad del ATP de una neurona**, y el cerebro consume el 20 % del
oxígeno del cuerpo con el 2 % de la masa. En burbur eso ya está modelado: `src/sim/atp.js` mantiene
un pool de cuantos que nacen en una mitocondria, viajan a un consumidor y solo **reponen el budget
al entregarse**.

Mapeo directo: las mitocondrias son las del axón (§4.6), y el consumidor es la **bomba Na⁺/K⁺** de
cada soma tras un disparo. `atp.budget` (0..1) queda como en la célula: la variable que acopla
economía y comportamiento. Con el presupuesto bajo, la bomba no alcanza a restaurar el gradiente y
las neuronas disparan peor — que es exactamente lo que pasa en una isquemia.

---

## 5. Cómo se ve

### 5.1 Continuidad con la estética del proyecto

Sin excepciones respecto de `2026-08-10-lenguaje-visual.md`:

- **Diorama flotando en negro**, viñeta, fisheye 93°, aberración cromática, DOF falso.
- **Wireframe + puntos por vértice**, con los dos registros superpuestos: el **orgánico** (dendritas,
  axones, neuropilo — `createLineBuffer`, líneas planas) contra el **esquemático** (las jaulas de
  los somas — `fatLine` del `agentKit`, grosor constante en pantalla).
- **Sin relleno**, marcador interno de orientación, estela punteada.
- Este mundo es, si acaso, **el que mejor encaja con el look "matrix"**: una red de nodos y
  conexiones con pulsos recorriéndola es la imagen que el estilo estaba buscando desde el principio.

**Cámara:** a diferencia de la célula (que apagó `autoRotate` porque la autorotación tapaba el
deslizamiento del sustrato), aquí **se mantiene la órbita con respiración**. La red es fija; el giro
lento ayuda a leer la profundidad de los axones que se cruzan.

### 5.2 Geometría por elemento

| Elemento | Construcción |
|---|---|
| **Soma piramidal** | Cono truncado wireframe (`frustumCage`) con la punta hacia arriba, más el contorno de membrana con puntos por vértice. Reutiliza `membrane.js` con protrusión 0: el soma **respira** con los armónicos lentos y se hincha un instante al disparar |
| **Soma de interneurona** | Esfera wireframe pequeña + `ringLoop`. Más chica y más apretada que la piramidal |
| **Astrocito** | **Estrella**: 7–9 radios finos desde un centro, con puntas que terminan en un pie ensanchado. Los pies cercanos a una sinapsis se dibujan pegados a ella |
| **Arbor dendrítico** | Árbol ramificado en el plano, con grosor decreciente. **Se genera con `src/sim/mycelium.js`** (crecimiento de puntas con ramificación, tropismo y ancho por flujo) durante el build y se **congela**: es literalmente el mismo algoritmo que hace crecer hifas |
| **Espinas dendríticas** | Puntitos sobre las ramas (reales: miles; visibles: decenas). Se encienden al recibir neurotransmisor |
| **Cono axónico** | Un ensanche corto en el arranque del axón, más brillante: es donde nace el spike |
| **Axón mielinizado** | Doble línea paralela (la vaina) partida en segmentos, con **nodos de Ranvier** entre ellos: anillos pequeños y brillantes |
| **Axón amielínico** | Línea simple, más fina y más tenue |
| **Spike** | Punto brillante con halo, alargado en la dirección de avance. En axón mielinizado **desaparece bajo la vaina y reaparece en el nodo** |
| **Botón terminal** | Bulbo icosaédrico wireframe con las vesículas dentro |
| **Vesículas** | Puntos dentro del bulbo. Las del pool listo, pegadas a la zona activa (la cara que da a la hendidura); las de reserva, más atrás y más apagadas |
| **Hendidura** | Dos líneas paralelas separadas: la membrana presináptica (con la zona activa marcada) y la postsináptica (con los receptores como arcos pequeños) |
| **Neurotransmisor** | Nube de puntos difundiendo entre las dos líneas |
| **Iones** | Destellos efímeros sobre el contorno del soma durante el spike: Na⁺ hacia adentro, K⁺ hacia afuera |
| **Capilar** | Línea gruesa serpenteante cruzando el fondo, con glóbulos (puntos alargados) que pasan de a uno |
| **Neuropilo** | Nube densa de puntos apagados en el plano de fondo: la maraña que no se dibuja |

### 5.3 Paleta

De `PALETTE` (`src/config.js`), sin inventar colores salvo el acento del HUD — la misma regla que
siguieron célula y micelio.

| Elemento | Color | Lectura |
|---|---|---|
| Soma / membrana | `white` `#EEF2FF` | Neutro: define el individuo |
| Dendritas | `cyanSat` `#35E6D2` tenue | La red de entrada |
| Axón amielínico | `blue` `#2B48FF` | Cable lento |
| Vaina de mielina | `white` muy tenue | Aislante |
| **Nodos de Ranvier** | `yellow` `#FFE21A` | Donde el pulso se regenera |
| **Spike** | `yellow` `#FFE21A` + núcleo `white` | El sujeto del mundo |
| Cono axónico | `yellow` apagado | Donde nace el disparo |
| Botón terminal / vesículas | `pink` `#FF5FB0` | Carga lista para salir |
| Calcio entrando en el terminal | `cyanEye` `#16F0D8` | El gatillo de la liberación |
| **Glutamato (excita)** | `orange` `#FF7A14` | Cálido = enciende |
| **GABA (inhibe)** | `cyan` `#10E6CF` | Frío = apaga |
| Receptores encendidos | `bond` `#FFB15A` | Donde aterriza la señal |
| Astrocito | `bond` `#FFB15A` tenue | Soporte, siempre al fondo |
| Capilar / glóbulos | `magenta` `#FF1F8F` tenue | Lo único no-neural del cuadro |
| Neuropilo de fondo | `[0.30, 0.34, 0.52]` | El mismo azul apagado del sustrato de la célula |

**Nota sobre el riesgo de colisión.** `yellow` es a la vez spike y nodo de Ranvier — a propósito:
el nodo es *donde el spike existe*. `cyan` (GABA) y `cyanSat` (dendritas) están cerca, pero se
distinguen por **comportamiento**: el GABA es una nube que difunde en la hendidura, la dendrita es
una línea fija. Es la misma resolución que la célula usó para magenta/pink (invasores vs vesículas):
**el movimiento desambigua antes que el color**.

**Color de acento del mundo** (`--accent` del HUD): los cinco existentes son `#b6d184` land,
`#aacdff` water, `#fab75e` city, `#c9a6ff` cell, `#9cc47a` fungus. Para neurona se propone
**`#f2a0c8`** (rosa pastel): no colisiona con ninguno, y el rosa/magenta es la convención de tinción
en histología neural (Nissl, Golgi-Cox invertido). Es color nuevo, no de la paleta — queda marcado
como decisión propia, igual que el violeta de la célula.

---

## 6. Los estados cerebrales — el eje del mundo

`src/sim/ecosystem.js` ya acepta un perfil por mundo vía `setProfile`. El mundo neurona aporta el
suyo: 12 fases (el "día") + 6 estados de "clima". Es el equivalente exacto de lo que en la célula
fue el ritmo funcional del macrófago.

### 6.1 Las 12 fases → un ciclo de sueño

Un ciclo de sueño real dura ~90 min y una noche tiene 4–5. Aquí cabe uno en los 540 s de
`dayLengthSec` (45 s por fase). El hipnograma comprimido:

| # | Fase (clave) | Español | Ritmo dominante | `act` | Sincronía | Lectura visual |
|---|---|---|---|---|---|---|
| 0 | `quiet wake` | vigilia tranquila | alfa ~10 Hz | 0.55 | 0.35 | Disparo disperso, ritmo suave de fondo |
| 1 | `alert wake` | vigilia alerta | beta ~20 Hz | 0.75 | 0.20 | Todo desincronizado, actividad alta |
| 2 | `focused` | atención | gamma ~40 Hz | 0.90 | 0.15 | **Pico de actividad**: lluvia densa de spikes |
| 3 | `drowsy` | somnolencia | theta ~6 Hz | 0.50 | 0.45 | El alfa se fragmenta, aparecen pausas |
| 4 | `N1` | sueño ligero | theta ~5 Hz | 0.42 | 0.55 | Ondas agudas ocasionales |
| 5 | `N2 spindles` | husos | husos 13 Hz | 0.40 | 0.68 | **Husos**: ráfagas de 1 s que barren la red |
| 6 | `N3 slow wave` | ondas lentas | delta ~2 Hz | 0.35 | 0.85 | Empiezan los estados UP/DOWN |
| 7 | `N3 deep` | sueño profundo | delta ~1 Hz | 0.30 | **0.95** | **Pico de sincronía**: la red late entera, con silencios totales |
| 8 | `N2 return` | vuelta a husos | husos 13 Hz | 0.42 | 0.70 | Se aligera |
| 9 | `REM` | REM | theta ~7 + desincronía | 0.82 | 0.18 | Actividad de vigilia sin orden: el contrapunto de N3 |
| 10 | `REM burst` | ráfaga REM | theta + PGO | 0.88 | 0.22 | Ráfagas en salvas |
| 11 | `waking` | despertar | alfa vuelve | 0.60 | 0.30 | Se reorganiza y vuelve a 0 |

**El mundo tiene dos clímax opuestos, y eso es su hallazgo narrativo.** En el bosque el clímax es el
coro del alba (todos cantan); en la célula, la división. Aquí hay dos y son contrarios:
`N3 deep` es **máxima sincronía con mínima actividad** (la red late entera y se calla entera), y
`REM` es **máxima actividad con mínima sincronía** (todos disparan, nadie de acuerdo). El mundo
oscila entre orden y ruido, que es exactamente lo que hace un cerebro dormido.

**`temperature`:** 37 fijo, como la célula. No hay estación (`season: null` en el `hud` del registro).

**La columna "sincronía" no la produce `ecosystem.js`** (su `phaseData` solo aporta `act`, `temp`,
`light`, `gain`). La produce un módulo puro propio, `src/sim/brainstate.js` (§9.3), que a partir de
`eco.phase` entrega: banda dominante en Hz, sincronía objetivo, probabilidad de estado DOWN,
presencia de husos y deriva hacia la convulsión. Es la misma arquitectura con que la célula sacó el
ciclo celular fuera del reloj (`cellCycle.js`).

### 6.2 Los 6 "climas" → neuromoduladores

El clima de este mundo no es meteorología: es **química de fondo que cambia cómo responde la red**.

| Estado | `act` | `tension` | Efecto en el mundo | Base real |
|---|---|---|---|---|
| `cholinergic` (colinérgico) | 1.05 | 0.15 | Desincroniza, favorece gamma y REM | La ACh es alta en vigilia **y en REM**, baja en NREM |
| `noradrenergic` (noradrenérgico) | 1.15 | 0.50 | Alerta: disparo alto, tensión alta, gana el ruido | **Se apaga por completo en REM** — el único transmisor que hace eso |
| `dopaminergic` (dopaminérgico) | 1.00 | 0.20 | Ráfagas: las piramidales disparan en salvas cortas | La dopamina señaliza en *bursts*, no en tono continuo |
| `high adenosine` (adenosina alta) | 0.55 | 0.30 | Empuja a delta: la presión de sueño gana | La adenosina se acumula con las horas despierto |
| `caffeine` (cafeína) | 0.95 | 0.40 | Bloquea la adenosina: la red se resiste a dormirse | **No da energía: quita el freno.** Antagonista del receptor de adenosina |
| `gabaergic` (gabaérgico) | 0.40 | 0.10 | Sedación: sincronía alta, actividad baja | Es lo que hacen las benzodiacepinas y el alcohol |

Detalle que hace narrable el sistema: **cafeína + adenosina alta a la vez** es el estado más
reconocible que puede tener el mundo — la red quiere dormirse y no la dejan.

### 6.3 Reasignación de los campos existentes

| Campo del core | En el bosque | En la neurona |
|---|---|---|
| `temperature` | °C del aire | 37 fijo (sin estación) |
| `rain` | Lluvia | **Densidad de actividad multiunidad de fondo**: los spikes de las neuronas que no están en cuadro. Es lo que suena a lluvia (§7) |
| `fog` | Niebla | Densidad del neuropilo: cuánto se difumina el fondo |
| `light` / `gain` | Luz del día | Frío y apagado en sueño profundo, brillante y neutro en vigilia/REM |
| `activity` | Actividad de la fauna | Tasa media de disparo de la red |
| `tension` | Tensión del ecosistema | Riesgo de hipersincronía: alimenta el drone y gatea la convulsión |
| `flash()` | Relámpago | **Onda de sincronía** barriendo la red (y, en su forma patológica, la convulsión) |

**La convulsión — el conflicto del mundo.** Es el equivalente de la fagocitosis en la célula: el
acontecimiento fuerte, raro y consecuente. Mecánica propuesta:

1. Se acumula riesgo con `tension` alta + neuromodulador excitante + sincronía ya alta.
2. Al dispararse, **el peso sináptico excitatorio se multiplica y el inhibitorio se hunde** (es
   literalmente el desbalance E/I real). La red se recluta: cada disparo provoca los siguientes.
3. Durante ~8–12 s todo late junto a ~3 Hz. `phaseVariance` se va a casi 0 (sincronía ~1). El
   `stage.flash` late con la red.
4. **Termina en silencio postictal**: la red se queda muda unos segundos, exhausta. El silencio es
   la parte más impresionante y es gratis de implementar.

Es raro por diseño (cooldown largo), tiene causa visible, y **el lado malo del disparo colectivo**
que el usuario pidió: en el bosque la sincronía es belleza; acá, cuando es total, es patología.

---

## 7. Sonido

Todo sintetizado con Tone.js sobre el grafo que ya existe. La regla estética del mundo: **es el
mundo más seco y más eléctrico de burbur** — nada de húmedo (la célula ya tomó ese registro con sus
*bloops*), nada de orgánico grave (el micelio ya tomó ese).

### 7.1 Los spikes son clicks

Este es el punto donde la sonificación es **literal, no metafórica**: un electrodo extracelular
apuntando a un puñado de neuronas suena exactamente así — un crepitar de clicks, como lluvia o
palomitas de maíz. No hay que estilizarlo; hay que reproducirlo.

- **Un click seco por spike**: ruido pasa-banda 2–4 kHz, 2–5 ms, sin reverb, paneado según la
  posición de la neurona en el plano.
- La **densidad** es la tasa de disparo de la red. En `focused` es una lluvia continua; en `N3 deep`
  son golpes agrupados con silencios entre medio.
- **Los estados DOWN se oyen como silencio abrupto** (~200–400 ms). El silencio hace más por la
  lectura del sueño profundo que cualquier textura añadida.
- La actividad de fondo (`eco.rain`, §6.3) es un siseo de clicks más lejanos y apagados: las
  neuronas fuera de cuadro. Reutiliza el `setRain` existente con el filtro más alto.

Hoy `main.js` ya tiene el canal: la célula emite `{type: 'pulse'}` desde `scene.update()` y el host
lo convierte en nota con un token bucket de ~6/s. El mundo neurona necesita el mismo canal con
**voz distinta y bucket más alto** (~20/s): la lluvia de spikes necesita densidad para leerse
(§9.4f).

### 7.2 Los ritmos son modulación, no notas

Delta (0.5–4 Hz), theta (4–8), alfa (8–12), beta (13–30) y gamma (30–80) están **por debajo del
rango audible como tono**. Intentar tocarlos como notas sería falsear el fenómeno. Lo correcto —y lo
que suena mejor— es usarlos como **modulación de amplitud del drone existente**, a su frecuencia
real:

- 1–4 Hz (delta) → pulsación lenta, hipnótica. Se *siente* el latido de la red.
- 6–8 Hz (theta) → temblor.
- 10 Hz (alfa) → vibrato rápido.
- 13 Hz (husos) → ráfagas de 1 s: el huso de sueño es audible como un *aleteo* que aparece y se va.
- 40 Hz (gamma) → deja de percibirse como pulsación y empieza a oírse como **rugosidad**, el borde
  entre ritmo y tono. Es una transición psicoacústica real y ocurre justo en la banda gamma.

`src/audio/engine.js` **ya tiene la pieza**: `droneThrob` con `throbLFO` a 0.2 Hz. Solo hace falta
poder mover su frecuencia (§9.4f). Es el cambio de audio más barato y más rentable del diseño.

### 7.3 Voces por evento

| Fuente | Textura |
|---|---|
| **Spike** | Click seco (§7.1) |
| **Ráfaga de una neurona** | Tren de 4–8 clicks acelerando: se oye como un redoble corto |
| **Liberación sináptica** | El `drip()` existente, muy apagado y con pasa-altos: un "tsk" mínimo |
| **Fallo de liberación** | **Nada.** El spike llega y no suena. El silencio *donde debería haber algo* es el mejor recurso disponible para narrar el fallo |
| **Neurotransmisor cruzando** | Siseo brevísimo, filtro que se abre mientras la nube avanza |
| **Recaptación por astrocito** | Siseo descendente lento — la única voz *lenta* del mundo, y por eso reconocible |
| **Inhibición (GABA)** | Un click **invertido**: un hueco en la textura, un ducking corto del drone |
| **Huso de sueño** | Ráfaga de tremolo a 13 Hz sobre el drone + barrido suave de filtro |
| **Complejo K** | Un golpe grave aislado en N2 (real: el complejo K es la onda evocada más grande del EEG) |
| **Onda de sincronía** | Barrido de filtro cruzando el estéreo, en la dirección en que barre la red |
| **Convulsión** | Todos los clicks colapsan en un pulso rítmico único a 3 Hz; el drone sube y se satura; termina en **silencio postictal** de varios segundos |
| **Cargo axonal** | Tic regular muy tenue (mismo recurso que los motores de la célula) |

**Escala melódica:** el drone del proyecto usa pentatónica menor. Para la neurona se propone
**mantenerla** pero subir el brillo del filtro y bajar el `Q` de resonancia: menos "vocal", más
eléctrico. No hace falta cambiar `scale.js`.

**Voz de agente (`fauna`)**: hoy `engine.js` mapea los tipos de la célula (`organelle`, `motor`,
`invader`, `structure`, `signal`) a *bloops* húmedos. Los tipos nuevos (`neuron`, `interneuron`,
`glia`, `synapse`, `neurotransmitter`, `tissue`) necesitan su rama: un **tick eléctrico** corto y
seco, más agudo para las interneuronas (que disparan rápido) y más grave para la glía.

---

## 8. Events log

El narrador (`src/sim/narrator.js`) ya acepta léxico por mundo, con acciones por tipo **y por
nombre**, plantillas reemplazables por tipo de evento, y `byKind` para acontecimientos grandes. El
mundo neurona aporta `NEURON_LEXICON`; no hace falta motor nuevo. **En español**, como célula y
micelio (el spec de célula decía inglés y el proyecto ya evolucionó a español).

### 8.1 Léxico por tipo de agente

```
neuron:            'dispara una ráfaga corta' / 'se carga hasta el umbral y descarga' /
                   'queda en refractario un instante' / 'suma entradas y no llega a disparar' /
                   'se enciende justo cuando lo hace su vecina'
interneuron:       'dispara rápido y sin pausa' / 'calla a sus vecinas de golpe' /
                   'abre una ventana de silencio' / 'recorta la ráfaga que venía'
glia:              'barre lo que quedó en la hendidura' / 'estira un pie hacia una sinapsis' /
                   'deja pasar una onda lenta de calcio' / 'alimenta a la sinapsis que trabaja'
synapse (nombre):  'el botón terminal' → 'suelta su pool listo' / 'se queda sin vesículas' /
                   'recibe el pulso y no libera nada'
                   'la hendidura sináptica' → 'se llena y se vacía' / 'queda limpia otra vez'
                   'el nodo de Ranvier' → 'enciende y pasa el relevo'
                   'la bomba sodio-potasio' → 'devuelve el gradiente a su sitio, gastando'
neurotransmitter:  'inunda la hendidura' / 'encuentra su receptor' / 'se escapa hacia afuera'
signal:            'barre la red de un lado al otro' / 'se apaga en el borde'
tissue:            'late al fondo, ajeno a todo' / 'entrega oxígeno y sigue'
```

### 8.2 Eventos ambientales (sin agente)

```
"Un pulso recorre un axón y se pierde en el borde."
"En algún lugar de la red, una sinapsis falla en silencio."
"El neuropilo cruje de actividad que no se ve."
"Una mitocondria se detiene en un terminal y se queda."
"Un capilar late, ajeno a la conversación."
"El ritmo de fondo se hace más lento."
```

### 8.3 Eventos narrados de ejemplo

Los cinco que el usuario pidió explícitamente van marcados con ★.

| Tipo | Texto del log |
|---|---|
| ★ `sound` | *Piramidal dispara una ráfaga; el pulso salta de nodo en nodo hasta el terminal.* |
| ★ `signal` | *Una onda de sincronía barre la red de izquierda a derecha.* |
| ★ `interaction` | *El botón terminal suelta su pool listo: glutamato inunda la hendidura.* |
| ★ `conflict` (inhibición) | *Interneurona calla a sus vecinas. Tres somas se apagan a la vez.* |
| ★ `conflict` (convulsión) | *Todas disparan juntas. La red se traba en su propio eco.* |
| `sound` | *El pulso llega al botón y no pasa nada. La sinapsis falló.* |
| `interaction` | *Astrocito barre el glutamato que quedaba; la hendidura queda limpia.* |
| `residue` | *El terminal se quedó sin vesículas listas; las repone de a poco.* |
| `moment` (huso) | *Un huso de sueño cruza la red y se deshace.* |
| `moment` (estado DOWN) | *La red se calla entera. Medio segundo de nada.* |
| `moment` (UP) | *Vuelve de golpe: todas retoman a la vez.* |
| `sound` | *Una mitocondria termina su viaje y se queda a vivir en la sinapsis.* |
| `distant` | *A lo lejos, un axón largo entrega su pulso con retraso.* |
| `shift` (fase) | *El estado gira hacia sueño profundo; el ritmo se hace lento y ancho.* |
| `shift` (clima) | *Sube la adenosina. A la red le cuesta sostenerse despierta.* |
| `overview` | *Cafeína se asienta sobre la red mientras se ahonda la somnolencia.* |
| `conflict` (postictal) | *Se apaga todo. Nadie dispara. La red vuelve despacio.* |

### 8.4 Nota sobre la convulsión

Es el evento más fuerte del mundo y debe ser **raro y consecuente**, igual que la apoptosis en la
célula: solo con tensión sostenida + neuromodulador excitante + sincronía ya alta, y con un cooldown
largo después. **No mata el mundo**: dura ~10 s, termina en silencio postictal de ~5 s y la red se
reorganiza. No hace falta reconstruir la escena.

Hay una decisión editorial que conviene nombrar: la epilepsia es una condición real de personas
reales. El tratamiento en el log debe ser **descriptivo y sobrio** —lo que hace la red, no drama—
igual que el mundo célula narra la apoptosis sin ponerse solemne.

---

## 9. Encaje técnico

### 9.1 El contrato del registro

`src/worlds/registry.js` define cada mundo como `{ id, label, name, accent, ready, census, lexicon,
ecosystem, hud, audio, build }`, donde `build(container, cfg, names)` devuelve
`{ update(swarm, dt, eco), resize, flash(v), scare(strength), dispose }` (más `setPointer` opcional).
El mundo neurona entra como una entrada más:

```js
{
  id: 'neuron', label: 'Network ecosystem', name: 'Neurona', accent: '#f2a0c8', ready: true,
  census: NEURON_CENSUS, lexicon: NEURON_LEXICON, ecosystem: NEURON_PROFILE,
  hud: { time: 'ESTADO', weather: 'NEUROMODULADOR', season: null },
  audio: { rain: false, insects: false, owl: false },
  // Acoplamiento continuo apagado: acá el acoplamiento entra por las sinapsis (§2).
  swarm: { couplingK: 0, omegaSpread: 0.35 },
  build: (container, cfg, names) => createNeuronScene(container, cfg, names),
}
```

`buildWorld` en `src/main.js:57` ya arma swarm, censo, escena y motor de eventos por mundo, y hace
`dispose()` al cambiar. El selector, el acento, el shake y el bucle de frames funcionan sin tocar
nada. Lo único nuevo del contrato es `swarm` (§9.4a).

### 9.2 Qué se reutiliza tal cual

| Módulo | Uso en la neurona |
|---|---|
| **`src/render/stage.js`** | El escenario completo: escena, niebla, cámara aérea 3/4, órbita con respiración, lente (fisheye + cromática + viñeta), etiqueta flotante, overlay de destello, resize, dispose |
| **`src/render/engine/points.js`** | `createDraw` para lo estático (neuropilo, capilar, mielina); `createPointCloud` para lo dinámico (spikes, neurotransmisor, vesículas, iones); `createLineBuffer` para lo que se reescribe cada frame (contornos de soma, hendiduras activas) |
| **`src/render/engine/agents3d.js`** | `frustumCage` (soma piramidal), `ringLoop` (soma de interneurona), `fatLine` (jaulas y estrella del astrocito), `setResolution` |
| **`src/render/engine/trails.js`** | Estelas — solo para los astrocitos, que son los únicos que se desplazan |
| **`src/render/engine/haze.js`** | Densidad del tejido de fondo |
| **`src/sim/fireflies.js`** | **El corazón (§2)**: `createSwarm`, `updateSwarm`, `phaseVariance`, `perturbPhases`. Sin cambios: el mundo escribe `phases`/`omegas` desde fuera |
| **`src/sim/motors.js`** | Transporte axonal: `createMotors`/`updateMotors`/`motorPosition` sirven tal cual, cambiando el riel radial por el axón |
| **`src/sim/atp.js`** | Economía energética: mitocondrias axonales → bomba Na⁺/K⁺ (§4.7). Sin cambios |
| **`src/sim/membrane.js`** | El contorno del soma (protrusión 0, armónicos lentos: respira y se hincha al disparar) |
| **`src/sim/mycelium.js`** | **El arbor dendrítico**: `createNetwork`/`updateNetwork` con ramificación y tropismo, corrido en el build y congelado |
| **`src/sim/wander.js`** | Solo para los astrocitos: `createRoamers`/`updateRoamers` con velocidad muy baja |
| **`src/sim/invaders.js`** | El **patrón** de difusión pura del virión. Se replica en `synapse.js` (§9.3) en vez de forzar el módulo: el neurotransmisor no tiene `bound`, tiene receptores y recaptación |
| **`src/sim/events.js`** · **`src/sim/agents.js`** · **`src/sim/narrator.js`** · **`src/sim/ecosystem.js`** | Agnósticos del contenido: solo se añaden censo, léxico y perfil |
| **`src/audio/engine.js`** | Todo el grafo; se añaden dos voces y un setter (§9.4f) |
| **`src/ui/*`** | HUD, log, selector, shake — sin cambios (el `hud` por mundo ya es parametrizable) |

### 9.3 Qué es código nuevo

1. **`src/worlds/neuron.js`** — el builder `createNeuronScene(container, cfg, agentNames)` montado
   sobre `createStage`. Como `cell.js` creció a 1200 líneas y hubo que partirlo en `worlds/cell/*`,
   acá conviene **nacer partido**: `worlds/neuron/{soma,axon,synapse,glia,tissue}.js`.
2. **`src/sim/netwire.js`** — puro: posiciones de los somas, tipo E/I por slot, topología
   dependiente de la distancia (§4.1), polilínea de cada axón, posición de cada terminal, y los
   nodos de Ranvier de los axones mielinizados. Se construye una vez y no cambia. Testeable:
   conectividad garantizada, grado dentro de rango, sin auto-sinapsis.
3. **`src/sim/spikes.js`** — puro: cola de spikes con `t` ∈ 0..1 sobre su axón, velocidad según
   mielinización, salto entre nodos, período refractario, y emisión del evento de llegada al
   terminal. Testeable: un spike lanzado llega en el tiempo esperado; un axón mielinizado llega
   antes que uno amielínico de la misma longitud.
4. **`src/sim/synapse.js`** — puro: pool de vesículas (listo / reserva / reciclaje), probabilidad
   estocástica de liberación, depresión por agotamiento, nube de neurotransmisor con difusión +
   decaimiento + recaptación, y el peso de fase resultante (signo según E/I). Testeable: con `p=0`
   nunca libera; con disparo sostenido el pool se agota y se recupera; el GABA entrega peso negativo.
5. **`src/sim/brainstate.js`** — puro: dado `eco.phase` y `eco.weather`, entrega banda dominante
   (Hz), sincronía objetivo, probabilidad de estado DOWN, husos activos, y el acumulador de riesgo
   de convulsión con su máquina de estados (normal → reclutamiento → crisis → postictal). Es el
   `cellCycle.js` de este mundo. Testeable sin render.
6. **`NEURON_CENSUS`** en `src/sim/agents.js`, **`NEURON_LEXICON`** en `src/sim/narrator.js`,
   **`NEURON_PROFILE`** en `src/sim/ecosystem.js`, **`NEURON_PHASE_ES` / `NEURON_WEATHER_ES`** en
   `src/i18n.js`, y la config `CONFIG.neuron` en `src/config.js`.

### 9.4 Los cambios que el core sí necesita

Todos acotados y retro-compatibles, pero hay que nombrarlos antes de empezar.

**(a) Config de swarm por mundo — el único cambio imprescindible.**
Hoy `main.js:59` hace `createSwarm(CONFIG.fireflies)` y `main.js:172` hace
`updateSwarm(swarm, CONFIG.fireflies, dt)`: el swarm es idéntico en los seis mundos. La neurona
necesita `couplingK: 0` (§2.1) y un `omegaSpread` mayor. Cambio propuesto:

```js
// buildWorld
const swarmCfg = def.swarm ? { ...CONFIG.fireflies, ...def.swarm } : CONFIG.fireflies
const swarm = createSwarm(swarmCfg)
...
return { def, swarm, swarmCfg, pop, scene, events }
// frame
updateSwarm(swarm, world.swarmCfg, dt)
```

Tres líneas, sin efecto sobre los mundos que no declaran `swarm`. **Y es el mismo cambio que
habilita la fase posterior de ~40 neuronas** (`swarm: { count: 40 }`), lo que lo hace doblemente
barato.

**(b) Partición de slots del censo por clase — recomendado, no bloqueante.**
`createCensus(source, count, rand, isAerial)` sabe partir los slots en dos grupos, pero el criterio
está cableado al tipo `flying_animal` del bosque (`agents.js:207`). La neurona necesita exactamente
la misma mecánica con otro criterio: que los slots inhibitorios reciban nombres de
`interneuron`, los de glía nombres de `glia`, y el resto `neuron`. Dos opciones:

- **B1 ⭐ recomendada — generalizar el gancho.** Cambiar `isAerial` por un
  `slotClass(i, cfg) → tipo` opcional; si el mundo lo declara, el slot se llena del subconjunto del
  censo con ese tipo (con fallback al conjunto general si está vacío). ~8 líneas en `agents.js`,
  y `land`/`water`/`city` se adaptan devolviendo `'flying_animal'` o `null` — comportamiento
  idéntico, un concepto menos en el core.
- **B2 — dejarlo como está** y que el mundo ignore el nombre del censo para decidir E/I. Barato,
  pero produce logs incoherentes ("*piramidal calla a sus vecinas*" en un slot inhibitorio), que es
  justo el tipo de error que el léxico por nombre vino a resolver en la célula.

**(c) Sonido: dos voces y un setter.** En `src/audio/engine.js`:
- `spike(pan, bright)` — click seco de 2–5 ms (ruido pasa-banda, sin reverb).
- `setThrob(hz)` — mueve la frecuencia de `throbLFO`, que hoy está fija en 0.2 Hz. **Una línea**, y
  es lo que hace audibles los ritmos cerebrales (§7.2).
- Rama de `fauna()` para los tipos nuevos (tick eléctrico en vez de *bloop* húmedo).

**(d) Host: canal de spikes.** `main.js:195` ya rutea `p.type === 'pulse'` con un token bucket de
6/s hacia `audio.triggerFlash`. Añadir `p.type === 'spike'` → `audio.spike(...)` con bucket propio
más alto (~20/s). ~4 líneas, en el mismo bloque que ya existe.

**(e) Nada más.** No hace falta tocar `stage.js`, `engine/*`, el HUD, el selector, el motor de
eventos ni el narrador: las tres parametrizaciones que la célula y el micelio necesitaron
(`setProfile`, léxico por mundo, `hud` por mundo) **ya están hechas y en uso**.

**Menor, opcional:** el HUD fija la etiqueta `TEMPERATURA` con unidad `°C`. Mostrar en su lugar la
**banda dominante en Hz** sería mejor para este mundo, pero pide etiqueta y unidad parametrizables
en `createHud` — la misma mejora que la célula dejó anotada para el pH y que sigue sin ser
bloqueante. Mientras tanto: 37 °C.

### 9.5 Fases sugeridas de implementación

Con criterio de verificación por fase. Tests: `npx vitest run --exclude '**/.claude/**'`.

| Fase | Entrega | Verificación |
|---|---|---|
| **F0** | Módulos puros sin render: `netwire.js` + `spikes.js` + `synapse.js` con sus tests. No depende de nada del engine, se puede hacer primero | Tests verdes: la red queda conectada; un spike mielinizado llega antes que uno amielínico; el pool se agota y se repone; el GABA entrega peso negativo |
| **F1** | Red estática sobre `createStage`: somas, dendritas (mycelium congelado), axones con mielina y nodos, terminales, neuropilo, capilar. `ready: true` en el registro | Se cambia de mundo y se ve una red reconocible; sin errores de consola; `dispose` limpio al volver a `land` |
| **F2** | **Los spikes se ven**: swarm con `couplingK: 0`, disparo desde el cono axónico, propagación por el axón (salto vs deslizamiento), refractario. Requiere §9.4a | El pulso recorre el axón y se ve la diferencia entre los dos tipos de cable |
| **F3** | **La sinapsis funciona**: calcio, liberación estocástica, vesículas que se gastan, neurotransmisor difundiendo, receptores, empujón de fase. La red se acopla de verdad | Un disparo provoca (a veces) el siguiente; se ven fallos de liberación; el GABA apaga somas visiblemente |
| **F4** | Estados cerebrales: `NEURON_PROFILE` + `brainstate.js` + husos + estados UP/DOWN + narrador propio cableado | El HUD muestra los estados; el log narra en vocabulario neural; en N3 la red late y se calla entera |
| **F5** | Sonido propio: clicks de spike, throb del drone en la banda dominante, voces de evento. Requiere §9.4c y §9.4d | Suena a registro multiunidad real; en delta se siente el pulso; el silencio DOWN se oye |
| **F6** | Astrocitos (recaptación) + transporte axonal (`motors.js`) + ATP de la bomba Na/K + convulsión con su postictal | El astrocito limpia la hendidura; la mitocondria tarda un minuto donde el spike tarda un segundo; la convulsión ocurre, se resuelve y se narra |

Se puede empezar por F0 **hoy**, sin bloquear a nadie: son módulos puros que no tocan ningún archivo
compartido.

### 9.6 Qué NO hacer

- **No simular Hodgkin-Huxley.** El integrate-and-fire que ya existe da la conducta correcta con dos
  órdenes de magnitud menos de código. Es un mundo vivo, no un solver de ecuaciones diferenciales.
- **No poner 40 neuronas en la primera versión.** Cada sinapsis dejaría de verse, que es lo que el
  usuario pidió mirar. Está agendado y su costo ya está acotado (§3.0).
- **No añadir plasticidad (STDP).** Es fascinante y no se vería: los pesos cambiarían sin lectura
  visual. Si más adelante entra, tiene que entrar **con cuerpo** (espinas que engordan).
- **No convertirlo en un diagrama de neurofisiología.** Nada de etiquetas fijas, flechas ni leyendas:
  la única etiqueta es la flotante que ya existe, al pasar el mouse.
- **No romper la paleta.** Los colores salen de `PALETTE`; el único invento es el acento del HUD.
- **No dramatizar la convulsión** en el log (§8.4).

---

## 10. Decisiones abiertas — resumen

Todas tienen recomendación; ninguna bloquea empezar por F0.

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| 1 | **Cuántas neuronas** | 8 / **12+6 glía** / 18 / ~40 | ⭐ **12 neuronas + 6 astrocitos** (§3.0). Cada sinapsis se ve, los 18 slots tienen identidad, la proporción E/I queda casi real. ~40 queda agendado y su costo ya está acotado |
| 2 | **Detalle de la sinapsis** | Zoom de cámara / **escala exagerada** / inset 2D | ⭐ **Escala exagerada declarada + detalle bajo demanda** (§1). No toca la cámara; el detalle fino solo aparece en las sinapsis activas |
| 3 | **Topología** | Aleatoria / **por distancia** / mundo pequeño | ⭐ **Dependiente de la distancia**, grado medio 2.5 (§4.1). Es lo que produce ondas viajeras sin programarlas |
| 4 | **Acoplamiento** | Kuramoto continuo / **pulsos (Mirollo–Strogatz)** | ⭐ **Por pulsos, con `couplingK: 0`** (§2). Es lo que le da cuerpo visible al acoplamiento |
| 5 | **Slots del censo** | **Generalizar `isAerial`** / dejarlo | ⭐ **Generalizar** a `slotClass` (§9.4b). ~8 líneas y evita logs incoherentes |
| 6 | **Acento del HUD** | `#f2a0c8` rosa / otro | ⭐ **`#f2a0c8`** (§5.3). No colisiona con los cinco existentes; convención de tinción neural |
| 7 | **`temperature` en el HUD** | 37 °C fijo / banda dominante en Hz | ⭐ **37 °C fijo** por ahora; la banda en Hz pide etiqueta parametrizable en `createHud`, mejora deseable y no bloqueante (§9.4e) |
| 8 | **Cámara** | Órbita on / off | ⭐ **Órbita on**, al revés que la célula: la red es fija y el giro lento ayuda a leer la profundidad (§5.1) |

---

## 11. Nota de coordinación multi-sesión

El repo tiene varias sesiones trabajando sobre `main`. Para este mundo:

- **F0 no toca ningún archivo compartido** (tres módulos nuevos en `src/sim/` + sus tests): se puede
  empezar sin coordinar con nadie.
- Los archivos compartidos que sí se tocan más adelante son pocos y bien delimitados:
  `registry.js` (una entrada), `agents.js` (un censo + §9.4b), `narrator.js` (un léxico),
  `ecosystem.js` (un perfil), `i18n.js` (dos mapas), `config.js` (un bloque `neuron`),
  `main.js` (§9.4a y §9.4d, ~7 líneas en total) y `audio/engine.js` (§9.4c).
- **Ninguno de esos cambios modifica comportamiento existente**: son adiciones o parametrizaciones
  con default idéntico al de hoy. Aun así, rebasar sobre `main` antes de implementar.
- Tests: `npx vitest run --exclude '**/.claude/**'` (sin el `--exclude`, vitest recorre también los
  worktrees).
