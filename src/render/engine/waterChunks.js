// Chunks GLSL procedurales del AGUA de la poza. Strings puros (sin three): el
// shader del techo y los materiales de lecho/roca los concatenan para compartir
// EXACTAMENTE las mismas funciones. El consumidor SIEMPRE antepone
// HASH_NOISE_FBM (del que dependen caustics() y rippleNormal()).
// Ver docs/superpowers/specs/2026-08-13-agua-poza-procedural-design.md §1.

// Hash + value noise + fBm. Base de todo lo procedural.
export const HASH_NOISE_FBM = /* glsl */ `
  float hash21(vec2 p){
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p, int oct){
    float v = 0.0, amp = 0.5;
    for (int i = 0; i < 6; i++){
      if (i >= oct) break;
      v += amp * vnoise(p);
      p *= 2.03; amp *= 0.5;
    }
    return v;
  }
`

// Una ola Gerstner: desplaza (x,y,z) y acumula la normal analítica en `nrm`.
export const GERSTNER = /* glsl */ `
  vec3 gerstnerWave(vec2 p, float t, vec2 dir, float wavelength, float amp, float steep, inout vec3 nrm){
    float k = 6.2831853 / max(wavelength, 0.001);
    float c = sqrt(9.8 / k);
    vec2 d = normalize(dir);
    float f = k * (dot(d, p) - c * t);
    float a = amp;
    float qz = steep / (k * a + 1e-4);
    float cf = cos(f), sf = sin(f);
    // Aporte a la normal (derivadas parciales de la superficie Gerstner).
    nrm.x += -d.x * k * a * cf;
    nrm.z += -d.y * k * a * cf;
    nrm.y += -qz * k * a * sf;
    return vec3(qz * a * d.x * cf, a * sf, qz * a * d.y * cf);
  }
`

// Red de cáusticas animada (2 capas desfasadas). Requiere fbm (anteponer HASH_NOISE_FBM).
export const CAUSTIC_FIELD = /* glsl */ `
  float caustics(vec2 p, float t){
    vec2 a = p + vec2(t * 0.9, t * 0.6);
    vec2 b = p * 1.7 - vec2(t * 0.5, t * 0.8);
    float n1 = fbm(a, 3);
    float n2 = fbm(b, 3);
    // Bordes brillantes tipo red de luz: realzar las crestas del ruido.
    float c = abs(n1 - n2);
    c = pow(1.0 - clamp(c * 2.2, 0.0, 1.0), 3.0);
    return c;
  }
`

// Normal fina del rizado, derivada de fBm por diferencias finitas. Requiere fbm.
export const PROC_NORMAL = /* glsl */ `
  vec3 rippleNormal(vec2 p, float t, float strength){
    float e = 0.35;
    vec2 q = p * 0.5 + vec2(t * 0.4, -t * 0.3);
    float h  = fbm(q, 3);
    float hx = fbm(q + vec2(e, 0.0), 3);
    float hz = fbm(q + vec2(0.0, e), 3);
    return normalize(vec3(-(hx - h) * strength, 1.0, -(hz - h) * strength));
  }
`
