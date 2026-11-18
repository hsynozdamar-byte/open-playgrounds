// Soft Fluid render backend: a single WebGL context on the page; each orb is copied from it onto its own 2D canvas.
// This lets dozens of orbs draw at once (without hitting the browser's WebGL context limit). Orbs that are not visible are not drawn,
// and with reduced-motion on, the orb stays as a single frame (same identity, still).

export type FluidParams = {
  colors: string[]; // 1–6 color fields (hex)
  seed: number; // shape character: flow direction, curl, placement
  speed: number; // movement speed (0 = still)
  blur: number; // edge softness (feathered edge), 0–1
  noise: number; // film grain, 0–1
  deform: number; // organic deformation of the silhouette, 0–1
  warp: number; // curl of colors mixing into each other, 0–1
  glow: number; // low-intensity glow, 0–1
  spread: number; // spread of the color fields, 0–1
  // Agent states (0–1, interpolated in JS for a smooth transition)
  breathe: number;
  lean: [number, number];
  ripple: number;
  focus: number;
  orbit: number;
  layers?: number;
  ptr?: [number, number, number];   // uMode 4: pointer (orb units) and its effect 0-1   // uMode 4: ribbon count (Playgrounds 4, world 2)
  sat: number;
  lift: number;
  scale: number;
  mode: number; // 0 ribbon sphere, 1 grainy blob, 2 reference texture, 3 texture + user colors
  animated?: boolean;
};

// the uMode 4 canvas overflows by 15% in every direction, so the slime lobe stretches out without being clipped
export const PAD = 1.3;
export const DEFAULTS: FluidParams = {
  colors: ["#7c5cff"], seed: 1, speed: 1, blur: 0.15, noise: 0.15, deform: 0.5, warp: 0.5, glow: 0.1, spread: 0.6,
  breathe: 0, lean: [0, 0], ripple: 0, focus: 0, orbit: 0, sat: 1, lift: 0, scale: 1, mode: 0,
};

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;

