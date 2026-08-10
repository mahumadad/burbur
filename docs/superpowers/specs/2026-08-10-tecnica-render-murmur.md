# Técnica de render de murmur — ingeniería inversa

**Fecha:** 2026-08-10
**Método:** análisis del bundle cliente `assets/script-Daaf7S9n.js` (754 KB) + inspección WebGL en vivo.
**Uso:** extraemos **técnica y parámetros** (hechos) para reimplementar. No copiamos su código.

---

## 0. El hallazgo que lo explica todo

**No hay mallas ni texturas. El mundo entero son LÍNEAS y PUNTOS.**

No existe ningún `.glb` del mundo (los únicos modelos son del producto físico para la landing).
Pasto, flores, árboles, rocas, neblina y agentes se generan **proceduralmente en código** y se
dibujan con solo dos primitivas:

| Primitiva | Qué construye |
|---|---|
| `LineSegments` con **color por vértice** | pasto, tallos, ramas, jaulas de agentes, calles |
| `Points` con **shader propio** | cabezas de flor, estelas, neblina, polvo, "criaturas" |

De ahí viene el look: fino, gráfico, ligero. Y explica el rendimiento con 80.000 hojas de pasto.

---

## 1. Configuración maestra (valores reales)

```js
{
  speed: 1.8,        // velocidad de agentes
  trailSize: 3.4,    // tamaño del punto de estela
  visibleLen: 34,    // largo visible de la estela
  dof: 0.2,          // apertura del desenfoque
  count: 15,         // agentes visibles simultáneos
  fisheye: 0.6,      // → fov = 50 + 0.6*72 = 93°  (gran angular)
  chroma: 0.25,      // aberración cromática
  vigSize: 1,        // viñeta
  grass: 1, flowers: 1, streets: 2, towers: 1
}
```

**Cámara:** órbita esférica `{ r: 118, theta: 0.62, phi: 0.92 }`, **fov 93°**.

**Paleta (exacta):**

| Nombre | Hex | | Nombre | Hex |
|---|---|---|---|---|
| white | `#EEF2FF` | | orange | `#FF7A14` |
| cyan | `#10E6CF` | | cyanSat | `#35E6D2` |
| pink | `#FF5FB0` | | yellow | `#FFE21A` |
| magenta | `#FF1F8F` | | blue | `#2B48FF` |
| cyanEye | `#16F0D8` | | bond | `#FFB15A` |

Nótese: **ningún verde en la paleta de agentes**. El verde es solo del pasto; los agentes
siempre contrastan.

---

## 2. Pasto — la técnica clave

**80.000 hojas** en bosque, **46.000** en ciudad. Cada hoja = **4 vértices = 2 segmentos de línea**
(no un quad):

```
        tip  (base + lean, base + h)          ← color × 1.15  (brillante)
         ╱
      mid    (base + lean*0.35, base + h*0.62) ← color × 0.85
       │
      base   (x, terrainHeight, z)             ← color × 0.40  (oscuro)
```

- **El gradiente vertical se hace con color por vértice** — no hace falta shader.
- **Distribución:** disco uniforme → `r = R*sqrt(rand())`, `θ = rand()*2π`. (Confirma isla circular.)
- **Altura:** `(2.3 + rand()*2.1) × (0.75 + 0.55·campo)` — un campo de ruido de fertilidad modula
  densidad y altura.
- **Inclinación:** el ángulo viene de **ruido coherente** `noise(x*0.02, z*0.02)*4π` + jitter
  ±0.65 rad. Por eso el pasto se ve **peinado** en corrientes, no aleatorio.
- Se descartan posiciones sobre rocas/calles y fuera de la isla.
- Todo se acumula en **una sola geometría** (no InstancedMesh): un `Float32Array` gigante.

> Nuestro pasto actual (11.000 planos instanciados) es más caro y se ve peor. Cambiar a este
> método es la mejora visual más rentable del proyecto.

---

## 3. Flores

Tallo **curvo** de 2 segmentos + cabeza. **58%** de las veces una sola cabeza; **42%** un
**racimo de 2–4 sub-cabezas**, cada una en su propio tallito:

