# Árboles que crecen — mapa técnico (hojas, flores, ramas nuevas, estaciones)

**Fecha:** 2026-08-11
**Método:** ingeniería inversa de `alikim.com/_lush/tree` (4 presets reales descargados: `sakura.txt`,
`apple.txt`, `birch.txt`, `blossom_cactus.txt`, vía `presets/manifest.txt`) + lectura de nuestro
`src/render/scene.js` (función `branch()`/`tube()`, líneas 623-758) + referencia de hojas cayendo
(freefrontend, CodePen `ceramicSoda/xxQJqVv`).
**No copiamos código de alikim.com**: extraemos algoritmo y parámetros (hechos), la implementación
es propia y en nuestro estilo (líneas/puntos, sin texturas ni GLB).

---

## 0. Resumen ejecutivo

`lush` **no usa L-systems** (no hay reescritura de gramática de cadenas). Usa **recursión
paramétrica por niveles**, la misma familia que nuestro `branch()` actual, pero con dos añadidos
que a nosotros nos faltan y que son exactamente lo que necesitamos:

1. **Una capa secundaria de instancias** (`petals`) separada del tronco/ramas, pegada a los
   vértices del "path" con su propia orientación — así se ponen hojas/flores/frutos sin tocar la
   geometría de la madera.
2. **Un sistema de animación por curva de apertura** (`getBloomDirs` / `setPetal` + tweens) que
   escala y rota cada pétalo desde "cerrado" (escala 0.2, plegado) hasta "abierto" (escala 1.0,
   vertical) con arranque escalonado al azar por grupos — es el modelo de floración que buscamos.

**Recomendación:** no migrar a L-systems ni a space colonization. Extender nuestro `branch()`
recursivo actual con (a) una lista de "brotes" (nodos donde puede salir una hoja/flor/rama nueva),
(b) una curva de crecimiento 0→1 por brote, (c) una capa de `Points`/quads instanciados para
hojas y flores que lee esa curva. Ver §2 y §3.

---

## 1. Cómo genera árboles `lush` (evidencia de código)

### 1.1 Estructura de datos: niveles, no gramática

Cada árbol tiene un `trunk_` y N niveles de rama `br_0 … br_{max_lev-1}` (`max_lev` = 3 ó 4 en los
4 presets estudiados). Cada nivel tiene su **propio bloque de parámetros**, todos con el mismo
significado en todos los niveles:

| Parámetro | Significado | Ejemplo (sakura) |
|---|---|---|
| `w` | radio inicial del tubo en ese nivel | `br_0w: 0.02` |
| `h` | longitud total de la rama en ese nivel | `br_0h: 2` |
| `min` | longitud mínima de segmento → `segmentos = h / min` | `br_0min: 0.2` → 10 segm. |
| `num` | lados del polígono del tubo (facetas radiales) | `br_0num: 25` |
| `fi` | **azimut**: 2 rangos `[fiA_min,fiA_max, fiB_min,fiB_max]` en grados, se elige uno al 50% (permite reparto bimodal, p. ej. ramas "a los lados" y no "al frente") | `'0,360,0,360'` = uniforme |
| `ybias` | **inclinación** respecto al padre, rango en grados | `br_1ybias: '40,60'` |
| `tot` | **cuántas ramas hijas** nacen en este nivel (por rama padre) | `br_2tot: 1000` (sakura, nivel de flor) |
| `seg` | qué tramo del padre puede llevar hijos (offset desde inicio/fin) | `'1,0'` = todo menos el primer segmento |
| `grv` | gravedad: curva la rama hacia abajo N grados | ramas jóvenes 0°, troncos viejos >0° |
| `rel_fi` | si el azimut del hijo seguí­a la rotación XZ del padre (da la sensación de "abanico" coherente) | `true` en niveles ≥1 |