// Two looks (uMode):
// 0 = Swirl sphere (Playgrounds logo, Rou): live color ribbons curling into each other inside a circle, colors drift over time,
//     the edge lightens to white and scatters, fine grain. Colors come from a cyclic palette C[0..N-1].
// 1 = Grainy blob (worlds): amorphous soft blob, two (or three) color gradient, the edge scatters with grain like spray.
const FRAG = `precision highp float;
const float PAD = 1.3;
uniform vec2 R; uniform float T; uniform float S; uniform float N; uniform float uMode;
uniform vec3 C[6];
uniform float uLayers;
uniform vec3 uPtr;   // pointer (orb units x, y) and its effect (z)
uniform float uBlur, uNoise, uDeform, uWarp, uGlow, uSpread, uRipple, uFocus, uOrbit, uSat, uLift, uScale;
uniform vec2 uLean;
uniform sampler2D uTex; uniform float uTexOk;

float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1., 0.)), u.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), u.x), u.y); }
float fbm(vec2 p){ float v = 0., a = .5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = m * p; a *= .5; } return v; }
vec3 pick(float i){ vec3 c = C[0];
  for (int k = 0; k < 6; k++) if (float(k) == i) c = C[k]; return c; }
vec3 pal(float x){ float n = max(N, 1.); float y = fract(x) * n; float i = floor(y);
  return mix(pick(i), pick(mod(i + 1., n)), smoothstep(0., 1., fract(y))); }

float cap(vec2 p, vec2 a, vec2 b, float ra, float rb){ vec2 ab = b - a; float h = clamp(dot(p - a, ab) / dot(ab, ab), 0., 1.); return length(p - a - ab * h) - mix(ra, rb, h); }
float smin(float a, float b, float k){ float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }
// Between two distant colors (cyan → yellow, say) it lightens to white without turning muddy
vec3 palW(float x){ float n = max(N, 1.); float y = fract(x) * n; float i = floor(y); float f = smoothstep(0., 1., fract(y));
  vec3 a = pick(i), b = pick(mod(i + 1., n)); return mix(mix(a, b, f), vec3(1.), 4. * f * (1. - f) * smoothstep(.7, 1.1, distance(a, b)) * .8); }
// ---- uMode 4: Playgrounds logo and world icons (developed from the first attempt) ----
// Colors mix in light-linear space (mix squares, then root): neighboring saturated colors do not turn muddy, they stay bright.
vec3 pigment(vec3 a, vec3 b, float k){ return sqrt(max(vec3(0.), mix(a * a, b * b, clamp(k, 0., 1.)))); }
mat2 rot2(float a){ return mat2(cos(a), -sin(a), sin(a), cos(a)); }
float ellipse(vec2 p, vec2 c, vec2 sz, float an){ vec2 q = rot2(an) * (p - c); return (length(q / sz) - 1.) * min(sz.x, sz.y); }
float spot(vec2 p, vec2 c, float s){ return exp(-dot(p - c, p - c) / s); }
float cmin(float a, float b, float k){ float h = max(k - abs(a - b), 0.) / k; return min(a, b) - h * h * k * .25; }
// A color volume overlaps the one below with a soft boundary; no white line at the boundary, volumes blend into each other
vec3 layer(vec3 under, vec3 col, float d, float w){
  return pigment(under, col, (1. - smoothstep(-w, w, d)) * .97);
}
// Shared color field: pigments cross layer boundaries, so the colors look like one liquid (first attempt)
void dye(inout vec3 c, inout float w, vec2 p, vec2 o, vec3 k, float s){ float e = exp(-dot(p - o, p - o) / s); c += k * k * e; w += e; }
vec3 shared(vec2 p, float t){
  vec3 c = vec3(0.); float w = 0.;
  dye(c, w, p, vec2(-.38, .08) + .13 * vec2(sin(t), cos(t)), vec3(.12, .015, 1.), .15);
  dye(c, w, p, vec2(.35, -.21) + .15 * vec2(cos(t), sin(t)), vec3(.015, .94, 1.), .16);
  dye(c, w, p, vec2(.42, .38) + .12 * vec2(sin(t + 1.5), cos(t)), vec3(1., .015, .54), .16);
  dye(c, w, p, vec2(-.48, -.43) + .12 * vec2(cos(t + 1.), sin(t)), vec3(1., .22, .015), .16);
  dye(c, w, p, vec2(-.32, .70) + .14 * vec2(sin(t), cos(t + 1.)), vec3(1., .58, .015), .14);
  dye(c, w, p, vec2(.17, .73) + .14 * vec2(cos(t), sin(t + 1.)), vec3(1., .91, .18), .12);
  dye(c, w, p, vec2(.55, -.54) + .13 * vec2(sin(t), cos(t)), vec3(.65, .025, 1.), .13);
  return sqrt(c / max(w, .0001));
}
// World icon: a two-color base behind, a single asymmetric S layer in front. Colors from the world's palette (C).
vec3 world2(vec2 q, float tp, float w0){
  vec3 a = C[0], b = N > 1.5 ? C[1] : C[0], c = N > 2.5 ? C[2] : b, d = pigment(a, vec3(1.), .18);
  float sh = .12 * sin(tp + S);
  vec3 col = pigment(a, b, smoothstep(-.55, .65, q.x + .27 * q.y + sh));
  col = pigment(col, a * a, spot(q, vec2(-.1 + .15 * sin(tp * .7 + S), .2), .18) * .55);       // deep pocket behind
  float line = -.3 * sin(3.1 * q.x + .25 + .35 * sin(tp * .8 + S)) + .06 * cos(tp + S);
  vec3 fr = pigment(c, d, smoothstep(-.5, .65, q.x + .28 * q.y - sh));
  fr = pigment(fr, vec3(1., .97, .92), spot(q, vec2(-.58 + .1 * sin(tp), .23), .095) * .38);    // wide light pools
  fr = pigment(fr, vec3(.9, .98, 1.), spot(q, vec2(.73, -.32 + .1 * cos(tp)), .085) * .25);
  return layer(col, fr, q.y - line, w0);
}
// Playgrounds logo (reference 64/65): rear membrane, upper-right petal, side fold, a bean in the middle where two volumes join, lower membrane.
// Each shape slowly drifts and changes form along its own path; layers pass through each other, the composition does not fall apart.
vec3 logo(vec2 q0, float tp, float w0){
  // Each layer moves in its own frame: the petal and side fold slide along the edge, the lower membrane rises and falls,
  // the blue bean orbits inside the sphere, its mass flows from one end to the other and bends in the middle.
  vec2 q = q0;
  vec2 m1 = .07 * vec2(sin(tp * .9), cos(tp * .7)), m3 = .06 * vec2(sin(tp * 1.1 + 3.), cos(tp * .5));
  vec3 col = vec3(1., .12, .53);
  col = pigment(col, vec3(1., .16, .01), spot(q, vec2(-.40, .65) + m3, .26));
  col = pigment(col, vec3(1., .86, .15), spot(q, vec2(0., .68) - m1, .10) * .97);
  col = pigment(col, vec3(.50, .025, 1.), spot(q, vec2(.65, -.15) + m1, .19));
  col = pigment(col, vec3(1., .94, 1.), spot(q, vec2(.10, .98), .10) * .93);
  vec2 qp = rot2(.18 * sin(tp * .4 + S)) * q;                                     // the petal slides along the edge
  float d = ellipse(qp, vec2(.63, .48), vec2(.38, .53) * (1. + .06 * sin(tp * .7)), .43 + .1 * sin(tp * .5));
  vec3 pe = pigment(vec3(.90, .08, 1.), vec3(.20, .83, 1.), spot(qp, vec2(.34, .69), .10));
  pe = pigment(pe, vec3(1., .86, .21), spot(qp, vec2(.72, .62), .14));
  pe = pigment(pe, vec3(1., .19, .46), spot(qp, vec2(.85, .22), .08));
  col = layer(col, pe, d, w0);
  vec2 qs = rot2(.16 * sin(tp * .33 + 2. + S)) * q;                                // side fold goes the other way
  d = ellipse(qs, vec2(-.53, -.30), vec2(.30, .52) * (1. + .07 * sin(tp * .9 + 1.)), -.19 + .1 * sin(tp * .6 + 2.));
  vec3 sd = pigment(vec3(1., .24, .025), vec3(.48, .015, .78), spot(qs, vec2(-.40, .02), .085));
  sd = pigment(sd, vec3(1., .90, .31), spot(qs, vec2(-.52, -.72), .08));
  col = layer(col, sd, d, w0);
  // Bean: slow oscillation (±20°) + slight drift, soft bend, mass flows between the ends; its form does not break
  float ob = .3 * sin(tp * .5 + S) + .08 * sin(tp * 1.3);
  vec2 qb = rot2(ob) * (q - .07 * vec2(sin(tp), cos(tp + 1.)));
  float bend = .3 * sin(tp + 1.) * exp(-dot(qb, qb) * 1.6);
  qb = rot2(bend) * qb;
  float flow = sin(tp);
  float d1 = ellipse(qb, vec2(-.43, .13), vec2(.34, .48) * (1. + .14 * flow), .30 + .12 * sin(tp + .5));
  float d2 = ellipse(qb, vec2(.18, -.25), vec2(.55, .28) * (1. - .1 * flow), .12 + .1 * sin(tp + 2.));
  d = cmin(d1, d2, .3);
  vec3 mi = pigment(vec3(.06, .85, 1.), vec3(.16, .035, 1.), smoothstep(.18, .96, spot(qb, vec2(-.41, .03) + .12 * vec2(sin(tp), cos(tp * .8)), .19)) * .99);
  mi = pigment(mi, vec3(.49, .025, 1.), spot(qb, vec2(-.22, -.36) + .1 * vec2(cos(tp * .9), sin(tp)), .08) * .82);
  mi = pigment(mi, vec3(.20, 1., .99), spot(qb, vec2(.43, -.31) - .1 * vec2(sin(tp * .7), cos(tp)), .09));
  mi = pigment(mi, vec3(1., .97, .61), spot(qb, vec2(.63, -.16), .06) * .87);
  col = layer(col, mi, d, w0);
  vec2 qd = q - vec2(.04 * sin(tp), .06 * sin(tp + 1.));              // lower membrane rises and falls
  float e1 = ellipse(qd, vec2(.01, -.62), vec2(.70, .43), -.13 + .08 * sin(tp));
  float e2 = ellipse(qd, vec2(.11, -.23), vec2(.53, .34), .04 + .1 * sin(tp + 2.));
  d = -cmin(-e1, e2, .09);
  vec3 bo = pigment(vec3(1., .14, .57), vec3(1., .20, .035), spot(qd, vec2(-.36, -.54), .13));
  bo = pigment(bo, vec3(1., .83, .21), spot(qd, vec2(.03, -.96), .11));
  bo = pigment(bo, vec3(.62, .19, 1.), spot(qd, vec2(.51, -.64), .07));
  col = layer(col, bo, d, w0);
  col = pigment(col, shared(q, tp), .24);
  // Restore saturation: after light-linear mixing the colors stay vivid (last step of the first attempt)
  float pk = max(col.r, max(col.g, col.b)), lo = min(col.r, min(col.g, col.b));
  float sat = (pk - lo) / max(pk, .001);
  float keep = spot(q, vec2(.56, -.2), .045) * .75 + spot(q, vec2(.1, .96), .09) * .75;
  vec3 hu = (col - vec3(lo)) / max(pk - lo, .001);
  return pk * mix(vec3(1.), hu, max(sat, .45 * (1. - clamp(keep, 0., 1.))));
}
// Wash sphere (layers 5): the soft color fields of the app background on the surface of a sphere. The fields are
// defined on the 3D sphere, the sphere turns slowly on a tilted axis, the fields squeeze at the edge and come back around from behind; the back
// hemisphere shows faintly under the front face (a glass sphere filled with colored mist). No glare.
// Like the app background: soft color fields overlap one after another on white (not normalized, no line at the boundary).
// Each field's edge sharpens from time to time (the clear separations in the brand visual); where two fields meet, a glittering white band opens.
vec3 wfield(vec3 P, float t, float sg, float st, inout float hl){
  vec3 c = vec3(1., .985, .99); float cov = 0.;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float th = fi * 2.399 + S + t * (.32 + .06 * fi), ph = .85 * sin(fi * 1.7 + t * (.31 + .05 * fi));
    vec3 o = vec3(cos(ph) * cos(th), sin(ph), cos(ph) * sin(th));
    float e = exp(-dot(P - o, P - o) / (sg + .07 * sin(t * .7 + fi)));
    float sh = smoothstep(.55, 1., sin(t * .45 + fi * 1.9 + S)) * .7;      // is this field sharp right now
    e = mix(e, smoothstep(.26, .5, e), sh);
    hl += 4. * e * (1. - e) * cov * (.35 + .65 * sh);                        // at the boundary, on top of the color below
    c = pigment(c, pick(mod(fi, max(N, 1.))), min(1., e * st));
    cov = max(cov, e);
  }
  return c;
}
vec3 washOrb(vec2 q, float t){
  t *= 1.35;                                                 // fields turn and flow faster
  float r2 = dot(q, q);
  float z = sqrt(max(0., 1. - r2));
  float a = .35 + .08 * sin(t * .4 + S);                      // tilted axis
  mat3 tilt = mat3(1., 0., 0., 0., cos(a), -sin(a), 0., sin(a), cos(a));
  vec3 P = tilt * vec3(q, z), B = tilt * vec3(q, -z);
  vec2 wq = .16 * vec2(sin(2.1 * P.y + t * 1.3), cos(2.3 * P.x - t * 1.1));   // fields also flow on their own as they turn
  P.xz += wq; B.xz -= wq;
  float big = smoothstep(60., 260., R.x);                    // on a small icon the fields are fuller: the color reads
  float vv = clamp((uGlow - .2) / .8, 0., 1.);               // Playgrounds logo: fuller and more saturated, separate from the worlds
  float sg = mix(.62, .55, big) + .14 * vv, st = 1.45 + .9 * vv;
  float hf = 0., hb = 0.;
  vec3 front = wfield(P, t, sg, st, hf), back = wfield(B, t, sg, st, hb);
  vec3 col = pigment(back, front, .8 + .2 * z);              // the back hemisphere seeps in at the edge too
  // Bring saturation back a little: light-linear mixing should not drift to pastel
  float pk = max(col.r, max(col.g, col.b)), lo = min(col.r, min(col.g, col.b));
  vec3 hu = (col - vec3(lo)) / max(pk - lo, .001);
  col = mix(col, pk * mix(vec3(1.), hu, min(1., (pk - lo) / max(pk, .001) * (1.25 + .6 * vv))), .7 + .3 * vv);
  float h = smoothstep(.05, .9, hf * (.8 + .2 * z)) * mix(.5, .85, big) * (1. - .3 * vv);
  float tw = h21(floor(gl_FragCoord.xy * .5) + floor(t * 6.)) ;            // glitter: an occasional shining grain in the band
  col = pigment(col, vec3(1., .995, 1.), h * (.85 + .2 * step(.93, tw)));
  col = pigment(col, vec3(1., .99, 1.), .12 * pow(z, 3.) * big * (1. - .6 * vv));   // middle slightly light, edge dense: volume
  return col;
}
vec3 ribbons(vec2 p, float t, float fl){
  // Pointer: color layers near it are pulled toward it and curl around it; the orb does not move from its place
  vec2 dq = p - uPtr.xy; float pf = uPtr.z * exp(-dot(dq, dq) * 2.6);
  float sa = pf * 1.1; p = uPtr.xy + rot2(sa) * dq * (1. - pf * .3);
  float tp = t * .08;                                       // ~14 s main lap
  vec2 q = p / .93;                                         // 1 = sphere edge
  float k = .6 + fl * .7;
  q = rot2(.1 * k * sin(tp + S)) * q;
  q += k * .08 * vec2(sin(2.7 * q.y + tp + S), sin(2.4 * q.x - tp + S));
  q += k * .025 * vec2(sin(4. * q.x + 2. * q.y + 2. * tp), cos(3. * q.y - q.x - 2. * tp));
  float w0 = .02 + uBlur * .05;
  if (uLayers > 4.5) return washOrb(p / .93, tp);
  vec3 col = uLayers < 2.5 ? world2(q, tp, w0) : logo(q + k * .06 * vec2(sin(3.2 * q.y + tp), cos(3.1 * q.x - tp)), tp, w0);
  // Wide scattering toward the edge: the sphere emits light from inside (not tied to the line of the curls)
  float r = length(q), an = atan(q.y, q.x);
  col = pigment(col, vec3(1., .99, 1.), clamp(pow(smoothstep(.74, 1.06, r), 1.6) * (.44 + .17 * sin(an * 2. + .6)) + spot(q, vec2(-.22, -.97), .11) * .3, 0., .75));
  return col;
}

void main(){
  vec2 uv = ((gl_FragCoord.xy / R) * 2. - 1.) / .94;
  if (uMode > 3.5) uv *= PAD;                                // room on the canvas for the lobe to stretch (the orb stays the same size)
  uv.y -= uLift * .08;
  uv -= uLean * .1;
  uv /= uScale;
  float t = T, r = length(uv);
  vec2 dir = uv / max(r, 1e-4);
  float gr = h21(gl_FragCoord.xy * .73 + S);
  vec3 col; float a;

  if (uMode < .5) {
    // Swirl sphere (reference): 5 thick ribbons flowing in an S shape, stacked from top to bottom (the bottom one in front).
    // One edge of each ribbon is deep/dark, the other lightens to white; color shifts along the ribbon; gaps stay white.
    float edgeW = 1. + uDeform * .05 * (vnoise(dir * 1.4 + vec2(t * .08, S)) - .5) + uRipple * .04 * sin(atan(uv.y, uv.x) * 5. + t * 2.);
    float ang = -.5 + .12 * sin(t * .05 + S) + uOrbit * t * .4;
    mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    vec2 pr = rot * uv * (1. - uFocus * .2);
    col = mix(vec3(1.), pal(S * .1 + pr.y * .35 + t * .02 + .5), .38); float cov = 0.;   // the sphere's pastel body
    float spread = .38 * (.8 + uSpread * .25);
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float ph = S * 1.3 + fi * .55 + t * .3 + .5 * sin(t * (.09 + .025 * fi) + fi);
      float cy = (fi - 2.) * spread + .05 * sin(t * (.13 + .03 * fi) + fi);
      float amp = (.19 + .07 * uWarp) * (1. + .2 * sin(t * (.09 + .02 * fi) + fi * 2.));
      float cl = cy + amp * sin(pr.x * 1.8 + ph) + .045 * sin(pr.x * 3.3 - ph * .8 + fi) + (fi - 2.) * .12 * pr.x * pr.x;
      float w = .3 + .03 * sin(t * .17 + fi * 2.3);
      float d = pr.y - cl;
      float sdn = d / w;                                   // -1 bottom edge, +1 top edge
      // A ribbon is not infinite: it ends with rounded tips (the ribbons in the reference that curl and end)
      float xo = .3 * sin(fi * 2.1 + S + t * .04), L = .78 + .15 * sin(t * .11 + fi * 1.7);
      float cap = length(vec2(max(abs(pr.x - xo) - L, 0.) / w, sdn));
      float m = 1. - smoothstep(.84, 1.0, cap);
      float sh = (1. - smoothstep(1., 1.5, cap)) * (1. - m) * cov;    // soft, colored shadow on the previous ribbon
      col = mix(col, col * vec3(.72, .62, .85), sh * .6);
      vec3 c = pal(S * .1 + fi * .23 + pr.x * .32 + t * .03);
      vec3 deep = c * vec3(.55, .45, .75);
      vec3 rc = mix(deep, c, smoothstep(-1., -.1, sdn));
      rc = mix(rc, vec3(1.), smoothstep(.35, 1., sdn) * .7);
      col = mix(col, rc, m); cov = max(cov, m);
    }
    col = mix(col, vec3(1., .97, .99), .1 + .12 * (1. - cov));             // the white haze from the reference
    float R0 = .93 * edgeW;
    float feather = .025 + uBlur * .12;
    col = mix(col, vec3(1.), smoothstep(R0 - .12, R0, r) * .25);
    a = 1. - smoothstep(R0 - feather, R0 + feather * .3, r);
    a = clamp(a + (gr - .5) * uNoise * .5 * (1. - a) * a * 4., 0., 1.);
    col += (gr - .5) * uNoise * .12;
  } else if (uMode > 4.5) {
    // 5 = Rou: the color field of the reference ghost. The silhouette comes from a CSS mask (public/brand/rou-mask.svg, extracted
    // from the reference image); only the inner color is drawn here, in the reference's pixel layout (720 px box, 141 px corner).
    // White light in the middle; below a cream → mint → cyan ring; lilac edge (pink at the top, blue at the sides, purple at the bottom).
    // On Rous with a chosen color the colors are pastels of that color; the Playgrounds Rou (uGlow 1) is painted with the logo's colors.
    vec2 s01 = gl_FragCoord.xy / R;
    vec2 I = vec2(141. + s01.x * 720., 141. + (1. - s01.y) * 720.);
    float tp = t * .08;
    vec2 d = (I - vec2(500., 450.)) / vec2(300., 330.);
    d += (.035 + .03 * uFocus) * vec2(sin(tp * 5. + d.y * 3. + S), cos(tp * 4. + d.x * 3.));
    d *= 1. + .04 * uRipple * sin(t * 5.);
    float r = length(d), an = atan(d.x, -d.y);                                    // an: 0 top, ±pi bottom
    float n = max(N, 2.);
    vec3 cY = pigment(pick(n - 1.), vec3(1.), .72), cC = pigment(pick(max(0., n - 2.)), vec3(1.), .5);
    vec3 cB = pigment(pick(max(0., n - 3.)), vec3(1.), .55), cV = pigment(pick(max(0., n - 4.)), vec3(1.), .48);
    vec3 cP = pigment(pick(min(1., n - 1.)), vec3(1.), .55);
    float lower = smoothstep(-.12, .42, d.y);
    float side = smoothstep(.5, 1.4, abs(an)) * (1. - smoothstep(2.3, 3., abs(an)));
    // Lower half: white → cream → mint → cyan → blue-lilac → purple (rainbow arc)
    vec3 mint = pigment(mix(cY, cC, .5), vec3(1.), .25);
    vec3 lo = vec3(1.);
    float rl = r / 1.2;
    lo = mix(lo, cY, smoothstep(.12, .32, rl));
    lo = mix(lo, mint, smoothstep(.38, .56, rl));
    lo = mix(lo, cC, smoothstep(.55, .74, rl));
    lo = mix(lo, mix(cB, cV, .4), smoothstep(.74, .9, rl));
    lo = mix(lo, mix(cV, cB, side * .6), smoothstep(.88, 1.02, rl));
    // Upper half: white → pinkish white → pink-lilac, blue-lilac at the sides
    vec3 up = vec3(1.);
    up = mix(up, pigment(cP, vec3(1.), .65), smoothstep(.3, .58, r));
    up = mix(up, mix(mix(cP, cV, .15), mix(cV, cB, .55), side), smoothstep(.58, .9, r));
    col = mix(up, lo, lower);
    col = mix(col, vec3(1.), exp(-dot(d - vec2(0., -.08), d - vec2(0., -.08)) / .035) * .5);
    if (uGlow > .5) {
      // Playgrounds Rou: the body is painted with the logo's own wash sphere (same seed, speed, shared clock: the same
      // colors as the logo flow at the same time); the area around the face lightens slightly so the eyes read
      col = washOrb(d * vec2(.8, .78), tp);
      col = pigment(col, vec3(1.), .22 * exp(-dot(d + vec2(0., .3), d + vec2(0., .3)) / .12));
    }
    a = 1.;
    col += (gr - .5) * uNoise * .02;
  } else if (uMode > 3.5) {
    // 4 = Procedural ribbon sphere (reference 62): no image, the ribbons flow live. The silhouette breathes 3-6%, no rotation.
    // Separation is slime-like: a lobe stretches from the edge, its neck thins and stretches like a string, it breaks in the middle; the drop shrinks away, the stub retracts.
    float an = atan(uv.y, uv.x);
    vec2 d2 = vec2(cos(an), sin(an));
    float sn = (vnoise(d2 * 1.2 + vec2(t * .12, S)) - .5) + .6 * (vnoise(d2 * 2.4 + vec2(-t * .1, S + 3.)) - .5);
    // Edge wave: two or three slow lobes stretch the body like liquid (not a perfect circle)
    float wv = .045 * sin(an * 2. + t * .21 + S) + .035 * sin(an * 3. - t * .17 + S * 1.7);
    float kf = 1. + uDeform * (.22 * sn + wv * 1.6) + uRipple * .035 * sin(an * 6. + t * 2.2) + dot(d2, uLean) * .04;
    vec2 pp = uv / kf;
    float rr = length(pp) / .93;                               // 1 = sphere edge
    float fl = uWarp * (1. + uFocus * 1.2);
    float sd = (rr - 1.) * .93 * kf;                           // signed distance of the body
    vec2 sp = pp;
    for (int k = 0; k < 2; k++) {
      float fk = float(k);
      float cyc = t * .005 + fk * .5 + S * .1;
      float u = fract(cyc) / .3;                               // ~30% of the cycle is the event (about every 35 s), the rest is calm
      if (u < 1. && uSpread > .001) {
        float th = S * 2. + fk * 2.6 + floor(cyc) * 1.7;
        vec2 e = vec2(cos(th), sin(th));
        float grow = smoothstep(0., .7, u);
        float pinch = smoothstep(.5, .8, u) * 1.3;          // >1 and the neck breaks in the middle
        float fade = 1. - smoothstep(.8, 1., u);
        float rd = (.09 + .19 * smoothstep(0., .35, u)) * (1. - .35 * smoothstep(.3, .8, u)) * mix(1., fade, .9) * uSpread;
        vec2 A = e * .74, B = e * (.84 + .46 * grow * (.6 + .4 * uSpread));
        vec2 ab = B - A; float h = clamp(dot(uv - A, ab) / dot(ab, ab), 0., 1.);
        float rn = mix(.34, rd * .85, h) * (1. - pinch * 4. * h * (1. - h)) * (1. - smoothstep(.78, .97, u)) * uSpread;
        float neck = length(uv - A - ab * h) - rn + .09 * (1. - smoothstep(.02, .07, rn));   // the thinning neck vanishes, no hair-like stick is left
        float drop = length(uv - B) - rd;
        float kk = .12 * (1. - .6 * smoothstep(.55, .85, u));
        float lobe = smin(neck, drop, kk * .6);
        float sd2 = smin(sd, lobe, kk);
        // Colors inside the lobe are pulled out of the body
        float inf = smoothstep(.06, -.04, lobe);
        sp -= e * (uLayers > 4.5 ? max(0., dot(uv, e) - .5) * .95 : max(0., dot(uv, e) - .8) * .85) * inf;   // in the wash sphere the drop takes color from inside the body
        sd = sd2;
      }
    }
    float z = sqrt(max(0., 1. - rr * rr));
    col = ribbons(sp * (1.15 - .3 * z), t, fl);                // at the edge the ribbons squeeze: sphere volume
    col = mix(col, vec3(1., .98, .99), .03);
    a = 1. - smoothstep(-.015 - uBlur * .07, .01, sd);
    a = clamp(a + (gr - .5) * uNoise * .5 * (1. - a) * a * 4., 0., 1.);
    col += (gr - .5) * uNoise * .13;
  } else if (uMode > 1.5) {
    // 2 = the reference image itself comes alive (texture warp); 3 = the same structure with the user's colors (world, agent).
    // The silhouette breathes 3-6% by angle, inside a two-layer field warp makes the color layers flow through each other,
    // rarely a liquid mass separates from the edge and merges back. No rotation, grain is fixed (does not flicker).
    float an = atan(uv.y, uv.x);
    vec2 d2 = vec2(cos(an), sin(an));
    float sn = (vnoise(d2 * 1.2 + vec2(t * .12, S)) - .5) + .6 * (vnoise(d2 * 2.4 + vec2(-t * .1, S + 3.)) - .5);
    float kf = 1. + uDeform * .1 * sn + uRipple * .035 * sin(an * 6. + t * 2.2) + dot(d2, uLean) * .04;
    vec2 pp = uv / kf;
    float fl = uWarp * (1. + uFocus * 1.2);
    // Local swirl: layers near the center curl around each other (the whole form does not rotate)
    float tw = fl * .55 * sin(t * .16 + S) * exp(-dot(pp, pp) * 1.6) + fl * .25 * sin(t * .11 + 2. + S) * exp(-dot(pp - vec2(.35, -.2), pp - vec2(.35, -.2)) * 4.);
    vec2 sw = mat2(cos(tw), -sin(tw), sin(tw), cos(tw)) * pp;
    vec2 w1 = vec2(fbm(sw * 1.4 + vec2(t * .15, S)), fbm(sw * 1.4 + vec2(S + 4.1, -t * .13))) - .5;
    vec2 w2 = vec2(fbm(sw * 2.2 + w1 * 2.2 + vec2(-t * .11, 1.3)), fbm(sw * 2.2 + w1 * 2.2 + vec2(7.7, t * .12))) - .5;
    vec2 q = sw + fl * (.26 * w1 + .16 * w2);
    const float TR = .41;                                   // in the reference the orb radius is ~.39 (texture units)
    vec2 tuv = vec2(.504 + q.x * TR, .498 - q.y * TR);
    vec3 tc = texture2D(uTex, tuv).rgb;
    float rr = length(pp) * TR / .39;                        // 1 = reference orb edge
    float mx = max(tc.r, max(tc.g, tc.b)), mn = min(tc.r, min(tc.g, tc.b));
    float aT = smoothstep(.035, .2, (mx - mn) + (1. - mn) * .55);
    float inner = 1. - smoothstep(.72, .93, rr);
    a = max(aT, inner) * (1. - smoothstep(.97 - uBlur * .08, 1.03, rr));
    col = tc;
    // Rare separation: two possible masses, asleep most of the time
    for (int k = 0; k < 2; k++) {
      float fk = float(k);
      float env = smoothstep(.62, 1., sin(t * .045 + S + fk * 3.3)) * uSpread;
      if (env > .001) {
        float th = S * 2. + fk * 2.6 + .25 * sin(t * .02 + fk);
        vec2 e = vec2(cos(th), sin(th));
        vec2 dp = e * (.82 + env * .32);
        float rd = .13 * (1. - .35 * env);
        float fd = rd * rd / max(dot(uv - dp, uv - dp), 1e-4);
        float ad = smoothstep(.7, 1.35, fd + max(0., 1.08 - rr) * 1.4);
        vec2 src = e * .55 + (uv - dp) * .8;
        vec3 dc = texture2D(uTex, vec2(.504 + src.x * TR, .498 - src.y * TR)).rgb;
        col = mix(col, dc, ad * (1. - a));
        a = max(a, ad);
      }
    }
    if (uMode > 2.5) {
      // User colors: the texture's tone structure is kept, the colors are mapped to the user's palette
      float sat = (mx - mn) / max(mx, 1e-3);
      vec3 k4 = vec3(0., -1. / 3., 2. / 3.);
      vec4 pq = mix(vec4(tc.bg, -1., 2. / 3.), vec4(tc.gb, 0., -1. / 3.), step(tc.b, tc.g));
      vec4 qq = mix(vec4(pq.xyw, tc.r), vec4(tc.r, pq.yzx), step(pq.x, tc.r));
      float dd = qq.x - min(qq.w, qq.y);
      float hue = abs(qq.z + (qq.w - qq.y) / (6. * dd + 1e-10));
      vec3 pc = pal(hue + S * .05);
      col = mix(vec3(1.), pc * mix(.75, 1.05, mx), clamp(sat * 1.15, 0., 1.));
    }
    col = mix(vec3(1.), col, uTexOk);
    a *= uTexOk;
    col += (gr - .5) * uNoise * .07;
  } else {
    // Grainy blob: amorphous form, color transition along an axis, spray edge
    vec2 c = .08 * vec2(sin(t * .09 + S), cos(t * .07 + S * 1.7));
    vec2 d = uv - c; float rr = length(d); vec2 dd = d / max(rr, 1e-4);
    float shape = 1. + uDeform * .32 * (fbm(dd * 1.1 + vec2(t * .06 + S, S * 2.)) - .5) * 2.;
    float re = rr / (.84 * shape);
    float base = 1. - smoothstep(.62 - uBlur * .3, 1.02, re);
    float ang = S * 2.1 + .5 * sin(t * .05 + S);
    vec2 ax = vec2(cos(ang), sin(ang));
    float g = clamp(dot(d, ax) * .75 + .5 + uWarp * .25 * (vnoise(uv * 1.6 + t * .05 + S) - .5), 0., 1.);
    col = mix(C[0], N >= 2. ? C[1] : mix(C[0], vec3(1.), .5), smoothstep(.1, .9, g));
    if (N >= 3.) {
      vec2 sp = .35 * vec2(sin(t * .11 + S * 3.), cos(t * .09 + S));
      col = mix(col, C[2], exp(-dot(uv - sp, uv - sp) / .12) * .8);
    }
    col = mix(col, vec3(1.), (1. - base) * .25);
    float spray = step(gr, base);                                         // spray: grains at the edge fade out one by one
    a = mix(base, spray * min(1., base * 1.4), clamp(uNoise * 1.2, 0., 1.) * (1. - smoothstep(.45, .85, base)));
    col += (gr - .5) * uNoise * .1;
  }
  float l = dot(col, vec3(.299, .587, .114));
  col = clamp(mix(vec3(l), col, uSat), 0., 1.);
  a = clamp(a, 0., 1.);
  gl_FragColor = vec4(col * a, a);
}`;

