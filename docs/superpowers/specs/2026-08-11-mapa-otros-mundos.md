# Mapa de los otros dos mundos: CIUDAD (block) y AGUA (pond)

**Fecha:** 2026-08-11
**Fuente:** `https://murmur.living/assets/script-Daaf7S9n.js` (771 873 bytes), descargado en esta
sesión desde el sitio en vivo y guardado en el scratchpad de esta sesión (no está versionado en
el repo). Mismo hash que citan `2026-08-10-MAPA-COMPLETO-bundle.md` y
`2026-08-10-tecnica-render-murmur.md` → confirma que el bundle no cambió.
**Método:** extracción de texto exacto del bundle (`grep -b`/offsets de byte + recorte de
ventanas) para leer los identificadores minificados **del módulo del mundo** (offset de byte
≈583 000–673 000 del archivo) sin cruzarlos con nombres reciclados de otros módulos (Three.js
interno reutiliza letras como `U`, `be`, `xe`, `Se`, `W`, `Ce` para cosas totalmente distintas
fuera de esa ventana — hay que acotar el rango o se mezclan). No se ejecutó el bundle en ningún
momento, solo se leyó como texto.
**Alcance:** este documento cubre **BLOCK (ciudad)** y **POND (agua)**. PLOT (bosque) ya está
mapeado y mayormente portado — ver `2026-08-10-MAPA-COMPLETO-bundle.md`.

> Convención: cito el nombre de variable/función minificado tal cual aparece en el bundle (`Wt`,
> `Dn`, etc.) seguido de su significado. Todos los valores numéricos y colores son literales
> copiados del código, no estimaciones.

---

## 0. Corrección importante a los docs previos

`2026-08-10-tecnica-render-murmur.md` (sección 5) atribuye "4.200 puntos de niebla azul" al
**bosque**. La evidencia de esta sesión lo contradice:

```
p.world===`pond`)Lt(),Rt(),zt(),Bt(),Vt(),Ht(),Ut(),pt();
else if(p.world===`city`)tn(),pn(),bn(),Sn(),Cn(),wn(),Tn(),Dn(),kn(),An(),pt();
else{ct(),at(),ot(),ut(),ft(),pt();...}   // bosque
```

`Bt()` (4 200 puntos, radio `mt*1.28`) **solo se llama en la rama `pond`**. Hay una única
invocación de `Bt()` en todo el bundle (confirmado con `grep -c`). El bosque (rama `else`: `ct`,
`at`, `ot`, `ut`, `ft`, `pt`) no incluye ningún equivalente. Es decir: **la niebla aditiva de
4 200 puntos es un efecto de AGUA, no de bosque** — contradice la tabla previa. Dejo esto marcado
como corrección; si el bosque tiene niebla visual, no viene de esta función.

También corrijo `2026-08-10-MAPA-COMPLETO-bundle.md` sección 2, que listaba `Vt`/`Dn` como
"pasto ciudad / pasto pond" sin decidir cuál era cuál. Con el código a la vista:

- **`Dn` = pasto de CIUDAD** — `Math.floor(46e3*p.grass)` (=46 000, coincide con el dato ya
  documentado en `tecnica-render-murmur.md` de "46.000 en ciudad").
- **`Vt` = pasto/juncos de AGUA** — mucho más disperso (`16*46` ≈ 736 hojas base), sembrado sobre
  los lóbulos de la isla (`_t`), no una pradera densa.

Y `Ht` (que el mapa anterior listaba como "flores de ciudad/pond", sin resolver) resultó ser, en
la rama `pond`, literalmente un cuerpo vacío:

```js
function Ht(){p.flowers}
```

**AGUA no tiene flores implementadas en el sitio en vivo** — la función existe pero no hace nada
(probablemente un placeholder o una feature deshabilitada). No hay nada que replicar ahí más allá
de dejar el hueco.

---

## 1. Los tres mundos: nombres, ids y selección

Hay **exactamente 3 mundos**. Conviven varias familias de nombres en el bundle — importante no
mezclarlas al portar:

| Familia | Bosque | Ciudad | Agua |
|---|---|---|---|
| Título HUD (`hg` table, ver §7) | `Plot ecosystem` | `Block ecosystem` | `Pond ecosystem` |
| id interno del selector (`Im`, `_p`) | `land` | `city` | `water` |
| ruta `/radio/<id>/...` y prefijo de SFX | `forest` | `city` | `water` |
| check en el motor 3D (`p.world===`) | *(rama `else`, sin string propio)* | `` `city` `` | `` `pond` `` |