```
   ●   ●        ← sub-cabezas (Points, tamaño 0.35–0.75 × escala)
    ╲ ╱         ← tallitos (líneas)
     ●          ← nodo superior
     │
     ╱          ← tallo curvo: base → medio → tope
    │
```

- Altura del tallo: `(3 + rand()*3.6) × escala`.
- Desplazamiento lateral: `(0.5 + rand()*1.3) × escala` → el tallo se inclina.
- El punto medio está al **55%** de la altura y **32%** del desplazamiento → curva suave.
- Color: 85% de la paleta del bioma, 15% un color de acento aleatorio.
- Se siembran **en parches** alrededor de rocas/árboles (2–5 parches por elemento,
  10–32 flores por parche), no uniformemente.

---

## 4. Shader de puntos (el corazón del look)

Todos los puntos comparten esta técnica:

```glsl
// Tamaño en unidades de MUNDO, con perspectiva correcta:
gl_PointSize = clamp(hsize * uProj / max(-mv.z, 0.001), 1.0, 64.0);
// uProj = alturaCanvas*dpr / (2*tan(fov/2))

// Recorte circular:
vec2 uv = gl_PointCoord - 0.5;
if (dot(uv,uv) > 0.25) discard;
```

**Balanceo animado** (para flores y vegetación), por punto con fase propia `hphs`:
```glsl
p.x += sin(uT*0.7 + ph)*0.42;
p.z += cos(uT*0.6 + ph*1.7)*0.42;
p.y += sin(uT*1.1 + ph*2.3)*0.16;
vC  *= 0.92 + 0.12*sin(uT*2.0 + ph*5.0);   // parpadeo sutil de color
```

**Profundidad de campo falsa** (esto da el aire onírico):
```glsl
float coc = abs(viewDepth - uFocus);       // círculo de confusión
float worldR = uBase + uAperture * coc;    // el punto CRECE al desenfocarse
gl_PointSize = clamp(worldR*uProj/viewDepth, 1.0, uMax);
vSoft = clamp(coc/(uFocus*0.7), 0.0, 1.0); // y se ablanda el borde
```

> No usan un pase de DOF real: **agrandan y difuminan los puntos fuera de foco**. Es barato y
> es exactamente la sensación de "mirar por un lente".

---

## 5. Neblina volumétrica

Nubes de puntos grandes, **blending aditivo**, muy tenues:

| Mundo | Nº | Color | Alfa |
|---|---|---|---|
| Bosque | 4.200 | `rgb(0.12, 0.35, 1.0)` azul | `(1-r)² × 0.15` |
| Ciudad | 2.400 | `rgb(1.0, 0.52, 0.15)` naranja | `(1-r)² × 0.13` |

Tamaño 2.6–8.8 en unidades de mundo, repartidos por encima del suelo. **Esto es el halo de
color** que envuelve cada mundo (azul frío el bosque, cálido la ciudad).

---

## 6. Agentes — anatomía exacta

Un agente = **jaula wireframe** + **criatura interna** + **decoración**.

**Jaula:** aristas de un sólido (`EdgesGeometry`), líneas gruesas (`linewidth 1.7`):
- Cubo de lado 6 → la jaula cyan
- Octaedro r=3.6 → jaula angular
- Círculo (polígono cerrado de 30–40 lados) → los anillos
- Triángulo (loop de 3 puntos) → las pirámides

**Criatura interna:** pequeñas **esferas de colores** (r ≈ 0.3–0.42) unidas por líneas al centro,
en color `bond #FFB15A` — como un **modelo molecular**. Eso es el glifo rojo/naranja que se ve
dentro de las jaulas.

**Decoración típica** (variante "anillo con tallo"):
- anillo cyan de r=1.55 (40 segmentos)
- línea vertical magenta de y=1 a y=4 ← **el tallo**
- esfera blanca r=0.45 en y=4 ← **la bolita superior**

**Parámetros por agente:** `effR` (radio de efecto), `colR` (colisión), `band`, `glide`
(planea o no), `rollMul` (cuánto rota). Solo **15 agentes** visibles a la vez.

