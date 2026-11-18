// Sesli video senaryosu: sahne sahne ne söylenir, ekranda hangi yazı, hangi görüntü.
// Rou yazar (server/prepare.mjs videoPrompt), kullanıcı okur ve kaydeder, render/src/VoiceReel.tsx her sahneyi
// söylendiği anda gösterir. Görüntüler gerçek: arayüz kodla çizilir, sayfa gerçekten açılıp çekilir; uydurma rakam yok.

const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const color = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v ?? "").trim()) ? String(v).trim() : d);

// Görüntü türleri. Rou yalnız bunlardan seçer; her biri anlatılan şeyi gösterir.
export const KINDS = {
  title: "Büyük tek cümle (kanca ya da çıkarım). { text }",
  card: "Gerçek bir arayüz kartı; ölçüleri önce→sonra değişir, ölçü işaretleri üstünde. { from: { radius, padding, inner, gap }, to: {...aynı alanlar}, marks: [\"radius\"|\"padding\"|\"inner\"|\"gap\"], title, body } (px, 0-64)",
  type: "Yazı örneği; tipografi önce→sonra. { sample, from: { size, line, tracking, weight }, to: {...} , marks: [\"size\"|\"line\"|\"tracking\"|\"weight\"] } (size px 12-64, line 1.0-2.0, tracking em -0.08..0.1, weight 300-900)",
  color: "Zemin ve yazı rengi önce→sonra; kontrast oranı hesaplanıp gösterilir. { from: { bg, fg }, to: { bg, fg }, sample } (#rrggbb)",
  motion: "Aynı hareket iki eğriyle yan yana; eğri çizilir. { from: { ease: \"linear\"|\"ease-in\"|\"ease-out\"|\"spring\", ms }, to: {...} }",
  rule: "Kuralı formül ya da kısa ifade olarak gösterir. { text } (ör. \"dış radius = iç radius + padding\")",
  code: "Kısa kod; vurgulanan satır. { lang, code, highlight: [satır no] } (en çok 8 satır)",
  screen: "Gerçek web sayfası açılıp çekilir, yavaşça kaydırılır. { url } (ör. GitHub repo adresi)",
};
const MARKS = { card: ["radius", "padding", "inner", "gap"], type: ["size", "line", "tracking", "weight"] };
const EASES = ["linear", "ease-in", "ease-out", "spring"];

const cardState = (x = {}, d = {}) => ({ radius: num(x.radius, 0, 64, d.radius ?? 16), padding: num(x.padding, 0, 64, d.padding ?? 16), inner: num(x.inner, 0, 64, d.inner ?? 8), gap: num(x.gap, 0, 64, d.gap ?? 12) });
const typeState = (x = {}, d = {}) => ({
  size: num(x.size, 12, 64, d.size ?? 28),
  line: Math.min(2, Math.max(1, Number.isFinite(+x.line) ? +x.line : d.line ?? 1.4)),
  tracking: Math.min(0.1, Math.max(-0.08, Number.isFinite(+x.tracking) ? +x.tracking : d.tracking ?? 0)),
  weight: num(x.weight, 300, 900, d.weight ?? 500),
});