type Entry = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  get: () => FluidParams;
  t: number;
  px: number;
  visible: boolean;
  still: boolean;
  tick?: number;
  dirty: boolean;
  cur?: FluidParams; // parameters interpolated for state transitions
};

let gl: WebGLRenderingContext | null = null;
let glCanvas: HTMLCanvasElement;
let prog: WebGLProgram;
const U: Record<string, WebGLUniformLocation | null> = {};
const entries = new Set<Entry>();
let raf = 0;
let last = 0;
let failed = false;
const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
let forceStill = false;
export function setStill(v: boolean) { forceStill = v; entries.forEach((e) => (e.dirty = true)); kick(); }

function init() {
  if (gl || failed) return !!gl;
  glCanvas = document.createElement("canvas");
  const c = glCanvas.getContext("webgl", { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, alpha: true });
  if (!c) { failed = true; return false; }
  gl = c;
  const sh = (type: number, src: string) => { const s = c.createShader(type)!; c.shaderSource(s, src); c.compileShader(s);
    if (!c.getShaderParameter(s, c.COMPILE_STATUS)) console.error(c.getShaderInfoLog(s)); return s; };
  prog = c.createProgram()!;
  c.attachShader(prog, sh(c.VERTEX_SHADER, VERT)); c.attachShader(prog, sh(c.FRAGMENT_SHADER, FRAG)); c.linkProgram(prog); c.useProgram(prog);
  const b = c.createBuffer(); c.bindBuffer(c.ARRAY_BUFFER, b);
  c.bufferData(c.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), c.STATIC_DRAW);
  const loc = c.getAttribLocation(prog, "p"); c.enableVertexAttribArray(loc); c.vertexAttribPointer(loc, 2, c.FLOAT, false, 0, 0);
  for (const n of ["R", "T", "S", "N", "uMode", "uTex", "uTexOk", "C", "uBlur", "uNoise", "uDeform", "uWarp", "uGlow", "uSpread", "uRipple", "uFocus", "uOrbit", "uSat", "uLift", "uScale", "uLean", "uLayers", "uPtr"])
    U[n] = c.getUniformLocation(prog, n);
  c.clearColor(0, 0, 0, 0);
  // Texture slot: uMode 2/3 (reference texture) is no longer used; an empty white texture stays bound.
  const tex = c.createTexture(); c.bindTexture(c.TEXTURE_2D, tex);
  c.texImage2D(c.TEXTURE_2D, 0, c.RGBA, 1, 1, 0, c.RGBA, c.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  return true;
}
let texOk = 0;