Cada rama es un **polyline** (`genPoly`) que se genera igual que la nuestra: arranca en una
posición y dirección, y en cada segmento la dirección se desvía al azar dentro de `fi`/`ybias` +
un sesgo de gravedad — **recursión con ángulo/ratio aleatorios, no una gramática L-system**.
Luego esa polyline se "solidifica" (`solidify()`) barriendo un perfil (`CylinderGeometry` u otro)
a lo largo del path con normales calculadas — el mismo rol que cumple nuestro `tube()`.

**Conclusión clave:** su recursión y la nuestra son la misma técnica (branch-and-taper con
ángulos/longitudes aleatorios por nivel). La diferencia real está en lo que hacen *además* del
tronco: la capa de hojas/flores.

### 1.2 Cómo ponen hojas: "abusar" del último nivel como geometría plana

**Birch (abedul)** y **manzano** no tienen una capa de hoja separada: la hoja ES el último nivel
de "rama". `br_3` en birch tiene `tot: 12000` y en su `code` (el bloque que define la malla de
ese nivel) usan `LeafGeom(...)` — un generador de malla de hoja plana con nervadura, no un
`CylinderGeometry` — escalado muy pequeño (`0.05`) y trasladado para que su base coincida con el
punto de inserción. O sea: **una hoja es literalmente una "micro-rama" de longitud casi 0**, y
sale con la misma lógica de `fi`/`ybias`/`tot` que cualquier otra ramita. Cada hoja tiene su
propia rotación (orientada por el ángulo de brote, no al azar total) y un degradé de color por
posición en el tallo.

Parámetros reales:

| Especie | niveles (`max_lev`) | tot hojas (nivel final) | `ybias` hoja | notas |
|---|---|---|---|---|
| Birch | 4 | **12 000** | `90,90` (perpendicular a la ramita) | textura de corteza propia (`bark/birch.png`) |
| Apple | 4 | **6000** hojas (`br_2`) + **10** frutos (`br_3`, esferas r=0.66) | `70,70` | frutos = nivel aparte con `tot` bajo y `SphereGeometry` roja-naranja |

### 1.3 Cómo ponen flores: capa `petals` aparte, pegada a la malla ya sólida

**Sakura** y **cactus en flor** sí usan una capa separada llamada `petals`, configurada en el
`code` del último nivel junto al `mesh` de ese nivel:

```
mesh  = { geo: CircleGeometry(...) , ... }   // "receptáculo"/base de la flor
petals = {
  geo: PetalGeom({ name, bisecDist, makeZ }).geo,   // malla de pétalo curvo (perfil paramétrico)
  usenormals: true,     // orienta cada pétalo según la normal del receptáculo
  ybias: [0,0],         // apertura inicial del pétalo (ángulo)
  offset: [0,0, dropPct] // dropPct = % de vértices que se descartan al azar → densidad
  shineThrough: 0.7,     // "translucidez" de doble cara (backlight falso)
  mat.map: texture('petal/*.png'),
}
```

Mecanismo: `solidify()` primero calcula los vértices únicos de la malla base (`getGeoData`, con
deduplicado por distancia) y por cada vértice coloca **una instancia de pétalo** orientada por la
normal de ese vértice + un ángulo `ybias` de apertura + jitter. Es un `InstancedMesh`, no meshes
individuales. La densidad se controla descartando vértices al azar (`offset[2]`, p. ej. cactus
descarta el 80%).

Parámetros reales (sakura, nivel de flor `br_3`, `tot: 2000` receptáculos):
- receptáculo: `CircleGeometry(radio 1, 5 lados)` escala `height:5`, color rosa-marrón (`120,40,60`).
- pétalo: `PetalGeom({bisecDist:0.05, makeZ: (x,y)=>-0.01x²+0.001y²})` — perfil curvo hacia
  adentro, escala `0.0005`, textura `textures/petals/cherry.png`, `emissive:0x444444`.

### 1.4 La animación de floración (esto es lo importante para "crecer")

`sakura.br_3anim` implementa exactamente lo que pide el usuario — una **curva de apertura por
pétalo, escalonada en el tiempo**:

- Estado inicial: todos los pétalos con `scale = 0.2` y rotación plegada (`th=0` →
  `quaternFromETh(dir, -90°)`, o sea "acostado" contra el receptáculo).
- Se agrupan los pétalos de 5 en 5 (`G.flen = G.plen / 5`, ~5 pétalos por flor).
- Cada grupo-flor arranca en un instante aleatorio (`start: 1000 + 2000·rand()` ms) y tarda
  `duration: 500` ms en abrir (vía librería `Tween` propia, con `ease`).
- Mientras el tween corre, por cada frame: `th` va de 0→1, y con eso:
  - **rotación**: `ang = th0 · (1 - th)` — pasa de "plegado -90°" a "0° = vertical/abierto".
  - **escala**: `sc = 0.2 + 0.8·th` — crece de 20% a 100% de tamaño.
- Cuando todos los tweens terminan, la animación se autodetiene.

Esto es **exactamente** el patrón que necesitamos generalizar a: brote de hoja (escala 0→1),
apertura de flor (escala + rotación 0→1), y —por extensión nuestra, ellos no lo hacen— extensión
de una rama nueva (longitud 0→1 a lo largo del path).

### 1.5 Cactus en flor — variante decorativa

Mismo mecanismo que sakura pero con `PetalGeom({name:'lotus', ...})`, receptáculo
`IcosahedronGeometry` amarillo, y **sin animación de apertura** (`br_2anim` vacío) — la flor nace
ya abierta. Confirma que la curva de apertura es opcional por especie/nivel, no estructural.

---

## 2. L-system vs space colonization vs recursión paramétrica (la nuestra + la de lush)

| Criterio | L-system (gramática) | Space colonization (atractores) | Recursión paramétrica (nuestra + lush) |
|---|---|---|---|
| Qué modela | reglas de reescritura de símbolos → interpretación tipo tortuga | crecimiento hacia "comida de luz" repartida en el espacio, muy realista para dosel/copa | recursión directa: cada rama decide hijos por ángulo/longitud/probabilidad, con parámetros por nivel de profundidad |
| Determinismo | reglas fijas, mismo string → mismo árbol | depende de la nube de atractores (cara costosa de generar bien) | depende de la semilla RNG, barato |
| **Animar crecimiento progresivo** | posible pero natural para "generaciones" discretas (paso de gramática = paso de tiempo) — no da extensión *continua* de una rama | naturalmente incremental (se añaden segmentos mientras quedan atractores vivos) pero la lógica de poda/atracción es cara de recalcular cada frame | **trivial**: cada rama ya es una polyline de N puntos — basta con revelar/alargar esa polyline con un parámetro `growth ∈ [0,1]` (interpolar hasta qué punto del spine se dibuja) |
| Coste de implementación | alto (parser/intérprete de gramática) | alto (estructura espacial + poda de atractores, red de vecinos) | **bajo — ya lo tenemos**, solo hay que separar "generar geometría final" de "cuánto de ella mostrar" |
| Encaja con nuestro código actual | no — reemplazaría `branch()` entero | no — reemplazaría `branch()` entero | sí — `branch()`/`tube()` ya son recursión paramétrica; solo se extiende |
| Uso recomendado histórico | árboles decorativos fijos, fractales | árboles fotorrealistas de forma orgánica de copa (juegos AAA, VFX) | procedural en tiempo real barato, control fino de animación |

**Recomendación: quedarnos con recursión paramétrica** (nuestro `branch()`, con el añadido de
niveles con parámetros propios al estilo `lush` si queremos más variedad de especie). Es la única
opción que no exige reescribir el generador de árboles, y es la que mejor soporta la animación de
crecimiento porque **el spine ya es una lista ordenada de puntos**: crecer = revelar más puntos.

---

## 3. Diseño concreto para nuestro motor

### 3.1 Estructura de datos: árbol como grafo de "brotes" con edad