Es decir: el motor 3D interno usa **`pond`**, pero el selector de UI y las rutas de audio usan
**`water`**; el bosque no tiene ni siquiera un string propio en el motor (es la rama `else`
implícita) pero la UI lo llama `land` y las rutas lo llaman `forest`. Evidencia:

```js
var _p=[`water`,`land`,`city`];                 // lista válida del selector
window.setScene = function(e){
  _p.includes(e) && (Im=e,
    document.body.classList.remove(`scene-water`,`scene-land`,`scene-city`),
    document.body.classList.add(`scene-`+e),
    [`water`,`city`,`land`].forEach(t=>{
      let n=document.getElementById(`pill-dot-`+t);
      n&&n.classList.toggle(`hero-pill-dot--active`, t===e)
    }),
    Vm(e), Pm(e), Am(), wm(e), Sg(e), Hp.setScene?.(e))
};
```

`Vm(e)` sincroniza visibilidad/estado activo de 5 grupos de elementos DOM con `[data-scene]`
(`.hero-top-view`, `.content-button-image`, `.content-world-layer`, `.content-world-diagram`,
`.content-detail-pond-pic`). `Pm`/`Am` gestionan los videos de fondo y el audio por mundo. `Sg(e)`
actualiza el HUD (título/color/ícono, ver §7). `Hp.setScene` es el hook del motor de audio/3D.

**Confirmación de 3 mundos y no más**, por los prefijos de SFX shake (`ng`, ver §8):
`ng = {land:[...], water:[...], city:[...]}` — exactamente 3 claves.

---

## 2. Config maestra compartida (`s`, `p`)

Paleta de agentes (`s`), **compartida entre los 3 mundos** (ver `tecnica-render-murmur.md` para
la tabla ya confirmada — repito solo para referencia cruzada, valores idénticos verificados de
nuevo en esta sesión):

```js
s = {white:15659775 /*#EEF2FF*/, cyan:1107663 /*#10E6CF*/, pink:16736176 /*#FF5FB0*/,
     magenta:16719759 /*#FF1F8F*/, cyanEye:1503448 /*#16F0D8*/, orange:16742932 /*#FF7A14*/,
     cyanSat:3532498 /*#35E6D2*/, yellow:16769562 /*#FFE21A*/, blue:2836735 /*#2B48FF*/,
     bond:16757082 /*#FFB15A*/}
```

Objeto de estado global `p` (el que trae `world`, y los multiplicadores por-mundo `grass`,
`flowers`, `streets`, `towers` que ya documentaba `tecnica-render-murmur.md`):

```js
p = {speed:1.8, trailSize:3.4, visibleLen:34, dof:.2, count:15, fisheye:.6, chroma:.25,
     vigSize:1, grass:1, flowers:1, streets:2, towers:1, world:`city`}
```

(`world` queda en `city` en el snapshot capturado — es solo el último valor puesto por el
selector al momento del fetch, no un default fijo).

**Color de "rastro/arista brillante" del agente al rodar** difiere por mundo (función `Vn`,
"rodado de jaula"):

```js
var c = [1,.12,.09]     // #FF1F17 — bosque y agua
var en = [1,.23,.35]    // #FF3B59 — ciudad
...
g = p.world===`city` ? en : c
```

---

## 3. CIUDAD (BLOCK) — desglose completo

### 3.1 Terreno / retícula urbana

```js
var Wt=62, Gt=13, Kt=2.4, qt=Wt*.85;   // Wt=semi-lado, Gt=ancho de calle, Kt=altura de bordillo
```

- **`Wt=62`** — semi-lado de la retícula (grid de manzanas, coincide con lo ya documentado).
- **`Gt=13`** — ancho de calle entre manzanas.
- **`Kt=2.4`** — altura del bordillo/acera sobre el nivel de calle.
- **`we=-4`** — altura base del plano de calle (ground level de ciudad). Usado en `pn()` (malla
  de suelo) y en `ln()` (altura de bordillo): `we+(Kt+cn(e,t))*n`.
- Número de calles por eje: `Math.round(p.streets)` acotado a `[1,4]`, con el otro eje pudiendo
  ser hasta `+1` más (`t+ +(q()<.4)`), y 50% de chance de intercambiar los dos ejes. Con
  `p.streets=2` por defecto, sale típicamente 2×2 o 2×3.
- Malla de suelo `pn()`: grid de **150×150** vértices sobre un cuadrado de lado `Wt*2.35` (=145.7).
- Manzanas: array `Xt` (bloques generados por la retícula de calles), con centro `cx,cz` y
  semi-tamaños `hx,hz`.