---

## 7. Post-proceso: el "lente"

Un solo pase full-screen que hace **tres cosas a la vez**:

```glsl
vec2 cc = vUv - 0.5;
float rn = length(cc)/0.7071;              // radio normalizado

float k = min(uStrength, 0.62);
float f = mix(1.0 - k, 1.0, rn*rn);        // 1) FISHEYE (barril)

float ca = pow(rn, 2.5) * uChroma * 0.07;  // 2) ABERRACIÓN CROMÁTICA
float r = texture2D(tDiff, 0.5 + cc*(f-ca)).r;   // R hacia adentro
float g = texture2D(tDiff, 0.5 + cc*f     ).g;   // G sin desplazar
float b = texture2D(tDiff, 0.5 + cc*(f+ca)).b;   // B hacia afuera

vec3 col = vec3(r,g,b);
col *= 1.0 - rn*rn*k*0.3;                        // 3) caída de brillo
col *= smoothstep(uVigSize, uVigSize-0.4, rn);   //    + VIÑETA
```

Combinado con **fov 93°**, esto es lo que hace que el mundo se sienta **dentro de un lente** —
justo lo que necesitamos para el device (display redondo + lente de 20 mm).

> Nuestro `framing.js` (viñeta CSS) es la versión pobre de esto. Reemplazarlo por este pase nos
> da fisheye + cromática + viñeta reales, y sirve igual para la vista web y para el export 466×466.

---

## 8. Otros parámetros de mundo

| Constante | Valor | Significado |
|---|---|---|
| Ciudad: semi-lado | 62 | tamaño de la retícula urbana |
| Ciudad: ancho de calle | 13 | separación entre manzanas |
| Ciudad: calles | 1–4 por eje | `streets: 2` de base, aleatorizado |
| Laguna: radio | 64 | disco de agua |
| Laguna: nivel de agua | −3.4 | plano del agua |
| Partículas de borde | 8.500 | polvo en el perímetro de la isla |

---

## 9. Plan de adopción (orden por rentabilidad)

| # | Cambio | Ganancia | Costo |
|---|---|---|---|
| **T1** | **Pasto a LineSegments** (4 vértices, gradiente por vértice, inclinación por ruido coherente), 40–80k hojas | Enorme | Bajo |
| **T2** | **Post-proceso lente** (fisheye + cromática + viñeta) y fov 93° | Enorme | Bajo |
| **T3** | **Shader de puntos** con tamaño-mundo + DOF falso + balanceo | Alto | Bajo |
| **T4** | **Flores** con tallo curvo y racimos | Alto | Bajo |
| **T5** | **Neblina aditiva** de color por mundo | Alto | Muy bajo |
| **T6** | **Agentes**: jaula de aristas + criatura molecular + tallo | Alto | Medio |
| **T7** | **Isla circular** con muestreo `r=R√rand` y polvo de borde | Medio | Medio |
| **T8** | Paleta exacta y "sin verde en agentes" | Medio | Trivial |

**T1 + T2 + T5 + T8 solos** ya acercan muchísimo el resultado, y son todos baratos.

---

## 10. Qué de esto ya tenemos

| Nuestro | Estado |
|---|---|
| Estelas punteadas | ✅ concepto correcto; falta tamaño-mundo y persistencia |
| Dither en rocas | ⚠️ nuestro invento; **ellos no usan dither** — el punteado es *puntos reales* |
| Pasto instanciado | ❌ reemplazar por líneas |
| Viñeta CSS | ❌ reemplazar por el pase de lente |
| Flores tallo+punto | ⚠️ falta curva y racimos |
| Bloom | ⚠️ ellos no usan bloom; el brillo viene del blending aditivo |

**Corrección importante:** nuestro efecto "dithered" fue una interpretación equivocada de lo que
veíamos. Su textura punteada son **nubes de puntos reales en 3D**, no un patrón de trama en el
shader. Eso además explica por qué su punteado tiene profundidad y el nuestro se ve plano.