Hoy `branch()` genera geometría y la vuelca directo a `treePos`/`treeIdx` (arrays planos, se
pierde la estructura). Para animar, hace falta **retener el árbol como datos** antes de volcarlo
a buffers, y volver a volcar cada vez que cambia el crecimiento (o, mejor, actualizar solo los
atributos de posición/escala en el buffer existente — más barato que reconstruir todo).

```js
// Nodo de rama: se genera una sola vez con el RNG (determinista por semilla del árbol),
// el crecimiento NO cambia su geometría, solo cuánto de ella se dibuja.
{
  spine: [Vector3, ...],   // igual que hoy (SEG=4 tramos por rama)
  radius: [r0, r1],
  depth, parentIdx,
  birthT: 0.0..1.0,        // instante (en "tiempo de temporada") en que empieza a crecer
  growDur: 0.15,           // cuánto tarda en llegar a longitud completa
  buds: [                  // puntos de brote sobre el spine → hoja/flor/rama nueva
    { t: 0.4, kind: 'leaf'|'flower'|'branch', birthT, growDur, ... }
  ],
}
```

`tree.growth` (0..1, o mejor un reloj de temporada, ver §4) determina, para cada rama:
`localGrowth = clamp((growth - birthT) / growDur, 0, 1)`.

### 3.2 Animar la EXTENSIÓN de una rama (crecimiento progresivo)

Como el spine ya es una polyline con `n` puntos, "crecer" = no dibujar el tubo completo sino
solo hasta `floor(localGrowth * (n-1))` puntos, con el último punto interpolado (`lerp` entre el
punto `k` y `k+1` según el resto fraccional) para que la punta avance suave y no a saltos de
segmento. El radio en la punta se ahúsa igual que hoy (`rEnd` en `tube()`), así la rama que crece
siempre termina en una punta fina — no hace falta más truco.

Esto se traduce en: en vez de pasar `spine` completo a `tube()`, pasarle
`spine.slice(0, visibleCount + 1)` con el último punto reemplazado por el interpolado. Barato:
recomputar solo esa rama (no el árbol entero) cuando su `localGrowth` cambia de bucket
(cuantizar a p. ej. 20 pasos por rama evita recomputar cada frame).

**Ramas nuevas** (el pedido "que salgan ramas nuevas"): un `bud` de tipo `'branch'` es
simplemente una invocación diferida de `branch(from, dir, len, radius, depth+1, ...)` — la misma
función que ya existe — pero con su propio `birthT`/`growDur`, y que solo se ejecuta (solo entra
al árbol vivo) cuando `growth >= bud.birthT`. El árbol pasa de "3 niveles de profundidad" a
"3 niveles + N brotes durmientes con profundidad 4" que despiertan con el ciclo estacional.

### 3.3 Hojas — brotes tipo `Points`/quad, no malla con textura

Nuestro proyecto no usa texturas ni GLB (ver `2026-08-10-tecnica-render-murmur.md`): todo es
líneas/puntos. Para hojas, la opción coherente con el estilo es:

- **`Points`** con el shader propio que ya tenemos (tamaño-mundo + DOF falso + balanceo, igual
  que las flores/pasto actuales) — una hoja = 1 punto verde, animado con el mismo sway que las
  flores. Barato, encaja 100% con la estética.
- Alternativa con más lectura de forma: **quad de 2 triángulos por hoja** (como hace `lush` con
  `LeafGeom`) pero sin textura — solo color plano o gradiente por vértice (igual que hacemos con
  el pasto: base oscura, punta clara). Da silueta de hoja real en vez de un punto redondo, a
  cambio de más vértices.
- Recomendación: **empezar con `Points`** (coherencia de estilo + presupuesto, ver §5) y si hace
  falta más lectura de "hoja" cerca de cámara, subir a quad solo en LOD cercano.

Posición/orientación de cada hoja: igual que `lush` — se elige un punto `t` a lo largo del spine
de una ramita fina (nivel más profundo), con una normal aproximada (perpendicular al spine +
jitter acimutal aleatorio), y escala 0→1 según su propio `localGrowth`.