### 3.2 Paleta de edificios (`$t`, array de 6 RGB, uso: `Math.random()<.66 ? tint-del-bloque :
random de $t`)

| RGB (0–1) | Hex | Lectura |
|---|---|---|
| `[.99,.86,.66]` | `#FCDBA8` | crema/arena |
| `[1,.58,.14]` | `#FF9424` | naranja |
| `[.985,.71,.52]` | `#FBB585` | durazno/crema-naranja |
| `[.72,.55,.96]` | `#B88CF5` | lavanda/violeta |
| `[1,.84,.79]` | `#FFD6C9` | rosa pálido/crema |
| `[.99,.45,.12]` | `#FC731F` | naranja-rojizo |

Coincide exactamente con lo ya observado en vivo (`lenguaje-visual.md`: "naranja intenso,
crema/arena, lavanda/violeta"), ahora con hex exactos y evidencia de código (`$t=[[.99,.86,.66],
[1,.58,.14],[.985,.71,.52],[.72,.55,.96],[1,.84,.79],[.99,.45,.12]]`).

Color de "farola" — array separado en `Cn()` (5 colores, uso probable: luces de farola o
detalles de mobiliario urbano, sin confirmar 100%):
`[.16,.3,.98]#294CFA · [1,.83,.2]#FFD433 · [1,.35,.55]#FF598C · [.35,.9,.85]#59E6D9 ·
[1,.48,.09]#FF7A17`.

### 3.3 Orden de construcción del mundo ciudad

```js
tn(), pn(), bn(), Sn(), Cn(), wn(), Tn(), Dn(), kn(), An(), pt()
```

| fn | Rol confirmado por código |
|---|---|
| `tn()` | Red de calles: genera cortes en ambos ejes (`Jt`,`Yt`), construye manzanas `Xt` |
| `pn()` | Malla de suelo (150×150, lado `Wt*2.35`), altura = `we+(Kt+cn(u,d))*f` |
| `bn()` | **Torres**: por cada manzana `Xt`, probabilidad de torre ∝ `min(hx,hz)*2` y `p.towers`; usa `yn()` como builder de la torre (bloques apilados, `q()<.66` usa el tinte del bloque o color random de `$t`) |
| `Sn()` | Estructura secundaria sobre manzanas (3–6 por mundo, offset aleatorio dentro del bloque) — **rol exacto sin confirmar del todo**, geometría tipo `gn` (probable edificio bajo/volumen-caja) |
| `Cn()` | 3–7 elementos con la paleta de 5 colores de §3.2 — **candidato a farolas** por la paleta multicolor tipo luces, sin confirmar 100% |
| `wn()` | 1–3 elementos, dimensiones `5.5+q()*1.5` × `3.4+q()*.6` — volumen más consistente en tamaño que `Sn`, candidato a mobiliario urbano fijo |
| `Tn()` | Planos grises `[.72,.74,.79]` `#B8BDC9` con `vertexColors`, en los bordes de manzana — **candidato fuerte a charcos/pavimento** (color gris-azulado neutro, coincide con "charcos que reflejan" de `lenguaje-visual.md`) |
| `Dn()` | **Pasto**: `Math.floor(46e3*p.grass)` + `Math.floor(700*p.grass)` extra = **46 700 hojas** con `p.grass=1` |
| `kn()` | **Flores de ciudad**: por cada manzana `Xt`, `Math.round((8+q()*14)*p.flowers)` flores por parche, en el perímetro de la manzana + otro loop adicional |
| `An()` | **Polvo/neblina de ciudad**: 2 400 puntos (`e=2400`), posicionados con `y=we+.25+q()*2.4` (pegados al piso, distinto del `Bt` de agua que flota más alto) — más un filtro `q()>Math.exp(-s/3)` que concentra los puntos cerca de las calles (`s=an(a,o)` = distancia a la curva de calle) |
| `pt()` | Subida final de buffers de puntos — compartida con los otros 2 mundos |

`bn()`/`yn()` (torres) en detalle:

```js
function bn(){
  for (var e=p.towers, t=0; t<Xt.length; t++){
    var n=Xt[t], r=Math.min(n.hx,n.hz)*2,
        i=(r>=20?.85 : r>=14?.5 : .2) * e;
    q()<i && yn(n);
    r>=40 && q()<.6*Math.min(e,1.5) && yn(n);   // manzanas grandes pueden tener 2 torres
  }
}
```