export function hexRgb(h: string): [number, number, number] {
  const s = h.replace("#", ""); const n = parseInt(s.length === 3 ? s.replace(/./g, (x) => x + x) : s, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function draw(e: Entry) {
  const c = gl!;
  const w = e.canvas.width, h = e.canvas.height;
  if (!w || !h) return;
  if (glCanvas.width < w || glCanvas.height < h) { glCanvas.width = Math.max(glCanvas.width, w); glCanvas.height = Math.max(glCanvas.height, h); }
  const p = e.cur!;
  c.viewport(0, 0, w, h);
  c.clear(c.COLOR_BUFFER_BIT);
  c.uniform2f(U.R, w, h); c.uniform1f(U.T, e.t); c.uniform1f(U.S, (p.seed % 97) * 0.131);
  const cols = p.colors.slice(0, 6); c.uniform1f(U.N, cols.length);
  const flat = new Float32Array(18); for (let i = 0; i < 6; i++) flat.set(hexRgb(cols[i % cols.length] || "#888888"), i * 3); c.uniform3fv(U.C, flat);
  // On a small size (top bar, list) the shape stays fuller; on a large one the lobes are free
  const small = Math.max(0.3, Math.min(1, (e.px - 16) / 110));
  c.uniform1f(U.uBlur, p.blur); c.uniform1f(U.uNoise, p.noise); c.uniform1f(U.uDeform, p.deform * (0.75 + small * 0.25));   // a small icon also undulates, not a perfect circle c.uniform1f(U.uWarp, p.warp * (1 + (1 - small) * 1.6));   // on a small icon the inner flow is wider: visible at 22-30 px too
  c.uniform1f(U.uGlow, p.glow); c.uniform1f(U.uSpread, p.spread * (0.5 + small * 0.5)); c.uniform1f(U.uRipple, p.ripple); c.uniform1f(U.uFocus, p.focus);
  c.uniform1f(U.uLayers, p.layers ?? 4); c.uniform3f(U.uPtr, p.ptr?.[0] ?? 0, p.ptr?.[1] ?? 0, p.ptr?.[2] ?? 0); c.uniform1f(U.uOrbit, p.orbit); c.uniform1f(U.uSat, p.sat); c.uniform1f(U.uLift, p.lift); c.uniform1f(U.uScale, p.scale * (1 + p.breathe));
  c.uniform2f(U.uLean, p.lean[0], p.lean[1]); c.uniform1f(U.uMode, p.mode); c.uniform1i(U.uTex, 0); c.uniform1f(U.uTexOk, texOk);
  c.drawArrays(c.TRIANGLE_STRIP, 0, 4);
  e.ctx.clearRect(0, 0, w, h);
  e.ctx.drawImage(glCanvas, 0, glCanvas.height - h, w, h, 0, 0, w, h);
}

// Frame rate: the flow is slow 8-15 s laps, 30 frames is enough; 8 frames when the window is in the background (for GPU and battery).
const FPS_ON = 30, FPS_BG = 8;
function frame(now: number) {
  raf = 0;
  const gap = 1000 / (document.hasFocus() ? FPS_ON : FPS_BG);
  let dirty = false;
  for (const e of entries) if (e.dirty) { dirty = true; break; }
  // If woken early, it sleeps until the next frame (it does not wake 60 times when idle).
  if (now - last < gap - 2 && !dirty) { raf = -1; setTimeout(() => { raf = 0; kick(); }, gap - (now - last)); return; }
  const dt = Math.min(0.15, (now - last) / 1000 || 0); last = now;
  const still = forceStill || reduced();
  if (!still) clock += dt;
  let anyMoving = false;
  for (const e of entries) {
    const target = e.get();
    if (!e.cur || still) e.cur = { ...target, lean: [...target.lean] };
    else {
      // Smooth transition: when the state changes, parameters flow to the target in ~0.8 s, no sudden jump
      const k = 1 - Math.exp(-dt * 3);
      const c = e.cur;
      for (const key of ["blur", "noise", "deform", "warp", "glow", "spread", "breathe", "ripple", "focus", "orbit", "sat", "lift", "scale", "speed"] as const)
        c[key] = lerp(c[key], target[key], k);
      c.lean = [lerp(c.lean[0], target.lean[0], k), lerp(c.lean[1], target.lean[1], k)];
      c.colors = target.colors; c.seed = target.seed; c.mode = target.mode; c.layers = target.layers; c.ptr = target.ptr;
    }
    // Time scale: at speed 1 the color fields take ~8-15 s laps; slow but visibly flowing
    if (!still && target.animated !== false) e.t += dt * e.cur.speed * 4;
    if (e.visible && (!still || e.dirty)) { draw(e); e.dirty = false; }
    if (!still && e.visible) anyMoving = true;
  }
  if (anyMoving) kick();
}
// Shared clock: icons of the same world (top bar, page title, lists) make the same movement at the same time whenever they open
let clock = 0;
function kick() { if (!raf && entries.size) raf = requestAnimationFrame(frame); }

const io = typeof IntersectionObserver !== "undefined"
  ? new IntersectionObserver((list) => { for (const it of list) { const e = (it.target as any).__fluid as Entry | undefined; if (e) { e.visible = it.isIntersecting; e.dirty = true; } } kick(); })
  : null;

export function mount(canvas: HTMLCanvasElement, get: () => FluidParams, px: number) {
  if (!init()) return { update() {}, destroy() {}, ok: false };
  // On big orbs the pixel count is limited (~1100 px edge): the giant sphere on the welcome screen also turns smoothly
  const dpr = Math.min(2, window.devicePixelRatio || 1, 1100 / Math.max(1, px));
  canvas.width = Math.round(px * dpr); canvas.height = Math.round(px * dpr);
  const e: Entry = { canvas, ctx: canvas.getContext("2d")!, get, t: (get().seed % 50) * 3.7 + clock * get().speed * 4, px, visible: true, still: false, dirty: true };
  (canvas as any).__fluid = e;
  entries.add(e); io?.observe(canvas); last = performance.now(); kick();
  return {
    ok: true,
    update() { e.dirty = true; kick(); },
    destroy() { entries.delete(e); io?.unobserve(canvas); },
  };
}
