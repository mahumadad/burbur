# Mapeo visual EXACTO del mundo AGUA de murmur (del bundle)

**Fecha:** 2026-08-11
**Fuente:** `script-Daaf7S9n.js` (771873 bytes, re-descargado esta sesión de murmur.living; el
loader `main-BcdE_g8X.js` importa este mismo bundle). Valores/colores literales del código.
**Motivo:** la primera implementación de pond quedó como "laguna con pasto alrededor" — INCORRECTO.
El mundo real es **islas de arena flotando en un campo de agua azul brillante sobre fondo negro**.

## Estructura (invertir el modelo: islas EN agua, no agua EN tierra)

Vars: `mt=64` (radio laguna), `ht=-3.4` (nivel agua), `gt=11`, `G=85` (radio global).
Dispatch: `Lt(),Rt(),zt(),Bt(),Vt(),Ht()/*vacía*/,Ut(),pt()`.

### Islas — `Lt()` genera lóbulos, `It(lobe)` los construye
- **2–5 lóbulos** (`e=2+(rnd()*3.5|0)`). Lóbulo 0 (central): `rx=18+rnd()*4`. Otros: `rx=10+rnd()*7`.
  `rz=rx*(.68+rnd()*.42)`, `ry=rx*((0:1.12|otros:1.18)+rnd()*(.22|.26))` → **más alto que ancho**.
  `cy=ht-gt=-14.4` (centro en el lecho). Tope del elipsoide `cy+ry` ≈ **+7** (sobre el agua).
- Placement: central en radio 6–14; los demás **adyacentes a otro lóbulo** (clusterizados),
  `d=(max(l.rx,l.rz)+max(rx,rz))*(.55+rnd()^1.4*.8)`, dentro de `mt*.62≈40`.
- **1–3 islitas exteriores** (`g=4+rnd()*5`) en radio `25+rnd()*13`, sin solapar.
- `It(lobe)`: `IcosahedronGeometry(1,4)` deformada por ruido × `rx/rz/ry`, posicionada en `(x,cy,z)`.
  - Color por vértice (y mundo = `o+cy`): sub-agua tono azul oscuro
    `[.018+.037w, .032+.098w, .2+.22w]` (w=(1-C)², C=altura desde lecho); sobre-agua
    `jt+(J-jt)*b` con `jt=[.66,.43,.415]` (arcilla), `J=[.935,.72,.635]` (arena clara), `b`=brillo
    por normal/altura/ruido. Transición por `S=smoothstep(ht-1.2, ht+.4, y)`.
  - Mesh `side:2` + (implícito matrix: puntos de vértice size .13, color arena).
  - **Liquen naranja** `[1,.827*(.96..1.05),.071]` en caras hacia arriba sobre `ht+.3` (como rocas
    del bosque), ~`floor(30*rx*rz)` candidatos.
  - **Espuma blanca** en la línea de agua: `min(2600, floor(70*(rx+rz)))` puntos `[1,1,1]`,
    `y=ht+.06+rnd()^2.2*.9`, size `.1+rnd()*.2`, **con phase** (balanceo). Es el "rim" blanco.
  - **Ramas secas**: `1+(rnd()*2|0)` (1–2) por isla, desde puntos de la línea de agua.

### Agua — `zt()`
- `PlaneGeometry(G*2.4, 150,150)`, **plano** en `y=ht-.12=-3.52`. `side:2, transparent, opacity:.58,
  depthWrite:!1, renderOrder 0`. Añadida a un grupo `bt`.
- Color por vértice: `base = Y + (Mt*1.5-Y)*f + Nt*p*f`, luego `*(1-.62*kt)`. `clamp 1`.
  - `Y=[.004,.01,.028]` (casi negro), `Mt=[.02,.07,.23]` (azul profundo), `Nt=[.115,.38,1]` (glow).
  - `d=smoothstep(clamp((l-xt*.3)/(xt*.95),0,1))`, `f=1-d`; `xt=mt*(.86+(fbm(x*.02+7,z*.02+3,3)-.5)*.6)`.
  - `p=wt*2.2*(.5+.85*fbm(x*.035+31,z*.035-12,3))`; `wt`=densidad de lóbulos → **el glow azul se
    concentra sobre/entre las islas**. `kt`=máscara dentro-de-lóbulo (oscurece donde hay isla).

### Lecho — `Rt()`
- `PlaneGeometry(G*2.4, 110,110)` en `y=ht-gt+(fbm(x*.06+3,z*.06-8,2)-.5)*1.3` (≈-14.4).
- Mismo color que agua pero `*.5*m` **+ rim cian** `[.07,.68,.62]·Et²` (Et=máscara de borde) → el
  brillo cian-verde en el borde de las islas.
- **26–42 piedras** (`ro(.15+...)`) colores `[[.55,.45,.12] olive, [.55,.58,.62] gris, [.06,.12,.45] azul]`.

### Niebla — `Bt()`
- **4200** puntos aditivos, radio `mt*1.28≈82`, `y=ht+.3+rnd()*2.6` (-3.1..+3.1), size `3+rnd()*6.2`,
  filtrados por `wt` (**sobre los lóbulos**). Shader aditivo tamaño-mundo (uProj). Color azul (~Nt).

### Juncos — `Vt()`
- `t=round(16*grass)=16`, `n=t*46=**736**`. Sembrados en la **línea de agua de cada lóbulo**
  (`d=(ht-gt-cy)/ry≈0`, radio de la elipse a ese nivel), dispersos. 12% (`O=rnd()<.12`) altos
  (bulrush `A=gt+.8+rnd()*3.2`); resto `A=3.5+rnd()*5`. Hoja = 2 segmentos.
- Color olive-amarillo: `I=.8+.2F, L=.64+.19F, R=.04+.04F` (F=ruido); gradiente base `*.25` → tip.

### Polvo — `Ut()`
- **8500** puntos, radio `mt*(.95+rnd()^.85*1.15)` (≈61–134, excluye `>G*1.3=110.5`), `y=ht+rnd()*.6`,
  color azul-teal `[.03s+.015, .15s+.025, .17s+.035]`, size `.1+rnd()*.2`.

## Diferencias con mi 1ª implementación (a corregir)
1. NO laguna-cráter con tierra verde alrededor → SÍ islas de arena en agua sobre negro.
2. Juncos NO anillo denso → 736 dispersos en la línea de agua de cada isla.
3. Agua NO disco chico → campo grande (G*2.4) con glow azul concentrado sobre lóbulos.
4. Sumar: espuma blanca en rims, liquen naranja, ramas secas, piedras, polvo azul-teal.
5. Mejoras del usuario (encima de la paridad): agua con MOVIMIENTO/olas + **ondas al pasar un
   elemento (wake)** + reflejo; cardúmenes de peces; nieve realista.
