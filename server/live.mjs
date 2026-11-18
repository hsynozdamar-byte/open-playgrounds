// Rou tarayıcıda (Playgrounds'un kendi tarayıcısı ya da yedek olarak bağlı Chrome) çalışırken ne yaptığı: claude akışındaki her araç kısa bir Türkçe adıma çevrilir, çıktıya (run[field].live) yazılır.
// Uygulama bunu canlı gösterir: hangi Chrome, hangi sayfa, şu an ne yapıyor, son adımlar. Yazma en sık 1,5 sn'de bir.
import { update } from "./store.mjs";
import { notify } from "./notify.mjs";
import { asksPermission } from "../shared/chrome.mjs";

const host = (u) => { try { const x = new URL(u); return (x.host + x.pathname).replace(/\/$/, "").slice(0, 80); } catch { return String(u ?? "").slice(0, 80); } };
export function stepOf(name, input) {
  const t = String(name).replace(/^mcp__(claude-in-chrome|pb)__/, "");
  // Playgrounds tarayıcısının araçları (chrome-devtools-mcp)
  if (t === "navigate_page") return input.url ? { text: `Açıyor: ${host(input.url)}`, url: input.url } : { text: "Sayfada geziyor" };
  if (t === "take_snapshot") return { text: "Sayfayı okuyor" };
  if (t === "take_screenshot") return { text: "Ekrana bakıyor" };
  if (t === "click" || t === "hover" || t === "drag") return { text: "Tıklıyor" };
  if (t === "fill" || t === "fill_form") return { text: "Formu dolduruyor" };
  if (t === "upload_file") return { text: "Dosya yüklüyor" };
  if (t === "press_key") return { text: `Tuş: ${input.key ?? ""}` };
  if (t === "handle_dialog") return { text: "Uyarıyı yanıtlıyor" };
  if (t === "list_pages" || t === "select_page" || t === "wait_for") return null;
  if (t === "Bash" && /pb pass/.test(String(input.command ?? ""))) return { text: "Şifreyi giriyor" };
  if (t === "select_browser") return { text: "Chrome seçiliyor" };
  if (t === "navigate") return { text: `Açıyor: ${host(input.url)}`, url: input.url };
  if (t === "tabs_create_mcp") return { text: "Yeni sekme açıyor" };
  if (t === "tabs_close_mcp") return { text: "Sekmeyi kapatıyor" };
  if (t === "get_page_text" || t === "read_page") return { text: "Sayfayı okuyor" };
  if (t === "find") return { text: `Arıyor: ${String(input.query ?? "").slice(0, 60)}` };
  if (t === "form_input") return { text: "Formu dolduruyor" };
  if (t === "file_upload") return { text: "Dosya yüklüyor" };
  if (t === "javascript_tool") return { text: "Sayfada işlem yapıyor" };
  if (t === "computer") {
    const a = input.action;
    if (a === "screenshot") return { text: "Ekrana bakıyor" };
    if (a === "type") return { text: `Yazıyor: ${String(input.text ?? "").slice(0, 50)}` };
    if (a === "key") return { text: `Tuş: ${input.text ?? ""}` };
    if (a === "scroll") return { text: "Kaydırıyor" };
    if (/click/.test(a ?? "")) return { text: "Tıklıyor" };
    return { text: "Sayfada çalışıyor" };
  }
  if (t === "tabs_context_mcp" || t === "list_connected_browsers" || t === "ToolSearch") return null;
  if (t === "Read") return { text: "Dosya okuyor" };
  if (t === "Write" || t === "Edit") return { text: "Dosya yazıyor" };
  return { text: t };
}

// Chrome aracı bu kadar sürede sonuçlanmazsa Rou büyük olasılıkla Claude in Chrome'un izin/onay penceresinde bekliyor.
export const STALL = 30 * 1000;
export const WAITING = "Chrome'da onay bekliyor";

// field: "act" (uygulama turu) ya da "live" (hazırlık); browser: { name }.
// Döner: runClaude için { onTool, onResult } ve iş bitince çağrılan stop.
// Onay beklenirken live.step WAITING olur, live.waiting true; bildirim her bekleyişte bir kez gider.
export function tracker(runId, field, browser) {
  let live = { browser: browser?.name ?? "", url: "", step: "Başlıyor", at: new Date().toISOString(), log: [] };
  let timer = null, stall = null, told = false, before = null;
  const flush = () => {
    timer = null;
    const snap = live;
    update((st) => {
      const r = st.runs.find((x) => x.id === runId);
      if (!r) return;
      if (field === "live") r.live = snap;
      else if (r[field]) r[field].live = snap;
    });
  };
  const later = () => { if (!timer) timer = setTimeout(flush, 1500); };
  const wait = () => {
    stall = null;
    if (live.waiting) return;
    before = live.step;
    live = { ...live, step: WAITING, waiting: true, at: new Date().toISOString() };
    if (timer) { clearTimeout(timer); timer = null; }
    flush();
    if (!told) { told = true; notify("Rou Chrome'da onayını bekliyor", `${live.browser || "Chrome"}, ${host(live.url).split("/")[0] || "site"}`); }
  };
  const clear = () => {
    if (stall) { clearTimeout(stall); stall = null; }
    if (live.waiting) { const { waiting, ...rest } = live; live = { ...rest, step: before ?? rest.step }; told = false; later(); }
  };
  flush();
  return {
    onTool: (name, input) => {
      clear();
      if (/^mcp__claude-in-chrome__/.test(name)) stall = setTimeout(wait, STALL);
      const s = stepOf(name, input);
      if (!s) return;
      live = { ...live, step: s.text, at: new Date().toISOString(), ...(s.url ? { url: s.url } : {}), log: [...live.log, s.text].slice(-8) };
      later();
    },
    onResult: (text, isError) => {
      clear();
      if (isError && asksPermission(text)) wait();
    },
    stop: () => { if (stall) clearTimeout(stall); stall = null; },
  };
}
