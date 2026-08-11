# Diseño del mundo MICELIO (`fungus`)

**Fecha:** 2026-08-11
**Estado:** diseño **aprobado** — decisiones cerradas con el usuario en esta sesión (§1).
**Alcance:** un quinto mundo del registro, hermano de `land` / `water` / `city` / `cell`, cuyo tema
central es **cómo crece, come y degrada un micelio**.
**Base técnica:** `main` @ `ecd2aae`. Reutiliza `render/stage.js` + `render/engine/*` y —clave— las
tres parametrizaciones que estrenó el mundo célula: perfil de ecosistema (`setProfile`), léxico del
narrador y censo por mundo. **Este mundo es mucho más barato que la célula porque la célula ya pagó
esa deuda.**
**Base biológica:** micología estándar (crecimiento apical, anastomosis, redes de cordones,
podredumbre blanca/parda, nematofagia de *Pleurotus*, inducción de fructificación por choque
térmico).

---

## 0. Resumen ejecutivo

- **La estela ES el organismo.** En los otros mundos los agentes recorren un terreno fijo y su
  estela se desvanece. Acá la punta de la hifa avanza y **lo que deja atrás no se borra**: es
  cuerpo, terreno y red de transporte a la vez. El individuo no es un punto: **es un grafo que
  crece**.
- **El terreno es la comida y se acaba.** Un tronco podrido es la isla, y se degrada *como
  consecuencia de la simulación*, no por temporizador. Cuanto mejor forrajea la colonia, más rápido
  disuelve su propio mundo.
- **Dos monedas, no una.** La madera da **carbono**; los nematodos y cadáveres dan **nitrógeno**.
  Hacen falta las dos, y el nitrógeno es el cuello de botella — que es exactamente por qué
  *Pleurotus* caza.
- **La fructificación se gana, no se agenda.** Cazar nematodos → nitrógeno → poder fructificar.
- **Es el único mundo generacional.** Cuando el tronco se disuelve cae uno nuevo, y lo colonizan
  **las esporas que este mismo mundo soltó**.

---

## 1. Decisiones cerradas

| # | Decisión | Descartado |
|---|---|---|
| 1 | **Vista cenital de un tramo de tronco podrido** (~30–40 cm) con su hojarasca | Corte transversal del suelo (rompe la cámara); interior del tronco (encierra el mundo) |
| 2 | **El macro es el LENTE, no la escala**: se sube la profundidad de campo falsa que ya existe (`dofFocus`/`dofAperture`) para el desenfoque de macrofotografía, sin perder el mapa | Macro real (milímetros): se ve precioso pero desaparece el viaje |
| 3 | **El tronco es la isla**, alargada, no un disco | Parche genérico de suelo |
| 4 | **El sustrato se consume** y su degradación la causa la simulación | Terreno fijo como en los otros mundos |
| 5 | **Protagonistas: *Pleurotus ostreatus* vs *Trametes versicolor***, con estrategias asimétricas | Una sola colonia (sin conflicto) |
| 6 | **Al disolverse el tronco, cae uno nuevo** y lo colonizan las esporas propias | Continuar sobre el humus (apagón en vez de renacimiento) |

---

## 2. El tronco: terreno con anatomía

La isla es una **cápsula alargada** cruzando el cuadro en diagonal, con la hojarasca alrededor y
caída a negro en los bordes (como los otros mundos).

| Capa | Rol para el micelio | Coste / recompensa |
|---|---|---|
| **Corteza** | Placas que se despegan; techo húmedo | Autopista protegida, sin comida |
| **Albura** | Madera externa blanda | Carbono rápido, se agota primero |
| **Duramen** | Núcleo denso de lignina | Lentísimo, enorme — solo lo abre la podredumbre blanca |

**Tres medios de viaje**, que son tres valores de `pathPull`/velocidad distintos:

| Medio | Velocidad | Riesgo | Para qué |
|---|---|---|---|
| Dentro de la madera | Lenta | Ninguno | Ahí está la comida |
| Bajo la corteza | Rápida | Se pierde si la placa cae | Autopistas |
| Por la hojarasca / suelo | Media | Se seca, la pastorean | Exploración hacia el próximo recurso |

**Alrededor del tronco:** hojarasca en capas (carbono fácil y poco), ramitas, una **raíz viva**
cruzando el cuadro (opción micorriza: azúcar constante a cambio de fósforo), un parche de **musgo**
en la cara húmeda (ese lado avanza más), **cadáveres** (escarabajo, babosa → nitrógeno) y un
**caracol vacío** (calcio).

---

## 3. La red: el modelo de crecimiento ⭐ el corazón

Cuatro reglas, todas reales:

1. **Solo crece la punta.** La extensión es apical. Las puntas son los "agentes" que deambulan;
   el resto de la red es estructura.
2. **Se ramifica.** Una punta se parte en dos → la población de puntas **crece**. Es el único
   supuesto del motor que este mundo rompe (los demás tienen `count` fijo).
3. **Se fusiona (anastomosis).** Dos hifas de la **misma** colonia que se encuentran se sueldan →
   el árbol se vuelve **grafo con ciclos**. Dos de **distinta** colonia se rechazan → **línea de
   demarcación**.
4. **Refuerza lo que funciona y poda lo que no.** Las rutas que transportan alimento se engrosan
   hasta volverse **cordones**; las ramas estériles se reabsorben. Es el comportamiento que hizo
   famoso al *Physarum* resolviendo la red ferroviaria de Tokio, y **es lo que impide que esto sea
   un fractal de salvapantallas**: la forma final es un mapa de dónde había comida.

**Dirección de la punta** = paseo aleatorio sesgado (el mismo patrón de `motility.js`) +
**tropismo** hacia el recurso más cercano + **autotropismo negativo** (se aparta de su propia red,
que es real y es lo que hace que colonice en vez de amontonarse).

### `src/sim/mycelium.js` (módulo puro nuevo — el grande)

```js
export function createNetwork(cfg, seeds, rand)
//  seeds = [{x, z, colony}]  — de dónde arranca cada colonia
export function updateNetwork(net, cfg, dt, rand, field)
//  field = { resourceAt(x,z), mediumAt(x,z), moisture }
export function tipPositions(net)        // para dibujar las puntas
export function networkStats(net)        // { nodes, edges, tips, cordLength, byColony }
```

Estructura: `nodes[]`, `edges[] {a, b, width, flow, colony}`, `tips[] {node, ang, colony, vigor}`.
**Pools de tamaño fijo con lista de libres** — el mismo patrón que ya usan `atp.js` e `invaders.js`.
Sin tope, el grafo revienta el navegador; y la poda no es un truco de optimización: **es la
biología**.

---

## 4. Economía: dos monedas

| Sustrato | Da | Ritmo |
|---|---|---|
| Hoja | Carbono fácil | Rápido, poco |
| Rama | Carbono medio | Medio |
| Tronco (albura → duramen) | Carbono | Lentísimo, enorme |
| **Nematodo / cadáver** | **Nitrógeno** | Rápido, escaso, decisivo |
| Raíz viva (micorriza) | Azúcar por fósforo | Ingreso constante |

El carbono permite **avanzar**; el nitrógeno permite **construir** y, sobre todo, **fructificar**.

### `src/sim/decay.js` (módulo puro nuevo)

```js
export function createSubstrate(cfg, rand)      // tronco (3 capas) + hojas + cadáveres
export function resourceAt(sub, x, z)           // { carbon, nitrogen, hardness, layer }
export function consume(sub, x, z, amount)      // → { carbon, nitrogen } realmente extraídos
export function updateDecay(sub, cfg, dt)
export function decayClass(sub)                 // 1..5, derivado de cuánto se consumió
```

---