### 3.4 Flores — igual que hoy (cluster de esferas/puntos) + curva de apertura

Ya tenemos `flower()` con racimo de sub-cabezas en `Points` (ver `lenguaje-visual.md` §3). Para
"bloom" no hace falta agregar post-proceso de bloom (el proyecto **explícitamente no usa bloom**,
el brillo viene de blending aditivo — confirmado en `tecnica-render-murmur.md` §4/§10). Lo que sí
copiamos de `lush` es la **curva de apertura**:

```js
// por cada cabeza de flor (o cada sub-cabeza del racimo):
const th = clamp((growth - bud.birthT) / bud.growDur, 0, 1)
pointSize   = baseSize * (0.2 + 0.8 * th)     // igual proporción que sakura
petalTilt   = openAngle * th                   // si usamos pétalos-línea en vez de solo punto
colorAlpha  = smoothstep(0, 0.15, th)          // aparece con fade, no de golpe
```

Con blending aditivo + `PointsMaterial` de tamaño-mundo (ya existente), una flor "abriendo" es
literalmente el punto creciendo de tamaño 0.2→1 con un `easeOutCubic` — mismo efecto visual que
`lush`, cero shaders nuevos.

### 3.5 Caída de hojas (otoño)

Patrón general de la referencia (`freefrontend` / CodePen `ceramicSoda/xxQJqVv`,
"Interactive 3D Falling Leaves Shader" — `InstancedMesh` + GLSL, sin poder leer el shader fuente
por bloqueo de scraping de CodePen, así que esto es el patrón estándar del género, no una cita
literal de su código):

- Cada hoja-instancia tiene una **fase/semilla propia** (`hash(i)`), igual que ya hacemos con el
  balanceo de flores (`ph` en `tecnica-render-murmur.md` §4).
- Estado por hoja: `attached` (sigue la rama) → `falling` (movimiento propio: caída + oscilación
  lateral tipo hoja real, no caída recta) → `settled`/`removed` (se posa o desaparece).
- Disparo de caída: no por raycasting (no aplica a nuestro caso sin mouse-hover en árboles), sino
  por **temporada**: en otoño cada hoja tiene una probabilidad/instante de caída (`fallT`,
  distribuido en la ventana de la estación) — igual mecanismo que `birthT` para brotar, pero
  a la inversa.
- Movimiento de caída barato: `pos.y -= gravity*dt`, más `pos.x/z += sin/cos(t*freq + phase)*amplitude`
  para el vaivén — no hace falta física real, con 2-3 términos senoidales por eje ya lee como
  "hoja cayendo" (igual espíritu que el balanceo GLSL que ya tenemos).
- Reciclado: una vez la hoja toca el suelo (o pasan N segundos), su punto puede: (a) quedarse fijo
  en el suelo como "mancha" de hoja caída (barato, suma al lecho de otoño), o (b) reciclarse para
  la próxima hoja que brote — igual que ya reciclamos partículas de nieve (`SNOW_N`, líneas
  1332+).

Implementación: **una sola `Points` geometry por árbol (o global) para "hojas en vuelo"**, con
atributos por-instancia `phase`, `fallStart`, `fallDur`; el shader/JS mueve solo las que están en
estado `falling`. No hace falta `InstancedMesh` con matrices completas si seguimos usando el
patrón `Points`+shader que ya domina el proyecto — más barato que instanced mesh con geometría de
hoja real.

---

## 4. Ligado a estaciones

Hoy no existe un reloj de estación en el código (`grep` no encontró ninguno); sí existe un ciclo
de clima/nieve (`weatherMinSec`/`weatherMaxSec` en `config.js`, acumulación de nieve dinámica en
`scene.js`). Para crecimiento de árboles conviene un **reloj propio, lento** (mucho más largo que
el ciclo de clima), p. ej. `seasonT ∈ [0,1)` que da una vuelta completa cada N minutos reales, y
una función `season(seasonT) → {spring, summer, autumn, winter}` por interpolación continua (no
saltos discretos, para que el crecimiento se vea fluido).