export function normalizeVisual(v) {
  const kind = String(v?.kind ?? "");
  if (kind === "card") {
    const from = cardState(v.from);
    return { kind, from, to: cardState(v.to, from), marks: (v.marks ?? []).filter((m) => MARKS.card.includes(m)).slice(0, 3), title: str(v.title, 40), body: str(v.body, 90) };
  }
  if (kind === "type") {
    const from = typeState(v.from);
    return { kind, from, to: typeState(v.to, from), marks: (v.marks ?? []).filter((m) => MARKS.type.includes(m)).slice(0, 3), sample: str(v.sample, 120) || "Okunması kolay bir paragraf böyle görünür." };
  }
  if (kind === "color") {
    const from = { bg: color(v.from?.bg, "#ffffff"), fg: color(v.from?.fg, "#9a9a9a") };
    return { kind, from, to: { bg: color(v.to?.bg, from.bg), fg: color(v.to?.fg, "#1a1a1a") }, sample: str(v.sample, 40) || "Aa" };
  }
  if (kind === "motion") {
    const st = (x, d) => ({ ease: EASES.includes(x?.ease) ? x.ease : d, ms: num(x?.ms, 100, 1200, 400) });
    return { kind, from: st(v.from, "linear"), to: st(v.to, "ease-out") };
  }
  if (kind === "code") {
    const code = String(v.code ?? "").split("\n").slice(0, 8).map((l) => l.slice(0, 44)).join("\n");
    return code.trim() ? { kind, lang: str(v.lang, 12), code, highlight: (v.highlight ?? []).map((n) => num(n, 1, 8, 1)).slice(0, 3) } : null;
  }
  if (kind === "screen") {
    const url = str(v.url, 300);
    return /^https:\/\/[^\s]+$/.test(url) ? { kind, url } : null;
  }
  if (kind === "rule" || kind === "title") {
    const text = str(v.text, 70);
    return text ? { kind, text } : null;
  }
  return null;
}

// beats: [{ say, text, visual }]. say: söylenecek cümle(ler); text: ekranda en çok 8 kelime.
export function normalizeStoryboard(raw) {
  const beats = (Array.isArray(raw?.beats) ? raw.beats : []).map((b) => {
    const say = str(b?.say, 400);
    if (!say) return null;
    const text = str(b?.text, 80).split(" ").slice(0, 8).join(" ");
    return { say, text, visual: normalizeVisual(b?.visual) ?? { kind: "title", text: text || say.split(" ").slice(0, 8).join(" ") } };
  }).filter(Boolean).slice(0, 10);
  return beats.length >= 2 ? { beats } : null;
}

// Okunacak metin: her sahnenin cümlesi ayrı paragraf, başında sahne numarası ve ekran yazısı.
export const scriptOf = (sb) => sb.beats.map((b, i) => `**${i + 1}. ${b.text || "Sahne"}**\n${b.say}`).join("\n\n");

export const STORYBOARD_SCHEMA = `{"beats":[{"say":"söylenecek cümle","text":"ekranda en çok 8 kelime","visual":{"kind":"...", ...}}]}`;
export const kindsText = () => Object.entries(KINDS).map(([k, v]) => `- ${k}: ${v}`).join("\n");

// WCAG kontrast oranı (gösterilen sayı uydurma olmasın diye hesaplanır).
export function contrast(a, b) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Sahneleri sesteki kelimelere oturtur: her sahnenin ilk kelimeleri dökümde sırayla aranır.
// Bulunamayan sahne, kelime sayısına göre araya yerleştirilir. Dönüş: her sahnenin başladığı ms.
const norm = (w) => w.toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}]/gu, "");
export function alignBeats(beats, words) {
  const toks = words.map((w) => norm(w.t));
  const starts = [];
  let pos = 0;
  for (const b of beats) {
    const want = b.say.split(/\s+/).map(norm).filter(Boolean).slice(0, 3);
    let hit = -1;
    for (let i = pos; i < toks.length && hit < 0; i++) {
      const score = want.reduce((n, w, k) => n + (toks[i + k] && (toks[i + k] === w || (w.length > 3 && toks[i + k].startsWith(w.slice(0, 4)))) ? 1 : 0), 0);
      if (score >= Math.min(2, want.length) && i - pos < 40) hit = i;
    }
    starts.push(hit);
    if (hit >= 0) pos = hit + 1;
  }
  // Boşlukları doldur: önceki ve sonraki bulunan sahne arasında kelime sayısına göre pay.
  const total = beats.reduce((n, b) => n + b.say.split(/\s+/).length, 0) || 1;
  let acc = 0;
  const share = beats.map((b) => { const at = acc / total; acc += b.say.split(/\s+/).length; return at; });
  const end = words.length ? words[words.length - 1].to : 0;
  const out = [];
  starts.forEach((i, k) => {
    const ms = k === 0 ? 0 : i >= 0 ? words[i].from : Math.round(share[k] * end);
    out.push(k > 0 && ms <= out[k - 1] ? out[k - 1] + 600 : ms);
  });
  return out;
}