### 3.4 Roster de agentes de CIUDAD

Tabla de pesos exacta (función `Pn`, dispatcher de especies):

```js
n /* city */ ? [[`whiteC`,3],[`cyanC`,4],[`flag`,4],[`dbl`,3],[`eye`,2]]
```

| Especie | Peso | Constructor | Notas de geometría (evidencia de código) |
|---|---|---|---|
| `whiteC` | 3 | `ge(r, s.white)` | jaula cubo (lado 6) + criatura interna, color blanco |
| `cyanC` | 4 | `ge(r, s.cyan)` | igual que `whiteC` pero cian — **mismo constructor que la especie `cyan` del bosque**, es el mismo código reutilizado con otro nombre lógico |
| `flag` | 4 | `_e(r)` | trípode + mástil + anillo — **idéntico al `flag` del bosque** (no hay variante ciudad) |
| `dbl` | 3 | `ve(r)` | dos anillos amarillos + núcleo naranja — **idéntico al `dbl` del bosque** |
| `eye` | 2 | `he(r)` | cuña/octaedro + anillo + mástil — **idéntico al `eye` del bosque** |

**Hallazgo clave: CIUDAD no tiene ninguna especie geométrica propia.** Las 5 especies de ciudad
son las mismas 5 funciones constructoras que ya están portadas para el bosque (`ge`, `_e`, `ve`,
`he`); solo cambia **qué subconjunto se usa y con qué pesos**. Esto simplifica mucho el port:
ciudad = bosque con distinto pool de especies + terreno propio, cero geometría de agente nueva.

Diferencia de escala/comportamiento en ciudad (evidencia en el dispatcher):

```js
var o=p.world===`city`, c=(.9+Math.random()*.55)*(o?.67:1);   // agentes ~33% más chicos en ciudad
r.group.scale.setScalar(c); r.effR*=c; r.colR*=c;
if(o){ r.trafH = ({whiteC:3.2,cyanC:3.2,eye:3,flag:2.72,dbl:1.5}[i]||2.4)*c }  // altura de "tráfico"/vuelo por especie
```

---

## 4. AGUA (POND) — desglose completo

### 4.1 Terreno / laguna

```js
var mt=64;      // radio base de la isla/laguna ("Laguna: radio 64" ya documentado — confirmado)
var ht=-3.4;    // altura base / nivel de referencia ("Laguna: nivel de agua −3.4" — confirmado)
var gt=11;      // profundidad de los lóbulos del lecho por debajo de ht
var G=85;       // radio global compartido (usado también por Bt/Ut para el tamaño del "halo")
```

Orden de construcción:

```js
Lt(), Rt(), zt(), Bt(), Vt(), Ht(), Ut(), pt()
```

| fn | Rol confirmado por código |
|---|---|
| `Lt()` | **Genera los "lóbulos" de la isla/orilla** (`_t`, 2–5 elipses con `rx,rz,ry,yaw,cy=ht-gt,x,z`) — la forma irregular de la laguna sale de superponer estas elipses, no de un disco simple. *(El mapa anterior lo adivinaba como "flores de pond"; es en realidad el generador de terreno.)* |
| `Rt()` | Malla del **lecho/orilla** — grid 110×110 sobre cuadrado `G*2.4`=204, altura `ht-gt + ruido*1.3`, recortada por el campo de lóbulos |
| `zt()` | **Plano de agua** — grid 150×150, altura constante `ht-.12` (=-3.52, justo debajo de `ht`) — confirma que `ht` es el "nivel del agua" |
| `Bt()` | Niebla aditiva, **4 200 puntos**, radio `mt*1.28`, altura `ht+.3+q()*2.6` — ver corrección en §0, esto es exclusivo de agua, no del bosque |
| `Vt()` | Pasto/juncos disperso sobre los lóbulos de la orilla: `t=Math.round(16*p.grass)`, `n=t*46` (≈736 con `p.grass=1`) — mucho menos denso que el pasto de bosque/ciudad, sembrado con `Ct()` (función de elongación de lóbulo) |
| `Ht()` | **Vacía** (`function Ht(){p.flowers}`) — no genera nada, ver §0 |
| `Ut()` | Polvo de borde, **8 500 puntos** — mismo valor que ya documentaba `tecnica-render-murmur.md`, pero aquí confirmado como parte del **init de agua específicamente** (no aparece en la rama bosque ni en la de ciudad) |
| `pt()` | Subida final de buffers — compartida |