## 5. Los dos hongos: pelean distinto

No son dos colores del mismo comportamiento — **tienen estrategias opuestas**, y ahí está el juego:

| | *Trametes versicolor* | *Pleurotus ostreatus* |
|---|---|---|
| **Crecimiento** | Rápido, frente ancho y fino | Lento, denso, invierte en cordones |
| **Fuerte en** | Tomar territorio nuevo | Aguantar el asedio largo |
| **Nitrógeno** | Depende de lo que encuentre | **Lo caza** (nematófago) |
| **Podredumbre** | Blanca — la madera se aclara y se vuelve fibrosa | Blanca — ídem, pero abre el duramen |
| **Fructifica** | Rosetas bandeadas sobre la superficie | **Repisas escalonadas saliendo del flanco** |

Trametes gana la carrera inicial; Pleurotus gana la guerra larga **si consigue nitrógeno**.

**Firma en el terreno:** el tipo de podredumbre deja marca visible. La **parda** (si añadimos un
tercer competidor) oscurece la madera y la **agrieta en cubos**, que es inconfundible. Y donde dos
colonias se tocan queda la **línea negra de demarcación** — las vetas del *spalted wood*. **El
tronco termina siendo el mapa de quién ganó dónde.**

---

## 6. Fauna y conflicto: va en los dos sentidos

Cada mundo de murmur tiene su versión de "el mundo caza cosas pequeñas" — el bosque tiene pájaros
comiendo bichos, la célula fagocita bacterias. Acá:

- **Los colémbolos pastorean el micelio.** Muerden el frente de avance y la red retrocede.
- **El micelio caza.** *Pleurotus* produce **toxocistos**: células con gotitas tóxicas que
  **paralizan al nematodo en un par de minutos**; después las hifas lo penetran por la boca y lo
  digieren. Es el evento más espectacular que puede tener este mundo, y es la razón biológica de
  toda la economía de nitrógeno.
- Los **ácaros** transportan esporas (dispersión).

**La cadena causal del mundo entero:**

> cazar nematodos → nitrógeno → fructificar → esporas → el próximo tronco

### Quién tiene nombre

Igual que en la célula la membrana no es un agente sino el cuerpo del mundo, acá **la red no es un
agente: es el mundo**. Los ~18 visibles con jaula y nombre son la **fauna del suelo**; las
**puntas** son partículas (como los cuantos de ATP); las **colonias** y los **sustratos** viven en
el censo invisible y hablan en el log.

---

## 7. La fructificación: el clímax

Necesita **las tres cosas a la vez**: reservas de nitrógeno + **golpe de frío** + humedad. Los
cultivadores literalmente dan choque térmico para inducirla, así que el disparador cruza los tres
sistemas del ecosistema.

Cuatro etapas visualmente distintas (mismo tipo de arco que le dimos a la mitosis):

1. **Primordios** — bultitos que asoman en el flanco
2. **Expansión** — se abren en repisas escalonadas
3. **Esporulación** — una **bruma blanca** que cae del sombrero (puntos derivando hacia abajo)
4. **Senescencia** — se ablandan y caen

**Y puede fructificar MAL.** Con CO₂ alto y poca luz, *Pleurotus* da formas deformes tipo **asta de
ciervo**: pie largo, sin sombrero. Es un estado de fallo real y hermoso — **muy pocos mundos pueden
fallar de forma bonita**, y este debería poder.

### `src/sim/fruiting.js` (módulo puro nuevo)

```js
export function createFruiting(cfg)
export function updateFruiting(fr, cfg, dt, ctx)
//  ctx = { nitrogen, temperature, moisture, co2, light }
//  → etapas 'dormant' | 'primordia' | 'expanding' | 'sporulating' | 'senescent'
export function fruitingState(fr)   // { stage, progress, deformed }
```

---

## 8. Renovación: el mundo generacional