| Estación | Ramas | Hojas | Flores | Parámetros que se mueven |
|---|---|---|---|---|
| **Primavera** | brotes `bud.kind==='branch'` con `birthT` dentro de esta ventana despiertan y crecen (§3.2) | brotan desde 0: `leafGrowth: 0→1` en toda la copa | brotan y abren: `flowerGrowth: 0→1` con la curva de apertura (§3.4) | `leafDensity: 0→1`, `flowerDensity: 0→1`, color hoja verde muy claro/amarillento (brote tierno) |
| **Verano** | ramas jóvenes terminan de extenderse (`localGrowth→1`) | hoja plena: `leafGrowth=1`, tamaño máximo | flores en su pico, algunas empiezan a caer pétalos (opcional) | `leafDensity=1`, verde saturado (igual paleta que el pasto de verano) |
| **Otoño** | sin ramas nuevas | `leafColor` interpola verde→ámbar/rojo (gradiente por vértice, mismo mecanismo que ya usamos en pasto/tallo); luego cada hoja dispara su `fallT` (§3.5) | flores ya caídas/marchitas (`flowerDensity→0`, o se convierten en fruto si la especie lo tiene, ver `apple.br_3` en §1.2) | `leafColor` (gradiente temporal), `leafDensity: 1→0` según van cayendo |
| **Invierno** | ramas peladas — **exactamente el estado actual del proyecto** (`branch()` sin hojas/flores) | `leafDensity=0` | `flowerDensity=0` | nieve sobre ramas ya existe (`capPos`, snow cap sampling en línea 740) — nada nuevo que hacer aquí, es el punto de partida |

**Nota de diseño:** conviene generar TODOS los brotes (hoja/flor/rama) de una vez al construir el
árbol (con su `birthT`/`kind`/`fallT` fijados por RNG determinista), y que el reloj de estación
solo mueva un escalar de "cuánto mostrar" — igual que hoy el snow-level mueve un escalar global.
Así no hay que regenerar geometría por estación, solo reevaluar atributos (posición interpolada
del spine, escala/alpha de hoja-punto) — barato y determinista con la semilla del árbol.

---

## 5. Presupuesto de rendimiento

Contexto actual (de `tecnica-render-murmur.md` + inspección propia): ~80-112k hojas de pasto en
una sola geometría de `LineSegments`, varios `Points` (flores, estelas, neblina, nieve ~5000,
polvo de borde ~8500), pocos árboles (3-5 en pie + 1-2 troncos caídos) como mallas tubulares +
wireframe. Objetivo: 60 fps manteniendo ese pasto.