Campos escalares del lecho (ya listados sin resolver en el mapa anterior como "campos de
agua/ciudad" — ahora identificados dentro de la ventana de agua):

| fn | Fórmula / rol |
|---|---|
| `xt(e,t)` | `mt*(.86+(Me(e*.02+7,t*.02+3,3)-.5)*.6)` — radio base del borde de isla en el ángulo `(e,t)`, con ruido fbm |
| `Ct(lóbulo,ángulo)` | elongación radial del lóbulo: `max(.42, 1+(Me(...)-.5)*1.25+(Me(...)-.5)*.55)` |
| `Tt(lóbulo,ángulo)` | radio final del lóbulo = `Ct(...) * (1+ruido menor)` |
| `Et(e,t)` | máscara de borde/orilla (0–1), usada para transición suave |
| `Dt(e,t)` | altura del lecho en `(e,t)` sumando la contribución de todos los lóbulos |
| `Ot(e,t)` | variante de `Dt` (posiblemente profundidad en vez de altura — mismo cuerpo de bucle, sin diferenciar 100%) |
| `kt(e,t)` | máscara "dentro de un lóbulo" (0–1) |
| `At(e,t,n)` | test booleano "¿dentro de algún lóbulo con margen `n`?" |
| `wt(e,t)` | densidad radial combinando `St` (smoothstep) y `kt` — modula dónde cae niebla/polvo |

### 4.2 Roster de agentes de AGUA

```js
t /* pond */ ? [[`lamp`,2],[`ice`,3],[`strider`,3],[`orb`,2],[`burst`,3],[`pins`,2]]
```

| Especie | Peso | Constructor | Colores exactos (decimal → hex) | Parámetros de vuelo/nado |
|---|---|---|---|---|
| `lamp` | 2 | `U(r)` → `ye(e, s.white, [s.yellow,s.yellow,s.orange], 5218559/*#4FA0FF*/, 3)` | cage blanca, satélites amarillo/amarillo/naranja, esferas azules | `band=2, hover=1.9, dive=2.2+rand*1.2` |
| `ice` | 3 | `be(r)` → `ye(e, 11462399/*#AEE6FF*/, [12177994/*#B9D24A*/, s.cyanSat, 5218559/*#4FA0FF*/], 2853887/*#2B8BFF*/, 2.5)` | cage celeste, satélites lima/cian-sat/azul | `band=3, hover=1.6, dive=1.7+rand*1` |
| `strider` | 3 | `xe(r)` propio (no usa `ye`): 3–5 aristas radiales (colores `1323240 #1430E8 · 2845695 #2B6BFF · 3787007 #39C8FF · 2871402 #2BD06A`), disco base `8252978 #7DEE32`, punta esférica `3526762 #35D06A` | geometría única de "patas" | `rollMul=.55, effR=1.2, colR=1.9, band=12, spinY, speedScale*=.45, hover=.42, dive=-.15` |
| `orb` | 2 | `Se(r)` propio: 2–3 discos achatados (color `s.yellow` o `14215242 #D8E84A`), esfera central `14715864 #E08BD8`, 1–4 bolitas blancas satélite | geometría única, sin cage | `rollMul=0, effR=1, colR=2.2, band=9, hover=1.1, dive=1.2+rand*.9` |
| `burst` | 3 | `W(r)` propio: 1–2 anillos base `9363530 #8EE04A`, 5–9 rayos radiales (colores `14674175 #DFE8FF · 13490414 #CDD8EE · 1323240 #1430E8 · 2845695 #2B6BFF · 10469631 #9FC0FF`), esfera core `12576511 #BFE6FF` | **este es el "burst" que el mapa anterior asignaba a ciudad — en realidad es de AGUA** | `rollMul=0, effR=1, colR=2.4, band=4, spinY, speedScale*=.5, hover=.35, dive=-.18` |
| `pins` | 2 | `Ce(r)` propio: disco base `8839226 #86E03A`, disco secundario opcional `11069514 #A8E84A`, 4–7 "alfileres" (líneas) con colores `10135602 #9AA832 · 12173898 #B9C24A · 9083434 #8A9A2A` | geometría de alfiler/junco | (parámetros de física no capturados en esta pasada) |

**Segunda corrección al mapa anterior**: la tabla de "AGENTES — fábrica de especies" de
`2026-08-10-MAPA-COMPLETO-bundle.md` asignaba `xe strider`/`Se orb` a "pond/ciudad" y `W burst`/
`U lamp` a "ciudad" como conjetura. Con el dispatcher real (`Pn`, §1/§3.4/§4.2) confirmado: **las
6 especies `lamp, ice, strider, orb, burst, pins` son EXCLUSIVAS de agua**; ciudad no usa ninguna
de ellas (ciudad reutiliza `whiteC/cyanC/flag/dbl/eye`, ver §3.4).

### 4.3 Física de agua (extracto de `Rn`, update por-frame)

```js
if (p.world===`pond`){
  var j = ht - (n.dive||1.6) + n.homeY*.3 + Math.sin(P*1.4+n.idx*2.1)*.34;
  if (j < ht - gt + .9) j = ht - gt + .9;   // no atraviesa el lecho
  ...
}
```

Y en el sub-paso de inclinación (roll) al nadar cerca de la superficie:

```js
p.world===`pond` && (r.y < ht+1.2
  ? (n.group.rotation.x = Math.sin(...)*.085, n.group.rotation.z = Math.cos(...)*.085)  // cabecea al flotar
  : (n.group.rotation.x *= 1-3*e, n.group.rotation.z *= 1-3*e));                        // se endereza al volar alto
```

Cada especie trae su propio `dive` (profundidad objetivo bajo `ht`) y `hover` (altura de
planeo), lo que da el efecto "algunas bucean, otras planean sobre el agua" mencionado en el
análisis de paridad.

---

## 5. Núcleo compartido vs. por-mundo

| Sistema | Compartido (core) | Por-mundo |
|---|---|---|
| **Paleta de agentes** `s` | ✅ 10 colores fijos, iguales en los 3 mundos | — |
| **Geometría de agente** `he/ge/_e/ve/ye/pe/fe/me` | ✅ bosque y ciudad usan el mismo set completo | agua tiene 6 constructores propios (`U,be,xe,Se,W,Ce`) que sí son código nuevo |
| **Selector de especies** `Pn` | ✅ mismo algoritmo (pool ponderado + relleno aleatorio) | la **tabla de pool** (`[[nombre,peso],...]`) cambia por mundo |
| **Física de agente** `Rn` | ✅ move/rest/wander/separación/límites | ramas `if(p.world===...)` para: offroad de ciudad, dive/hover/roll de agua |
| **Primitivas de render** (líneas, puntos, shader tamaño-mundo+DOF, `pt()`) | ✅ 100% | — |
| **Cámara, lente, niebla de escena** | ✅ | — |
| **Estelas** | ✅ | — |
| **HUD ecosistema** (`Sg`, tabla `hg`) | ✅ mecanismo | título/ícono/color por mundo (§7) |
| **Shake** (`tg`, `sg`, clases CSS) | ✅ 100% mecanismo y sonido sintetizado | ✅ solo el **banco de SFX** (`ng`) cambia por mundo |
| **Terreno** | ➖ nada compartido | cada mundo tiene su propio generador: `ct/at/ot/ut/ft` (bosque), `tn/pn/bn/Sn/Cn/wn/Tn/Dn/kn/An` (ciudad), `Lt/Rt/zt/Bt/Vt/Ht/Ut` (agua) |
| **Config maestra `p`** | ✅ mismo objeto | `world`, y los multiplicadores `grass/flowers/streets/towers` se leen distinto según el generador de terreno activo |
| **Config de audio** (2 stems, JSON de eventos) | ✅ mismo esquema (`murmur-<mundo>-partNN-{mus,atm}.mp3` + `-simple.json`) | contenido/ritmo por mundo (ya documentado en `2026-08-10-paridad-murmur-analisis.md`) |

**Implicación para portar**: agua es el mundo que más código nuevo pide (terreno con lóbulos +
6 especies + física dive/hover). Ciudad es mucho más barata en cuanto a *agentes* (cero
geometría nueva, solo terreno + pesos) pero cara en *terreno* (calles, manzanas, torres,
edificios). Encaja con lo que ya proponía `2026-08-10-paridad-murmur-analisis.md` en su sección
4-bis (arquitectura `worlds/{city,forest,pond}.js` + `worlds/index.js`), con el matiz de que ahí
las paletas/censos de ciudad y agua eran **diseño propio**; ahora hay valores exactos del bundle
real para reemplazarlos si se quiere apuntar a paridad estricta en vez de diseño propio.

---

## 6. Menú SHAKE

**No hay `devicemotion`/acelerómetro en el sitio web** (`grep` de `devicemotion|DeviceMotionEvent
|accelerometer` sobre el bundle completo: 0 resultados). El "shake" del sitio es **un botón de
click**, no un gesto físico de agitar el teléfono. (El acelerómetro real sí existe en el
hardware `murmur-diy`, pero eso es firmware aparte, no este bundle web.)

Elemento disparador: `.hero-pill-shake-btn`. Al hacer click:

```js
Jh.addEventListener(`click`, () => {
  tg(Yh, Qh);           // añade clase `is-shaking` 800ms a .hero-radio-cluster
  tg(Xh, $h);            // ídem a .hero-top-view-stage
  tg(Zh, eg);             // ídem a .content-button-stack
  mp(3e3);                // (función no explorada en detalle: probable bump de activity/tension 3s)
  Hp.unmuteIfMuted();     // desmutea el audio si estaba muteado
  Hp.scare(3);            // "asusta" a los agentes (probable: dispersión momentánea)
  rg();                   // reproduce 1 SFX aleatorio del banco del mundo activo
  sg();                   // sintetiza un traqueteo (ver abajo)
});
```

`tg(el, timerState)` = toggle de clase CSS (quita y re-agrega `is-shaking` para reiniciar la
animación, con `setTimeout` de 800 ms para quitarla).

**Banco de SFX por mundo** (`ng`), reproducido vía `/radio/shake-fx/<nombre>.mp3`:

```js
ng = {
  land:  [`forest-acorns-cascade`, `forest-blackbird-alarm`, `forest-blackbird-burst`,
          `forest-squirrel-alarm`, `forest-twig-snap`, `forest-badger-alarm`, `forest-magpie-attack`],
  water: [`water-heron-strike`, `water-cetti-burst`, `water-swan-takeoff`, `water-geese-alarm`,
          `water-moorhen-alarm`, `water-vole-plop`, `water-coot-eruption`],
  city:  [`city-skater-grind`, `city-ambulance-siren`, `city-tram-screech`, `city-argument`,
          `city-glass-crash`, `city-fox-screech`, `city-skater-kickflip`, `city-car-horn`]
}
function rg(){ let e=ng[Im]||ng.land; let t=e[random]; new Audio(`/radio/shake-fx/${t}.mp3`).play() }
```

**Traqueteo sintetizado** (`sg`/`og`, Web Audio, sin depender de ningún mp3): tren de clicks
triangulares con frecuencia aleatoria 800–2500 Hz, envolvente exponencial 20–55 ms, disparados
cada 40–115 ms durante 800 ms con intensidad decreciente:

```js
function og(ctx, mag=1){
  var osc=ctx.createOscillator(), gain=ctx.createGain();
  osc.type=`triangle`; osc.frequency.value = 800+Math.random()*1700;
  var t=ctx.currentTime, dur=(.022+Math.random()*.035)*mag;
  gain.gain.setValueAtTime(1e-4,t);
  gain.gain.exponentialRampToValueAtTime(Math.max(1e-4,dur), t+.002);
  gain.gain.exponentialRampToValueAtTime(1e-4, t+.02+Math.random()*.035);
  osc.connect(gain).connect(ctx.destination); osc.start(t); osc.stop(t+.12);
}
function sg(totalMs=800){
  var ctx = window.AudioContext||window.webkitAudioContext; ...
  var start=Date.now();
  (function tick(){
    var elapsed=Date.now()-start;
    if (elapsed>=totalMs) return;
    og(ctx, 1-elapsed/totalMs*.35);              // decae en intensidad
    setTimeout(tick, 40+Math.random()*75);        // siguiente click en 40–115ms
  })();
}
```

También hay un log de evento fijo tras el shake: `"The world was shaken"`, insertado como
`<li class="radio-fs-log-weather">` al tope del events log.

Nota: `.hero-top-view-stage` y `.content-button-stack` **también** tienen su propio listener de
click que dispara solo el efecto visual (`tg`) + `mp(3000)`, sin el SFX/traqueteo completo — o
sea hay 3 zonas clicables con distinto nivel de "shake" (el botón dedicado da el paquete
completo; las otras dos solo la animación).

---

## 7. Menú de cambio de mundo

Selector de 3 "pill dots" (coincide con lo ya visto en vivo: "3 círculos con glifo" de
`lenguaje-visual.md` §10), con ids **`pill-dot-water`**, **`pill-dot-land`**, **`pill-dot-city`**.
Click → `window.setScene(id)` (código completo en §1).

**Tabla de identidad visual por mundo** (`hg`, la usa `Sg(e)` para pintar el HUD "ECOSYSTEM"):

```js
hg = {
  land:  {title:`Plot ecosystem`,  icon:`/icons/land_icon.svg`,  color:`#b6d184`},  // verde suave
  water: {title:`Pond ecosystem`,  icon:`/icons/water_icon.svg`, color:`#aacdff`},  // azul suave
  city:  {title:`Block ecosystem`, icon:`/icons/city_icon.svg`,  color:`#fab75e`}   // naranja suave
}
```

`Sg(e)` aplica `title`/`color`/`icon` a varios pares de nodos (`fs`/`fsEmbed` — pantalla completa
y embed), incluyendo título del ecosistema, ícono, título del log y color del indicador de
temperatura. Esto confirma exactamente el "color de acento = color del mundo activo" que ya
observaba `lenguaje-visual.md`, ahora con los 3 hex exactos (más suaves/pastel que la paleta de
agentes — son para fondo de HUD, no para agentes).

**Contador "pseudo-vivo" por mundo** (`gg`, actividad/población que camina aleatoriamente entre
límites, probablemente el número mostrado como "oyentes" o actividad del ecosistema):

```js
gg = {
  land:  {min:8,  max:18, startMin:11, startMax:15},
  water: {min:10, max:20, startMin:13, startMax:17},
  city:  {min:14, max:28, startMin:18, startMax:23}
}
// yg(): inicializa cada _g[mundo] en [startMin,startMax]
// bg(): cada tick, _g[mundo] += ±1 acotado a [min,max]
```

Ciudad tiene el rango más alto (más "actividad" simulada), agua el más bajo — consistente con la
densidad de eventos/min ya documentada (ciudad ~20 ev/min, agua ~14 ev/min).

**Apertura del panel fullscreen ("entrar al mundo")**: separado del selector de mundo. Botón
`#enterWorldPill` (y `.content-radio-preview-cta`, `.content-radio-preview`) llaman a `ft(true)`,
que agrega la clase `radio-fs-open` al contenedor fullscreen. Se cierra con botón dedicado, click
fuera, o tecla **Escape**. Es el panel que contiene el canvas 3D fullscreen + events log + panel
ecosystem + record — no es en sí un "cambiador de mundo", es el modal que envuelve toda la
experiencia inmersiva; una vez dentro, los mismos pill-dots siguen sirviendo para cambiar de
mundo sin cerrar el modal.