Al llegar el tronco a **clase de descomposición 5** (montículo con la silueta apenas), **cae un
tronco nuevo** — un evento fuerte, con su golpe sonoro — y lo colonizan **las esporas que este
mundo soltó**, que quedaron guardadas en el borde.

Es lo que lo hace único entre los cinco mundos: los otros **hacen un bucle**; este **hereda**. Si la
colonia nunca llegó a fructificar, el tronco nuevo arranca solo con lo que llegue de afuera —
y eso es una derrota legible.

---

## 9. Clima, día y descomposición

- **Clima = humedad** (el clima maestro de un hongo no es la luz, es el agua):
  `empapado`, `lluvia`, `niebla`, `rocío`, `secándose`, `seco`, `helada`.
- **Día = ciclo diario de humedad y temperatura** (12 fases). Los hongos crecen **de noche y al
  alba**, cuando hay rocío; al mediodía seco la red se detiene. Es el mismo mecanismo de fases del
  bosque, con otro contenido.
- **Estación (largo) = clase de descomposición 1→5**, avanzada por **consumo**, no por reloj.

Las tres se encuentran en el disparador de fructificación: **frío + mojado + reservas**.

---

## 10. Cómo se ve

Mismo lenguaje "matrix" del proyecto: líneas finas + puntos por vértice, translúcido en capas.

- **La red**: líneas finas blanquecinas; el grosor del cordón = el `width` de la arista. Los
  cordones se leen como autopistas gruesas; el frente de avance, como un abanico difuso (que es
  exactamente cómo se ve al levantar una corteza).
- **Las puntas**: puntos brillantes que avanzan — el latido visual del mundo.
- **El tronco**: cápsula alargada de wireframe + punteado, que **cambia de color y de forma** con la
  clase de descomposición.
- **Líneas de demarcación**: negras, densas, donde dos colonias se tocan.
- **Lente macro**: `dofFocus` corto y `dofAperture` alto → fondo disuelto.
- **Paleta**: la de siempre (`PALETTE`), con la red en blancos/cian y los hongos en ámbar/crema.

---

## 11. Sonido

Subterráneo y húmedo: drone muy grave, goteo, madera que cruje, chasquidos secos para las esporas,
y un **tic seco** cuando se paraliza un nematodo.

Y hay un regalo científico: **las redes fúngicas emiten trenes de picos eléctricos** (el trabajo de
Adamatzky sobre *spiking* en hongos). El enjambre Kuramoto —luciérnagas en el bosque, ATP en la
célula— acá tiene lectura literal: **picos que se propagan por los cordones**, no por el aire.

---

## 12. Events log

```
Una punta de Pleurotus alcanza la albura.
Trametes toma el frente húmedo; avanza más rápido.
Dos hifas se reconocen y se funden.
Un nematodo roza el toxocisto y se detiene.
La hifa entra por la boca del nematodo.
Un colémbolo pastorea el frente de avance.
El cordón hacia el duramen se engrosa.
Pleurotus y Trametes se tocan; se levanta la línea negra.
La rama estéril se reabsorbe.
Baja la temperatura sobre la madera mojada.
Asoman los primeros primordios en el flanco.
El sombrero se abre y suelta la bruma de esporas.
La corteza se desprende y cae.
Cae un tronco nuevo sobre la hojarasca.
```

---

## 13. Encaje técnico

### Se reutiliza (mucho — gracias al mundo célula)

| Pieza | Uso |
|---|---|
| `render/stage.js` | Escenario completo |
| `engine/points.js` `createLineBuffer` | **La red entera**, redibujada por frame |
| `engine/points.js` `createPointCloud` | Puntas, esporas, picos eléctricos |
| `engine/points.js` `createDraw` | Tronco, hojarasca, musgo (estático) |
| `engine/agents3d.js` | Jaulas de la fauna |
| `engine/trails.js` | Estelas de la fauna (la red NO usa estelas: ella *es* la estela) |
| `engine/haze.js` | Bruma húmeda del suelo |
| `sim/wander.js` | Fauna del suelo |
| `ecosystem.js` `setProfile` | ✅ **ya parametrizado por la célula** → solo agregar `FUNGUS_PROFILE` |
| `narrator.js` léxico | ✅ **ya parametrizado** → agregar `FUNGUS_LEXICON` |
| `agents.js` censo | ✅ **ya parametrizado** → agregar `FUNGUS_CENSUS` |

