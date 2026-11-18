"use strict";(()=>{var w={colors:["#7c5cff"],seed:1,speed:1,blur:.15,noise:.15,deform:.5,warp:.5,glow:.1,spread:.6,breathe:0,lean:[0,0],ripple:0,focus:0,orbit:0,sat:1,lift:0,scale:1,mode:0},B="attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }",D=`precision highp float;
const float PAD = 1.3;
uniform vec2 R; uniform float T; uniform float S; uniform float N; uniform float uMode;
uniform vec3 C[6];
uniform float uLayers;
uniform vec3 uPtr;   // imle\xE7 (orb birimi x, y) ve etkisi (z)
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
// Uzak iki renk aras\u0131 (camg\xF6be\u011Fi \u2192 sar\u0131 gibi) \xE7amurla\u015Fmadan beyaza a\xE7\u0131larak ge\xE7er
vec3 palW(float x){ float n = max(N, 1.); float y = fract(x) * n; float i = floor(y); float f = smoothstep(0., 1., fract(y));
  vec3 a = pick(i), b = pick(mod(i + 1., n)); return mix(mix(a, b, f), vec3(1.), 4. * f * (1. - f) * smoothstep(.7, 1.1, distance(a, b)) * .8); }
// ---- uMode 4: Playgrounds logosu ve d\xFCnya ikonlar\u0131 (ilk denemeden geli\u015Ftirildi) ----
// Renkler \u0131\u015F\u0131k-do\u011Frusal kar\u0131\u015F\u0131r (karelerde kar\u0131\u015Ft\u0131r\u0131p k\xF6k): kom\u015Fu doygun renkler \xE7amurla\u015Fmaz, parlak kal\u0131r.
vec3 pigment(vec3 a, vec3 b, float k){ return sqrt(max(vec3(0.), mix(a * a, b * b, clamp(k, 0., 1.)))); }
mat2 rot2(float a){ return mat2(cos(a), -sin(a), sin(a), cos(a)); }
float ellipse(vec2 p, vec2 c, vec2 sz, float an){ vec2 q = rot2(an) * (p - c); return (length(q / sz) - 1.) * min(sz.x, sz.y); }
float spot(vec2 p, vec2 c, float s){ return exp(-dot(p - c, p - c) / s); }
float cmin(float a, float b, float k){ float h = max(k - abs(a - b), 0.) / k; return min(a, b) - h * h * k * .25; }
// Bir renk hacmi alttakinin \xFCst\xFCne yumu\u015Fak bir s\u0131n\u0131rla biner; s\u0131n\u0131rda beyaz \xE7izgi yok, hacimler birbirine kar\u0131\u015F\u0131r
vec3 layer(vec3 under, vec3 col, float d, float w){
  return pigment(under, col, (1. - smoothstep(-w, w, d)) * .97);
}
// Ortak renk alan\u0131: pigmentler katman s\u0131n\u0131rlar\u0131n\u0131 a\u015Far, renkler tek bir s\u0131v\u0131ya ait g\xF6r\xFCn\xFCr (ilk deneme)
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
// D\xFCnya ikonu: arkada iki renkli zemin, \xF6nde tek, asimetrik bir S katman\u0131. Renkler d\xFCnyan\u0131n paletinden (C).
vec3 world2(vec2 q, float tp, float w0){
  vec3 a = C[0], b = N > 1.5 ? C[1] : C[0], c = N > 2.5 ? C[2] : b, d = pigment(a, vec3(1.), .18);
  float sh = .12 * sin(tp + S);
  vec3 col = pigment(a, b, smoothstep(-.55, .65, q.x + .27 * q.y + sh));
  col = pigment(col, a * a, spot(q, vec2(-.1 + .15 * sin(tp * .7 + S), .2), .18) * .55);       // arkada derin cep
  float line = -.3 * sin(3.1 * q.x + .25 + .35 * sin(tp * .8 + S)) + .06 * cos(tp + S);
  vec3 fr = pigment(c, d, smoothstep(-.5, .65, q.x + .28 * q.y - sh));
  fr = pigment(fr, vec3(1., .97, .92), spot(q, vec2(-.58 + .1 * sin(tp), .23), .095) * .38);    // geni\u015F \u0131\u015F\u0131k havuzlar\u0131
  fr = pigment(fr, vec3(.9, .98, 1.), spot(q, vec2(.73, -.32 + .1 * cos(tp)), .085) * .25);
  return layer(col, fr, q.y - line, w0);
}
// Playgrounds logosu (referans 64/65): arka zar, sa\u011F \xFCst yaprak, yan k\u0131vr\u0131m, ortada iki hacmin birle\u015Fti\u011Fi fasulye, alt zar.
// Her \u015Fekil kendi yolunda yava\u015F\xE7a kayar ve bi\xE7im de\u011Fi\u015Ftirir; katmanlar birbirinin i\xE7inden ge\xE7er, kompozisyon da\u011F\u0131lmaz.
vec3 logo(vec2 q0, float tp, float w0){
  // Her katman kendi \xE7er\xE7evesinde hareket eder: yaprak ve yan k\u0131vr\u0131m kenar boyunca kayar, alt zar y\xFCkselip al\xE7al\u0131r,
  // mavi fasulye k\xFCre i\xE7inde y\xF6r\xFCngede dola\u015F\u0131r, k\xFCtlesi bir ucundan \xF6b\xFCr\xFCne akar ve ortadan b\xFCk\xFCl\xFCr.
  vec2 q = q0;
  vec2 m1 = .07 * vec2(sin(tp * .9), cos(tp * .7)), m3 = .06 * vec2(sin(tp * 1.1 + 3.), cos(tp * .5));
  vec3 col = vec3(1., .12, .53);
  col = pigment(col, vec3(1., .16, .01), spot(q, vec2(-.40, .65) + m3, .26));
  col = pigment(col, vec3(1., .86, .15), spot(q, vec2(0., .68) - m1, .10) * .97);
  col = pigment(col, vec3(.50, .025, 1.), spot(q, vec2(.65, -.15) + m1, .19));
  col = pigment(col, vec3(1., .94, 1.), spot(q, vec2(.10, .98), .10) * .93);
  vec2 qp = rot2(.18 * sin(tp * .4 + S)) * q;                                     // yaprak kenar boyunca kayar
  float d = ellipse(qp, vec2(.63, .48), vec2(.38, .53) * (1. + .06 * sin(tp * .7)), .43 + .1 * sin(tp * .5));
  vec3 pe = pigment(vec3(.90, .08, 1.), vec3(.20, .83, 1.), spot(qp, vec2(.34, .69), .10));
  pe = pigment(pe, vec3(1., .86, .21), spot(qp, vec2(.72, .62), .14));
  pe = pigment(pe, vec3(1., .19, .46), spot(qp, vec2(.85, .22), .08));
  col = layer(col, pe, d, w0);
  vec2 qs = rot2(.16 * sin(tp * .33 + 2. + S)) * q;                                // yan k\u0131vr\u0131m \xF6b\xFCr y\xF6nde
  d = ellipse(qs, vec2(-.53, -.30), vec2(.30, .52) * (1. + .07 * sin(tp * .9 + 1.)), -.19 + .1 * sin(tp * .6 + 2.));
  vec3 sd = pigment(vec3(1., .24, .025), vec3(.48, .015, .78), spot(qs, vec2(-.40, .02), .085));
  sd = pigment(sd, vec3(1., .90, .31), spot(qs, vec2(-.52, -.72), .08));
  col = layer(col, sd, d, w0);
  // Fasulye: yava\u015F sal\u0131n\u0131m (\xB120\xB0) + hafif kayma, yumu\u015Fak b\xFCk\xFClme, k\xFCtle u\xE7lar aras\u0131nda akar; bi\xE7imi bozulmaz
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
  vec2 qd = q - vec2(.04 * sin(tp), .06 * sin(tp + 1.));              // alt zar y\xFCkselip al\xE7al\u0131r
  float e1 = ellipse(qd, vec2(.01, -.62), vec2(.70, .43), -.13 + .08 * sin(tp));
  float e2 = ellipse(qd, vec2(.11, -.23), vec2(.53, .34), .04 + .1 * sin(tp + 2.));
  d = -cmin(-e1, e2, .09);
  vec3 bo = pigment(vec3(1., .14, .57), vec3(1., .20, .035), spot(qd, vec2(-.36, -.54), .13));
  bo = pigment(bo, vec3(1., .83, .21), spot(qd, vec2(.03, -.96), .11));
  bo = pigment(bo, vec3(.62, .19, 1.), spot(qd, vec2(.51, -.64), .07));
  col = layer(col, bo, d, w0);
  col = pigment(col, shared(q, tp), .24);
  // Doygunlu\u011Fu geri kazan: \u0131\u015F\u0131k-do\u011Frusal kar\u0131\u015F\u0131mdan sonra renkler canl\u0131 kal\u0131r (ilk denemedeki son ad\u0131m)
  float pk = max(col.r, max(col.g, col.b)), lo = min(col.r, min(col.g, col.b));
  float sat = (pk - lo) / max(pk, .001);
  float keep = spot(q, vec2(.56, -.2), .045) * .75 + spot(q, vec2(.1, .96), .09) * .75;
  vec3 hu = (col - vec3(lo)) / max(pk - lo, .001);
  return pk * mix(vec3(1.), hu, max(sat, .45 * (1. - clamp(keep, 0., 1.))));
}
// Y\u0131kama k\xFCre (layers 5): uygulama zeminindeki yumu\u015Fak renk alanlar\u0131 bir k\xFCrenin y\xFCzeyinde. Alanlar 3B k\xFCre \xFCst\xFCnde
// tan\u0131ml\u0131, k\xFCre e\u011Fik bir eksende yava\u015F\xE7a d\xF6ner, alanlar kenarda s\u0131k\u0131\u015F\u0131r ve arkadan dola\u015F\u0131p gelir; arka yar\u0131 k\xFCre \xF6n
// y\xFCz\xFCn alt\u0131ndan hafif\xE7e g\xF6r\xFCn\xFCr (i\xE7i renkli sis dolu cam k\xFCre). Parlama yok.
// Uygulama zemini gibi: beyaz \xFCst\xFCne yumu\u015Fak renk alanlar\u0131 s\u0131rayla biner (normalize edilmez, s\u0131n\u0131rda \xE7izgi olu\u015Fmaz).
// Her alan\u0131n kenar\u0131 zaman zaman keskinle\u015Fir (marka g\xF6rselindeki net ayr\u0131mlar); iki alan\u0131n bulu\u015Ftu\u011Fu yerde \u0131\u015F\u0131lt\u0131l\u0131 beyaz bir bant a\xE7\u0131l\u0131r.
vec3 wfield(vec3 P, float t, float sg, float st, inout float hl){
  vec3 c = vec3(1., .985, .99); float cov = 0.;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float th = fi * 2.399 + S + t * (.32 + .06 * fi), ph = .85 * sin(fi * 1.7 + t * (.31 + .05 * fi));
    vec3 o = vec3(cos(ph) * cos(th), sin(ph), cos(ph) * sin(th));
    float e = exp(-dot(P - o, P - o) / (sg + .07 * sin(t * .7 + fi)));
    float sh = smoothstep(.55, 1., sin(t * .45 + fi * 1.9 + S)) * .7;      // bu alan \u015Fu an keskin mi
    e = mix(e, smoothstep(.26, .5, e), sh);
    hl += 4. * e * (1. - e) * cov * (.35 + .65 * sh);                        // s\u0131n\u0131rda, alttaki rengin \xFCst\xFCnde
    c = pigment(c, pick(mod(fi, max(N, 1.))), min(1., e * st));
    cov = max(cov, e);
  }
  return c;
}
vec3 washOrb(vec2 q, float t){
  t *= 1.35;                                                 // alanlar daha h\u0131zl\u0131 d\xF6ner ve akar
  float r2 = dot(q, q);
  float z = sqrt(max(0., 1. - r2));
  float a = .35 + .08 * sin(t * .4 + S);                      // e\u011Fik eksen
  mat3 tilt = mat3(1., 0., 0., 0., cos(a), -sin(a), 0., sin(a), cos(a));
  vec3 P = tilt * vec3(q, z), B = tilt * vec3(q, -z);
  vec2 wq = .16 * vec2(sin(2.1 * P.y + t * 1.3), cos(2.3 * P.x - t * 1.1));   // alanlar d\xF6nerken kendi de akar
  P.xz += wq; B.xz -= wq;
  float big = smoothstep(60., 260., R.x);                    // k\xFC\xE7\xFCk ikonda alanlar daha dolu: renk okunur
  float vv = clamp((uGlow - .2) / .8, 0., 1.);               // Playgrounds logosu: daha dolu ve doygun, d\xFCnyalardan ayr\u0131l\u0131r
  float sg = mix(.62, .55, big) + .14 * vv, st = 1.45 + .9 * vv;
  float hf = 0., hb = 0.;
  vec3 front = wfield(P, t, sg, st, hf), back = wfield(B, t, sg, st, hb);
  vec3 col = pigment(back, front, .8 + .2 * z);              // kenarda arka yar\u0131 da s\u0131zar
  // Doygunluk biraz geri: \u0131\u015F\u0131k-do\u011Frusal kar\u0131\u015F\u0131m pastele ka\xE7mas\u0131n
  float pk = max(col.r, max(col.g, col.b)), lo = min(col.r, min(col.g, col.b));
  vec3 hu = (col - vec3(lo)) / max(pk - lo, .001);
  col = mix(col, pk * mix(vec3(1.), hu, min(1., (pk - lo) / max(pk, .001) * (1.25 + .6 * vv))), .7 + .3 * vv);
  float h = smoothstep(.05, .9, hf * (.8 + .2 * z)) * mix(.5, .85, big) * (1. - .3 * vv);
  float tw = h21(floor(gl_FragCoord.xy * .5) + floor(t * 6.)) ;            // \u0131\u015F\u0131lt\u0131: bantta tek t\xFCk parlayan tane
  col = pigment(col, vec3(1., .995, 1.), h * (.85 + .2 * step(.93, tw)));
  col = pigment(col, vec3(1., .99, 1.), .12 * pow(z, 3.) * big * (1. - .6 * vv));   // orta hafif a\xE7\u0131k, kenar yo\u011Fun: hacim
  return col;
}
vec3 ribbons(vec2 p, float t, float fl){
  // \u0130mle\xE7: yak\u0131n\u0131ndaki renk katmanlar\u0131 ona do\u011Fru \xE7ekilip etraf\u0131nda k\u0131vr\u0131l\u0131r, orb yerinden oynamaz
  vec2 dq = p - uPtr.xy; float pf = uPtr.z * exp(-dot(dq, dq) * 2.6);
  float sa = pf * 1.1; p = uPtr.xy + rot2(sa) * dq * (1. - pf * .3);
  float tp = t * .08;                                       // ~14 sn'lik ana tur
  vec2 q = p / .93;                                         // 1 = k\xFCre kenar\u0131
  float k = .6 + fl * .7;
  q = rot2(.1 * k * sin(tp + S)) * q;
  q += k * .08 * vec2(sin(2.7 * q.y + tp + S), sin(2.4 * q.x - tp + S));
  q += k * .025 * vec2(sin(4. * q.x + 2. * q.y + 2. * tp), cos(3. * q.y - q.x - 2. * tp));
  float w0 = .02 + uBlur * .05;
  if (uLayers > 4.5) return washOrb(p / .93, tp);
  vec3 col = uLayers < 2.5 ? world2(q, tp, w0) : logo(q + k * .06 * vec2(sin(3.2 * q.y + tp), cos(3.1 * q.x - tp)), tp, w0);
  // Kenara do\u011Fru geni\u015F sa\xE7\u0131lma: k\xFCre \u0131\u015F\u0131\u011F\u0131 i\xE7ten yayar (k\u0131vr\u0131mlar\u0131n \xE7izgisine ba\u011Fl\u0131 de\u011Fil)
  float r = length(q), an = atan(q.y, q.x);
  col = pigment(col, vec3(1., .99, 1.), clamp(pow(smoothstep(.74, 1.06, r), 1.6) * (.44 + .17 * sin(an * 2. + .6)) + spot(q, vec2(-.22, -.97), .11) * .3, 0., .75));
  return col;
}

void main(){
  vec2 uv = ((gl_FragCoord.xy / R) * 2. - 1.) / .94;
  if (uMode > 3.5) uv *= PAD;                                // tuvalde lobun uzayaca\u011F\u0131 pay (orb ayn\u0131 boyutta)
  uv.y -= uLift * .08;
  uv -= uLean * .1;
  uv /= uScale;
  float t = T, r = length(uv);
  vec2 dir = uv / max(r, 1e-4);
  float gr = h21(gl_FragCoord.xy * .73 + S);
  vec3 col; float a;

  if (uMode < .5) {
    // Girdap k\xFCre (referans): S bi\xE7iminde akan 5 kal\u0131n \u015Ferit, yukar\u0131dan a\u015Fa\u011F\u0131 \xFCst \xFCste biner (alttaki \xF6nde).
    // Her \u015Feridin bir kenar\u0131 derin/koyu, \xF6teki beyaza a\xE7\u0131l\u0131r; renk \u015Ferit boyunca kayar; aralar beyaz kal\u0131r.
    float edgeW = 1. + uDeform * .05 * (vnoise(dir * 1.4 + vec2(t * .08, S)) - .5) + uRipple * .04 * sin(atan(uv.y, uv.x) * 5. + t * 2.);
    float ang = -.5 + .12 * sin(t * .05 + S) + uOrbit * t * .4;
    mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    vec2 pr = rot * uv * (1. - uFocus * .2);
    col = mix(vec3(1.), pal(S * .1 + pr.y * .35 + t * .02 + .5), .38); float cov = 0.;   // k\xFCrenin pastel g\xF6vdesi
    float spread = .38 * (.8 + uSpread * .25);
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float ph = S * 1.3 + fi * .55 + t * .3 + .5 * sin(t * (.09 + .025 * fi) + fi);
      float cy = (fi - 2.) * spread + .05 * sin(t * (.13 + .03 * fi) + fi);
      float amp = (.19 + .07 * uWarp) * (1. + .2 * sin(t * (.09 + .02 * fi) + fi * 2.));
      float cl = cy + amp * sin(pr.x * 1.8 + ph) + .045 * sin(pr.x * 3.3 - ph * .8 + fi) + (fi - 2.) * .12 * pr.x * pr.x;
      float w = .3 + .03 * sin(t * .17 + fi * 2.3);
      float d = pr.y - cl;
      float sdn = d / w;                                   // -1 alt kenar, +1 \xFCst kenar
      // \u015Eerit sonsuz de\u011Fil: yuvarlak u\xE7larla biter (referanstaki k\u0131vr\u0131l\u0131p biten \u015Feritler)
      float xo = .3 * sin(fi * 2.1 + S + t * .04), L = .78 + .15 * sin(t * .11 + fi * 1.7);
      float cap = length(vec2(max(abs(pr.x - xo) - L, 0.) / w, sdn));
      float m = 1. - smoothstep(.84, 1.0, cap);
      float sh = (1. - smoothstep(1., 1.5, cap)) * (1. - m) * cov;    // \xF6nceki \u015Feride yumu\u015Fak, renkli g\xF6lge
      col = mix(col, col * vec3(.72, .62, .85), sh * .6);
      vec3 c = pal(S * .1 + fi * .23 + pr.x * .32 + t * .03);
      vec3 deep = c * vec3(.55, .45, .75);
      vec3 rc = mix(deep, c, smoothstep(-1., -.1, sdn));
      rc = mix(rc, vec3(1.), smoothstep(.35, 1., sdn) * .7);
      col = mix(col, rc, m); cov = max(cov, m);
    }
    col = mix(col, vec3(1., .97, .99), .1 + .12 * (1. - cov));             // referanstaki beyaz pus
    float R0 = .93 * edgeW;
    float feather = .025 + uBlur * .12;
    col = mix(col, vec3(1.), smoothstep(R0 - .12, R0, r) * .25);
    a = 1. - smoothstep(R0 - feather, R0 + feather * .3, r);
    a = clamp(a + (gr - .5) * uNoise * .5 * (1. - a) * a * 4., 0., 1.);
    col += (gr - .5) * uNoise * .12;
  } else if (uMode > 4.5) {
    // 5 = Rou: referans hayaletin renk alan\u0131. Sil\xFCet CSS maskesinden gelir (public/brand/rou-mask.svg, referans
    // g\xF6rselden \xE7\u0131kar\u0131ld\u0131); burada yaln\u0131z i\xE7 renk \xE7izilir, referans\u0131n piksel d\xFCzeninde (720 px kutu, 141 px k\xF6\u015Fe).
    // Ortas\u0131 beyaz \u0131\u015F\u0131k; altta krem \u2192 nane \u2192 camg\xF6be\u011Fi halka; kenar leylak (tepede pembe, yanlarda mavi, altta mor).
    // Renk se\xE7ilmi\u015F Rou'larda renkler o rengin pastelleri; Playgrounds Rou'su (uGlow 1) logonun renkleriyle boyan\u0131r.
    vec2 s01 = gl_FragCoord.xy / R;
    vec2 I = vec2(141. + s01.x * 720., 141. + (1. - s01.y) * 720.);
    float tp = t * .08;
    vec2 d = (I - vec2(500., 450.)) / vec2(300., 330.);
    d += (.035 + .03 * uFocus) * vec2(sin(tp * 5. + d.y * 3. + S), cos(tp * 4. + d.x * 3.));
    d *= 1. + .04 * uRipple * sin(t * 5.);
    float r = length(d), an = atan(d.x, -d.y);                                    // an: 0 tepe, \xB1pi alt
    float n = max(N, 2.);
    vec3 cY = pigment(pick(n - 1.), vec3(1.), .72), cC = pigment(pick(max(0., n - 2.)), vec3(1.), .5);
    vec3 cB = pigment(pick(max(0., n - 3.)), vec3(1.), .55), cV = pigment(pick(max(0., n - 4.)), vec3(1.), .48);
    vec3 cP = pigment(pick(min(1., n - 1.)), vec3(1.), .55);
    float lower = smoothstep(-.12, .42, d.y);
    float side = smoothstep(.5, 1.4, abs(an)) * (1. - smoothstep(2.3, 3., abs(an)));
    // Alt yar\u0131: beyaz \u2192 krem \u2192 nane \u2192 camg\xF6be\u011Fi \u2192 mavi-leylak \u2192 mor (g\xF6kku\u015Fa\u011F\u0131 yay\u0131)
    vec3 mint = pigment(mix(cY, cC, .5), vec3(1.), .25);
    vec3 lo = vec3(1.);
    float rl = r / 1.2;
    lo = mix(lo, cY, smoothstep(.12, .32, rl));
    lo = mix(lo, mint, smoothstep(.38, .56, rl));
    lo = mix(lo, cC, smoothstep(.55, .74, rl));
    lo = mix(lo, mix(cB, cV, .4), smoothstep(.74, .9, rl));
    lo = mix(lo, mix(cV, cB, side * .6), smoothstep(.88, 1.02, rl));
    // \xDCst yar\u0131: beyaz \u2192 pembemsi beyaz \u2192 pembe-leylak, yanlarda mavi-leylak
    vec3 up = vec3(1.);
    up = mix(up, pigment(cP, vec3(1.), .65), smoothstep(.3, .58, r));
    up = mix(up, mix(mix(cP, cV, .15), mix(cV, cB, .55), side), smoothstep(.58, .9, r));
    col = mix(up, lo, lower);
    col = mix(col, vec3(1.), exp(-dot(d - vec2(0., -.08), d - vec2(0., -.08)) / .035) * .5);
    if (uGlow > .5) {
      // Playgrounds Rou'su: g\xF6vde logonun kendi y\u0131kama k\xFCresiyle boyan\u0131r (ayn\u0131 tohum, h\u0131z, ortak saat: logo ile
      // ayn\u0131 renkler ayn\u0131 anda akar); g\xF6zler okunsun diye y\xFCz \xE7evresi hafif\xE7e a\xE7\u0131l\u0131r
      col = washOrb(d * vec2(.8, .78), tp);
      col = pigment(col, vec3(1.), .22 * exp(-dot(d + vec2(0., .3), d + vec2(0., .3)) / .12));
    }
    a = 1.;
    col += (gr - .5) * uNoise * .02;
  } else if (uMode > 3.5) {
    // 4 = Prosed\xFCrel \u015Ferit k\xFCre (referans 62): g\xF6rsel yok, \u015Feritler canl\u0131 akar. Sil\xFCet %3-6 nefes al\u0131r, d\xF6nme yok.
    // Ayr\u0131lma slime gibi: kenardan bir lob uzar, boynu incelip ip gibi esner, ortadan kopar; damla k\xFC\xE7\xFClerek s\xF6ner, kal\u0131nt\u0131 geri \xE7ekilir.
    float an = atan(uv.y, uv.x);
    vec2 d2 = vec2(cos(an), sin(an));
    float sn = (vnoise(d2 * 1.2 + vec2(t * .12, S)) - .5) + .6 * (vnoise(d2 * 2.4 + vec2(-t * .1, S + 3.)) - .5);
    // Kenar dalgas\u0131: iki-\xFC\xE7 yava\u015F lob g\xF6vdeyi s\u0131v\u0131 gibi esnetir (tam daire kalmaz)
    float wv = .045 * sin(an * 2. + t * .21 + S) + .035 * sin(an * 3. - t * .17 + S * 1.7);
    float kf = 1. + uDeform * (.22 * sn + wv * 1.6) + uRipple * .035 * sin(an * 6. + t * 2.2) + dot(d2, uLean) * .04;
    vec2 pp = uv / kf;
    float rr = length(pp) / .93;                               // 1 = k\xFCre kenar\u0131
    float fl = uWarp * (1. + uFocus * 1.2);
    float sd = (rr - 1.) * .93 * kf;                           // g\xF6vdenin i\u015Faretli uzakl\u0131\u011F\u0131
    vec2 sp = pp;
    for (int k = 0; k < 2; k++) {
      float fk = float(k);
      float cyc = t * .005 + fk * .5 + S * .1;
      float u = fract(cyc) / .3;                               // d\xF6ng\xFCn\xFCn ~%30'u olay (~35 sn'de bir), gerisi sakin
      if (u < 1. && uSpread > .001) {
        float th = S * 2. + fk * 2.6 + floor(cyc) * 1.7;
        vec2 e = vec2(cos(th), sin(th));
        float grow = smoothstep(0., .7, u);
        float pinch = smoothstep(.5, .8, u) * 1.3;          // >1 olunca boyun ortadan kopar
        float fade = 1. - smoothstep(.8, 1., u);
        float rd = (.09 + .19 * smoothstep(0., .35, u)) * (1. - .35 * smoothstep(.3, .8, u)) * mix(1., fade, .9) * uSpread;
        vec2 A = e * .74, B = e * (.84 + .46 * grow * (.6 + .4 * uSpread));
        vec2 ab = B - A; float h = clamp(dot(uv - A, ab) / dot(ab, ab), 0., 1.);
        float rn = mix(.34, rd * .85, h) * (1. - pinch * 4. * h * (1. - h)) * (1. - smoothstep(.78, .97, u)) * uSpread;
        float neck = length(uv - A - ab * h) - rn + .09 * (1. - smoothstep(.02, .07, rn));   // incelen boyun silinir, k\u0131l gibi \xE7ubuk kalmaz
        float drop = length(uv - B) - rd;
        float kk = .12 * (1. - .6 * smoothstep(.55, .85, u));
        float lobe = smin(neck, drop, kk * .6);
        float sd2 = smin(sd, lobe, kk);
        // Lobun i\xE7indeki renkler g\xF6vdeden uzayarak \xE7ekilir
        float inf = smoothstep(.06, -.04, lobe);
        sp -= e * (uLayers > 4.5 ? max(0., dot(uv, e) - .5) * .95 : max(0., dot(uv, e) - .8) * .85) * inf;   // y\u0131kama k\xFCrede damla g\xF6vdenin i\xE7inden renk al\u0131r
        sd = sd2;
      }
    }
    float z = sqrt(max(0., 1. - rr * rr));
    col = ribbons(sp * (1.15 - .3 * z), t, fl);                // kenarda \u015Feritler s\u0131k\u0131\u015F\u0131r: k\xFCre hacmi
    col = mix(col, vec3(1., .98, .99), .03);
    a = 1. - smoothstep(-.015 - uBlur * .07, .01, sd);
    a = clamp(a + (gr - .5) * uNoise * .5 * (1. - a) * a * 4., 0., 1.);
    col += (gr - .5) * uNoise * .13;
  } else if (uMode > 1.5) {
    // 2 = Referans g\xF6rselin kendisi canlan\u0131r (doku b\xFCk\xFClmesi); 3 = ayn\u0131 yap\u0131 kullan\u0131c\u0131n\u0131n renkleriyle (d\xFCnya, ajan).
    // Sil\xFCet a\xE7\u0131ya g\xF6re %3-6 nefes al\u0131r, i\xE7te iki katmanl\u0131 alan b\xFCk\xFClmesi renk katmanlar\u0131n\u0131 birbirinin i\xE7inden ak\u0131t\u0131r,
    // seyrek olarak kenardan bir s\u0131v\u0131 k\xFCtlesi ayr\u0131l\u0131p geri birle\u015Fir. D\xF6nme yok, tanecik sabit (titremez).
    float an = atan(uv.y, uv.x);
    vec2 d2 = vec2(cos(an), sin(an));
    float sn = (vnoise(d2 * 1.2 + vec2(t * .12, S)) - .5) + .6 * (vnoise(d2 * 2.4 + vec2(-t * .1, S + 3.)) - .5);
    float kf = 1. + uDeform * .1 * sn + uRipple * .035 * sin(an * 6. + t * 2.2) + dot(d2, uLean) * .04;
    vec2 pp = uv / kf;
    float fl = uWarp * (1. + uFocus * 1.2);
    // Yerel girdap: merkeze yak\u0131n katmanlar birbirinin etraf\u0131nda k\u0131vr\u0131l\u0131r (b\xFCt\xFCn form d\xF6nmez)
    float tw = fl * .55 * sin(t * .16 + S) * exp(-dot(pp, pp) * 1.6) + fl * .25 * sin(t * .11 + 2. + S) * exp(-dot(pp - vec2(.35, -.2), pp - vec2(.35, -.2)) * 4.);
    vec2 sw = mat2(cos(tw), -sin(tw), sin(tw), cos(tw)) * pp;
    vec2 w1 = vec2(fbm(sw * 1.4 + vec2(t * .15, S)), fbm(sw * 1.4 + vec2(S + 4.1, -t * .13))) - .5;
    vec2 w2 = vec2(fbm(sw * 2.2 + w1 * 2.2 + vec2(-t * .11, 1.3)), fbm(sw * 2.2 + w1 * 2.2 + vec2(7.7, t * .12))) - .5;
    vec2 q = sw + fl * (.26 * w1 + .16 * w2);
    const float TR = .41;                                   // referansta orb yar\u0131\xE7ap\u0131 ~.39 (doku birimi)
    vec2 tuv = vec2(.504 + q.x * TR, .498 - q.y * TR);
    vec3 tc = texture2D(uTex, tuv).rgb;
    float rr = length(pp) * TR / .39;                        // 1 = referans orb kenar\u0131
    float mx = max(tc.r, max(tc.g, tc.b)), mn = min(tc.r, min(tc.g, tc.b));
    float aT = smoothstep(.035, .2, (mx - mn) + (1. - mn) * .55);
    float inner = 1. - smoothstep(.72, .93, rr);
    a = max(aT, inner) * (1. - smoothstep(.97 - uBlur * .08, 1.03, rr));
    col = tc;
    // Seyrek ayr\u0131lma: iki olas\u0131 k\xFCtle, \xE7o\u011Fu zaman uykuda
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
      // Kullan\u0131c\u0131 renkleri: dokunun ton yap\u0131s\u0131 korunur, renkler kullan\u0131c\u0131n\u0131n paletine e\u015Flenir
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
    // Taneli leke: amorf form, renk ge\xE7i\u015Fi bir eksen boyunca, kenar sprey
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
    float spray = step(gr, base);                                         // sprey: kenarda tanecikler tek tek s\xF6ner
    a = mix(base, spray * min(1., base * 1.4), clamp(uNoise * 1.2, 0., 1.) * (1. - smoothstep(.45, .85, base)));
    col += (gr - .5) * uNoise * .1;
  }
  float l = dot(col, vec3(.299, .587, .114));
  col = clamp(mix(vec3(l), col, uSat), 0., 1.);
  a = clamp(a, 0., 1.);
  gl_FragColor = vec4(col * a, a);
}`,g=null,p,u,c={},b=new Set,k=0,v=0,S=!1,N=()=>typeof matchMedia<"u"&&matchMedia("(prefers-reduced-motion: reduce)").matches,O=!1;function _(){if(g||S)return!!g;p=document.createElement("canvas");let e=p.getContext("webgl",{premultipliedAlpha:!0,preserveDrawingBuffer:!0,antialias:!1,alpha:!0});if(!e)return S=!0,!1;g=e;let a=(l,i)=>{let n=e.createShader(l);return e.shaderSource(n,i),e.compileShader(n),e.getShaderParameter(n,e.COMPILE_STATUS)||console.error(e.getShaderInfoLog(n)),n};u=e.createProgram(),e.attachShader(u,a(e.VERTEX_SHADER,B)),e.attachShader(u,a(e.FRAGMENT_SHADER,D)),e.linkProgram(u),e.useProgram(u);let t=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,t),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),e.STATIC_DRAW);let o=e.getAttribLocation(u,"p");e.enableVertexAttribArray(o),e.vertexAttribPointer(o,2,e.FLOAT,!1,0,0);for(let l of["R","T","S","N","uMode","uTex","uTexOk","C","uBlur","uNoise","uDeform","uWarp","uGlow","uSpread","uRipple","uFocus","uOrbit","uSat","uLift","uScale","uLean","uLayers","uPtr"])c[l]=e.getUniformLocation(u,l);e.clearColor(0,0,0,0);let r=e.createTexture();return e.bindTexture(e.TEXTURE_2D,r),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,new Uint8Array([255,255,255,255])),!0}var W=0;function q(e){let a=e.replace("#",""),t=parseInt(a.length===3?a.replace(/./g,o=>o+o):a,16);return[(t>>16&255)/255,(t>>8&255)/255,(t&255)/255]}var x=(e,a,t)=>e+(a-e)*t;function G(e){let a=g,t=e.canvas.width,o=e.canvas.height;if(!t||!o)return;(p.width<t||p.height<o)&&(p.width=Math.max(p.width,t),p.height=Math.max(p.height,o));let r=e.cur;a.viewport(0,0,t,o),a.clear(a.COLOR_BUFFER_BIT),a.uniform2f(c.R,t,o),a.uniform1f(c.T,e.t),a.uniform1f(c.S,r.seed%97*.131);let l=r.colors.slice(0,6);a.uniform1f(c.N,l.length);let i=new Float32Array(18);for(let m=0;m<6;m++)i.set(q(l[m%l.length]||"#888888"),m*3);a.uniform3fv(c.C,i);let n=Math.max(.3,Math.min(1,(e.px-16)/110));a.uniform1f(c.uBlur,r.blur),a.uniform1f(c.uNoise,r.noise),a.uniform1f(c.uDeform,r.deform*(.75+n*.25)),a.uniform1f(c.uGlow,r.glow),a.uniform1f(c.uSpread,r.spread*(.5+n*.5)),a.uniform1f(c.uRipple,r.ripple),a.uniform1f(c.uFocus,r.focus),a.uniform1f(c.uLayers,r.layers??4),a.uniform3f(c.uPtr,r.ptr?.[0]??0,r.ptr?.[1]??0,r.ptr?.[2]??0),a.uniform1f(c.uOrbit,r.orbit),a.uniform1f(c.uSat,r.sat),a.uniform1f(c.uLift,r.lift),a.uniform1f(c.uScale,r.scale*(1+r.breathe)),a.uniform2f(c.uLean,r.lean[0],r.lean[1]),a.uniform1f(c.uMode,r.mode),a.uniform1i(c.uTex,0),a.uniform1f(c.uTexOk,W),a.drawArrays(a.TRIANGLE_STRIP,0,4),e.ctx.clearRect(0,0,t,o),e.ctx.drawImage(p,0,p.height-o,t,o,0,0,t,o)}var U=30,I=8;function H(e){k=0;let a=1e3/(document.hasFocus()?U:I),t=!1;for(let i of b)if(i.dirty){t=!0;break}if(e-v<a-2&&!t){k=-1,setTimeout(()=>{k=0,y()},a-(e-v));return}let o=Math.min(.15,(e-v)/1e3||0);v=e;let r=O||N();r||(R+=o);let l=!1;for(let i of b){let n=i.get();if(!i.cur||r)i.cur={...n,lean:[...n.lean]};else{let m=1-Math.exp(-o*3),s=i.cur;for(let d of["blur","noise","deform","warp","glow","spread","breathe","ripple","focus","orbit","sat","lift","scale","speed"])s[d]=x(s[d],n[d],m);s.lean=[x(s.lean[0],n.lean[0],m),x(s.lean[1],n.lean[1],m)],s.colors=n.colors,s.seed=n.seed,s.mode=n.mode,s.layers=n.layers,s.ptr=n.ptr}!r&&n.animated!==!1&&(i.t+=o*i.cur.speed*4),i.visible&&(!r||i.dirty)&&(G(i),i.dirty=!1),!r&&i.visible&&(l=!0)}l&&y()}var R=0;function y(){!k&&b.size&&(k=requestAnimationFrame(H))}var z=typeof IntersectionObserver<"u"?new IntersectionObserver(e=>{for(let a of e){let t=a.target.__fluid;t&&(t.visible=a.isIntersecting,t.dirty=!0)}y()}):null;function P(e,a,t){if(!_())return{update(){},destroy(){},ok:!1};let o=Math.min(2,window.devicePixelRatio||1,1100/Math.max(1,t));e.width=Math.round(t*o),e.height=Math.round(t*o);let r={canvas:e,ctx:e.getContext("2d"),get:a,t:a().seed%50*3.7+R*a().speed*4,px:t,visible:!0,still:!1,dirty:!0};return e.__fluid=r,b.add(r),z?.observe(e),v=performance.now(),y(),{ok:!0,update(){r.dirty=!0,y()},destroy(){b.delete(r),z?.unobserve(e)}}}var Y=["#ff4d1f","#ff2d8f","#9b2cff","#1f3dff","#1fd0f5","#ffc21f"],M=(e={})=>({...w,colors:Y,seed:11,mode:4,layers:5,deform:.3,warp:.6,spread:.6,noise:.6,blur:.55,glow:1,...e,speed:1.4*(e.speed??1)});function T(e){let[a,t,o]=q(e),r=Math.max(a,t,o),l=Math.min(a,t,o),i=(r+l)/2;if(r===l)return[0,0,i];let n=r-l,m=i>.5?n/(2-r-l):n/(r+l);return[(r===a?(t-o)/n+(t<o?6:0):r===t?(o-a)/n+2:(a-t)/n+4)*60,m,i]}function f(e,a,t){e=(e%360+360)%360;let o=r=>{let l=(r+e/30)%12,i=a*Math.min(t,1-t);return Math.round(255*(t-i*Math.max(-1,Math.min(l-3,9-l,1)))).toString(16).padStart(2,"0")};return`#${o(0)}${o(8)}${o(4)}`}function V(e){let a=7;for(let t of e)a=(a*31+t.charCodeAt(0))%100003;return a}function A(e,a,t={}){let o=V(e),r=s=>o*(s*2654435761%1e3)%1e3/1e3,[l,i,n]=T(a.primary),m;if(a.secondary){let[s,d,E]=T(a.secondary);m=[a.primary,a.secondary,f(l,i,Math.max(.3,n-.12)),f(s,d,Math.min(.66,E+.06)),a.accent||f(l,i,Math.min(.62,n+.06))]}else m=[a.primary,f(l-22,i,Math.max(.38,n-.08)),f(l+24,Math.min(1,i*.95),Math.min(.6,n+.04)),a.accent||f(l,i,Math.max(.3,n-.14)),f(l+10,i,n)];return{...w,colors:m,seed:o,mode:4,layers:5,noise:.55,blur:.5,deform:.3+r(2)*.2,warp:.6,spread:.3,...t,speed:(1.5+r(1)*.3)*(t.speed??1)}}var F=new Map,C=new Map;function L(e,a){let t=F.get(e);if(t)return t;t=document.createElement("span"),t.className="fluid";let o=document.createElement("canvas");return o.style.cssText=`position:absolute;inset:${-(1.3-1)*50}%;width:${1.3*100}%;height:${1.3*100}%`,t.append(o),F.set(e,t),requestAnimationFrame(()=>P(o,a,Math.round(Math.max(16,t.offsetWidth||26)*1.3))),t}window.pbOrbs={setWorlds(e){for(let a of e)C.set(a.id,a)},fill(e=document){e.querySelectorAll("[data-orb]").forEach(a=>{let t=a.dataset.orb,o=`${a.dataset.k||""}:${t}`,r=t==="pg"?L(o,()=>M()):L(o,()=>{let l=C.get(t)??{id:t};return A(t,{primary:l.color||"#5b3df0",secondary:l.color2})});r.parentElement!==a&&a.prepend(r)})}};})();