---

## 8. Qué queda sin resolver (para una próxima pasada si hace falta más profundidad)

- **`Sn`, `Cn`, `wn`** de ciudad: identificadas por posición/tamaño/paleta pero sin confirmar
  100% qué representan visualmente (candidatos: edificios bajos, farolas, mobiliario urbano —
  ver §3.3). Requeriría comparar contra capturas en vivo con las 3 funciones aisladas.
  Sí quedó 100% confirmado: `bn`=torres, `tn`=calles, `pn`=suelo, `Dn`=pasto, `kn`=flores,
  `An`=polvo/neblina, `Tn`=candidato fuerte a charcos.
- **`c` vs `en`** (color de arista de agente al rodar): confirmado el valor y el switch por
  mundo, pero no verifiqué visualmente el efecto en vivo.
- El clima/fases horarias por mundo (overcast, glassy still, etc., ya documentado en
  `2026-08-10-paridad-murmur-analisis.md`) **no viene del bundle JS** sino de los JSON de eventos
  horneados (`/radio/<mundo>/murmur-<mundo>-partNN-simple.json`) — confirmado de nuevo en esta
  sesión (no hay strings de esos nombres de clima en el JS). Si se necesita la lista exacta y
  completa por mundo, hay que descargar y parsear esos JSON, no el bundle.
- No confirmé si existe niebla equivalente a `Bt`/`An` para el **bosque** en algún otro punto del
  código fuera de la ventana 583k–673k inspeccionada (la corrección de §0 se basa en que no
  aparece en el dispatch de inicialización del mundo, que es donde documentan los otros dos
  mundos su niebla — pero no descarté un mecanismo de niebla "siempre activo" fuera de esa rama).

---

## 9. Archivos generados en esta sesión (scratchpad, no en el repo)

- `script-Daaf7S9n.js` — bundle completo descargado.
- `world_module.js`, `world_module2.js`, `wm3.js` — recortes de la ventana del módulo de mundo
  usados para las búsquedas acotadas de esta sesión (evitan colisión con nombres reciclados de
  Three.js).

Ninguno de estos archivos quedó en el repo del proyecto; si se quiere repetir el análisis después,
hay que re-descargar (`curl https://murmur.living/assets/script-Daaf7S9n.js`) — el hash puede
cambiar si Murmur redeploya.