Con **3-5 árboles** en escena (no un bosque cerrado — así lo pide el lenguaje visual, "hitos
verticales dispersos"), el presupuesto por árbol puede ser generoso sin comprometer el frame:

| Elemento | Presupuesto por árbol | Total (5 árboles) | Justificación |
|---|---|---|---|
| Hojas (`Points`, 1 punto = 1 hoja) | 800–1500 | 4000–7500 | Muy por debajo de las 80k del pasto; incluso 5x ese número seguiría siendo barato porque `Points` con shader propio ya está optimizado en el proyecto (una sola draw call por geometría si se agrupan todos los árboles en un solo buffer, igual que el pasto) |
| Flores por árbol (si la especie florece) | 150–400 cabezas (racimos ya multiplican ×2-4 sub-cabezas internamente) | 750–2000 | Mismo orden que las flores de suelo que ya existen |
| Hojas cayendo simultáneas (estado `falling`) | 50–150 activas a la vez (pool reciclado, no todas las hojas del árbol caen a la vez) | 250–750 | Es un subconjunto activo de las hojas ya contadas arriba, no un array nuevo |
| Ramas nuevas animadas por temporada | 5–15 brotes de rama durmientes por árbol | 25–75 | Geometría ya la genera `branch()`; solo cambia cuándo se revela |
| Vértices extra en malla tronco/rama (sin cambio) | igual que hoy | igual que hoy | No tocamos `tube()`, solo qué porción del spine se dibuja |

**Regla práctica:** agrupar TODAS las hojas de TODOS los árboles en **una sola `BufferGeometry`
de `Points`** (igual que ya se hace con `capPos`/nieve y con las flores), actualizando solo los
atributos (`position`, `size`/`scale`, `color.a`) por frame — nunca crear/destruir objetos
`Points` por hoja. Esto mantiene una única draw call para toda la "foliage" del mundo,
independientemente de cuántos árboles haya. Con eso, 5-10k hojas + 1-2k flores en árboles es
ruido comparado con las 80-112k líneas de pasto que ya se sostienen a 60 fps.

**Riesgo real de rendimiento:** no es el conteo de hojas, es **recomputar `tube()` (relleno +
`WireframeGeometry`) cada frame** para animar la extensión de rama — `WireframeGeometry` no es
barata de regenerar. Mitigación: cuantizar `localGrowth` por rama a ~20 pasos (ya mencionado en
§3.2) y solo reconstruir la malla de esa rama cuando cruza un umbral, no cada frame; con un reloj
de estación que dura minutos, esto ocurre con frecuencia bajísima.

---

## 6. Encaje con la estética "matrix" del proyecto

Todo lo diseñado arriba usa exclusivamamente las dos primitivas que ya definen el look del mundo
(`tecnica-render-murmur.md` §0): `LineSegments`/`WireframeGeometry` para madera, `Points` con
shader propio para hojas/flores. No se introduce:

- Ningún GLB ni textura de hoja/pétalo (a diferencia de `lush`, que sí usa PNGs de pétalo/corteza)
  — nuestras hojas y flores siguen siendo puntos/color-por-vértice, coherente con "sin texturas,
  todo procedural".
- Ningún post-proceso de bloom — el "florecimiento" se lee por escala+alpha animados sobre el
  mismo `PointsMaterial` aditivo que ya usan flores/estelas/neblina, no por un pase de glow nuevo.
- Ninguna malla nueva de "hoja realista" — si en algún momento se quiere subir de `Points` a quad
  (§3.3), el quad se pinta con **color por vértice** (igual que el pasto: base oscura, punta
  clara) en vez de textura, manteniendo "fino, gráfico, ligero" como firma visual.

El único elemento verdaderamente nuevo respecto al vocabulario actual es la **rama que se
extiende** (spine parcial + punta interpolada, §3.2): visualmente es el mismo tubo+wireframe
ahusado de siempre, solo que se dibuja más corto y va creciendo — no rompe el lenguaje, lo
anima.

---

## 7. Resumen de cambios sugeridos en `scene.js` (para una futura sesión de implementación)

Esto es solo el mapa, no se tocó código. Como referencia para cuando se implemente:

1. Refactor de `branch()`: que devuelva/registre la estructura del árbol (spine, buds, birthT)
   en vez de volcar directo a `treePos`/`treeIdx` — hoy eso pasa en líneas 672-708.
2. Nueva función `growTree(treeData, growth)` que, dado el reloj de estación, decide qué ramas
   están despiertas y cuánto spine de cada una dibujar, y llama a `tube()` solo con la porción
   visible.
3. Nueva geometría global `foliagePoints` (una por escena, no por árbol) para hojas — con
   atributos por-instancia `treeId`(opcional), `basePos`, `phase`, `birthT`, `fallT`.
4. Reutilizar `flower()` existente para las flores de copa, parametrizando el tamaño con la curva
   de apertura de §3.4 en vez de tamaño fijo.
5. Reloj de estación nuevo en `config.js`/`sim` (no existe hoy) que alimente `growTree` y el
   material de color de hoja (verde→ámbar) y las probabilidades de caída.
