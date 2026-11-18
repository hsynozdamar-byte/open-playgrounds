// Voiced video storyboard: scene by scene, what is said, which text is on screen, which visual.
// Rou writes it (server/prepare.mjs videoPrompt), the user reads and records it, render/src/VoiceReel.tsx shows each scene
// at the moment it is spoken. Visuals are real: the UI is drawn in code, pages are really opened and shot; no invented numbers.

const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const color = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v ?? "").trim()) ? String(v).trim() : d);

// Visual kinds. Rou picks only from these; each one shows what is being said.
export const KINDS = {
  title: "One big sentence (hook or takeaway). { text }",
  card: "A real UI card; its measures change before→after, with measure marks on top. { from: { radius, padding, inner, gap }, to: {...same fields}, marks: [\"radius\"|\"padding\"|\"inner\"|\"gap\"], title, body } (px, 0-64)",
  type: "A text sample; typography before→after. { sample, from: { size, line, tracking, weight }, to: {...} , marks: [\"size\"|\"line\"|\"tracking\"|\"weight\"] } (size px 12-64, line 1.0-2.0, tracking em -0.08..0.1, weight 300-900)",
  color: "Background and text color before→after; the contrast ratio is computed and shown. { from: { bg, fg }, to: { bg, fg }, sample } (#rrggbb)",
  motion: "The same motion with two curves side by side; the curve is drawn. { from: { ease: \"linear\"|\"ease-in\"|\"ease-out\"|\"spring\", ms }, to: {...} }",
  rule: "Shows the rule as a formula or short phrase. { text } (e.g. \"outer radius = inner radius + padding\")",
  code: "Short code; the highlighted line. { lang, code, highlight: [line no] } (at most 8 lines)",
  screen: "A real web page is opened and shot, scrolled slowly. { url } (e.g. a GitHub repo address)",
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
    return { kind, from, to: typeState(v.to, from), marks: (v.marks ?? []).filter((m) => MARKS.type.includes(m)).slice(0, 3), sample: str(v.sample, 120) || "A paragraph that is easy to read looks like this." };
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

// beats: [{ say, text, visual }]. say: the sentence(s) to speak; text: at most 8 words on screen.
export function normalizeStoryboard(raw) {
  const beats = (Array.isArray(raw?.beats) ? raw.beats : []).map((b) => {
    const say = str(b?.say, 400);
    if (!say) return null;
    const text = str(b?.text, 80).split(" ").slice(0, 8).join(" ");
    return { say, text, visual: normalizeVisual(b?.visual) ?? { kind: "title", text: text || say.split(" ").slice(0, 8).join(" ") } };
  }).filter(Boolean).slice(0, 10);
  return beats.length >= 2 ? { beats } : null;
}

// The text to read: each scene's sentence is its own paragraph, headed by the scene number and the on-screen text.
export const scriptOf = (sb) => sb.beats.map((b, i) => `**${i + 1}. ${b.text || "Scene"}**\n${b.say}`).join("\n\n");

export const STORYBOARD_SCHEMA = `{"beats":[{"say":"the sentence to speak","text":"at most 8 words on screen","visual":{"kind":"...", ...}}]}`;
export const kindsText = () => Object.entries(KINDS).map(([k, v]) => `- ${k}: ${v}`).join("\n");

// WCAG contrast ratio (computed so the number shown is never invented).
export function contrast(a, b) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Aligns scenes to the spoken words: each scene's first words are searched in the transcript in order.
// A scene not found is placed by word count. Returns the ms each scene starts at.
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
  // Fill the gaps: a share by word count between the previous and next found scene.
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