### Es nuevo

- `sim/mycelium.js` — el grafo que crece (**toda la dificultad está acá**)
- `sim/decay.js` — sustrato consumible
- `sim/fruiting.js` — máquina de estados de la fructificación
- `worlds/fungus.js` — el builder

### El riesgo real

**Rendimiento del grafo.** Topes duros de nodos/aristas/puntas, pools con lista de libres, y poda
agresiva. Objetivo: ≤ 6000 segmentos dibujados. Y el `count` fijo de agentes del motor **no aplica
a las puntas** — hay que resolverlo explícitamente con un pool propio, no forzando `fireflies.count`.

---

## 14. Qué NO hacer

- **No** simular difusión real ni ecuaciones de transporte: cinemática con aspecto correcto.
- **No** dejar crecer el grafo sin tope "a ver qué pasa": revienta el navegador.
- **No** hacer un fractal bonito que ignore la comida — si la red no responde al recurso, el mundo
  entero pierde el sentido.
- **No** convertir la red en agentes del censo: es terreno, como la membrana de la célula.
- **No** tocar `weather.js` del bosque (acuerdo vigente con la sesión de ciudad).

---

## 15. Olas de implementación

Mismo reparto por **propiedad de archivo** que funcionó en la célula.

### Ola A — módulos puros, en PARALELO (archivos nuevos disjuntos)

| Agente | Entrega |
|---|---|
| A1 | `sim/mycelium.js` + tests (el grande: crecer, ramificar, fusionar, engrosar, podar) |
| A2 | `sim/decay.js` + tests (recursos, consumo, clase de descomposición) |
| A3 | `sim/fruiting.js` + tests (máquina de estados + estado deforme) |

### Ola B — parametrizaciones, SECUENCIAL (archivos compartidos)

`FUNGUS_CENSUS` (`agents.js`), `FUNGUS_LEXICON` (`narrator.js`), `FUNGUS_PROFILE` (`ecosystem.js`),
traducciones (`i18n.js`), entrada en `registry.js`. Todo **aditivo**, siguiendo el patrón exacto
que dejó la célula.

### Ola C — el mundo, SECUENCIAL

`worlds/fungus.js`: tronco y hojarasca, render de la red, puntas, fauna, medios de viaje.

### Ola D — el drama, SECUENCIAL

Trampas de nematodos, pastoreo de colémbolos, líneas de demarcación, fructificación (4 etapas +
deforme), esporas, degradación visible del tronco y **caída del tronco nuevo**.

### Reglas para todos los agentes

1. **TDD en lo puro**: test primero, verlo fallar, implementar.
2. `npx vitest run --exclude '**/.claude/**'` verde al terminar.
3. Comentarios y nombres **en español**.
4. **No** commitear ni pushear: lo hace la sesión coordinadora.

---

## 16. Preguntas abiertas

1. **¿Un tercer competidor de podredumbre parda?** Daría el agrietado en cubos (visualmente
   inconfundible) y un triángulo estratégico en vez de un duelo. Cuesta poco; suma bastante.
2. **¿*Panellus stipticus* como personaje menor?** Es de los que **brillan en la oscuridad** (el
   *foxfire*), y le daría al mundo algo que mirar de noche. Ojo: *Pleurotus ostreatus* **no** es
   luminiscente, así que ese papel necesita otro actor.
3. **¿La micorriza (raíz viva) entra en la v1 o después?** Es un ingreso constante que suaviza la
   economía; puede quedar para una segunda capa.
