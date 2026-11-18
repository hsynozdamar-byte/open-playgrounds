// Onaylanan gönderinin kendiliğinden paylaşımı. Zamanlayıcı (schedule.mjs) her dakika bakar.
// Ne zaman: gönderi onaylandıysa, işin saatinde (otomasyon saati ya da takvimdeki ilk bloğu; saatsizse onaydan hemen sonra).
// Otomasyon çıktıları yalnız otomasyonda "Otomatik paylaş" (automation.autoShare) açıksa kendiliğinden paylaşılır;
// tek gönderi (task.post) kullanıcının onayından sonra saatinde paylaşılır. "Şimdi paylaş" her onaylı çıktıda çalışır.
// Kim: sharerOf(a, task). Rou Playgrounds tarayıcısında (server/pb.mjs), hesabın dünyasının profilinde çalışır; PB kurulu değilse
// hesabın bağlı Chrome'unu kullanır (publish.mjs).
// Yedek zincir (fallbackDue): Rou paylaşamazsa paylaşım kullanıcıya kalır: metin ve dosyalar paylaşım klasörüne konur,
// bildirim gelir (run.publish.handoff).
// Hesap bağlı değilse (hesabın bir Chrome'u yok, PB yok) hiçbir şey yapılmaz, iş kartı "Hesap bağlanmalı" der.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { notify } from "./notify.mjs";
import { installed as pbInstalled } from "./pb.mjs";
import { read, update, DATA_DIR } from "./store.mjs";
import { designLow } from "./quality.mjs";
import { shareFiles } from "./sharemedia.mjs";
import { SHARE_DIR } from "./paths.mjs";
import { trashCommand } from "../shared/platform.mjs";
import { addNotice } from "../shared/notices.mjs";
import { accountOf, bodyOf, missingImage, platformName, taskRef } from "../shared/social.mjs";
import { outputOf, sharerOf, stagesOf } from "../shared/stages.mjs";

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };

// Paylaşımın saati (dk) ya da null (saatsiz: hemen).
function slotOf(s, task) {
  if (task.autoSlot) return toMin(task.autoSlot);
  const b = (s.blocks ?? []).filter((x) => x.taskId === task.id && x.start.slice(0, 10) === task.day).map((x) => x.start.slice(11, 16)).sort()[0];
  return b ? toMin(b) : null;
}

const autoOfTask = (s, task) => (task?.autoId ? (s.automations ?? []).find((x) => x.id === task.autoId) : undefined);
// Paylaşım adımı olan işler: otomasyonda adımlardan, tek işte gönderisi (run.post) olanlar.
const hasPublish = (s, a, task, r) => (a ? stagesOf(s, a, task, r).steps.some((x) => x.key === "publish") : !!r.post);
const findRun = (st, runId) => {
  const r = runId && (st.runs ?? []).find((x) => x.id === runId || x.id.startsWith(runId));
  if (!r) throw new Error(`Çıktı yok: ${runId}`);
  return r;
};

// Onaydan sonra bu süre boyunca otomatik paylaşım beklenir; kullanıcı onayı geri alabilir. "Şimdi paylaş" beklemez.
export const UNDO_MS = 5 * 60 * 1000;

// Şimdi paylaşılması gerekenler: [{ runId, by: "claude" }]. Saf işlev (test edilir).
// opt.pb: Playground Browser kurulu (Rou hesap Chrome'a bağlı olmasa da dünyanın profilinde paylaşır).
// Onaydan sonra aynı işe revize istendiyse ya da daha yeni bir taslak çıktıysa o onay artık geçersiz
// (eski onaylı metin sonraki revizelerden sonra paylaşılmasın).
export function staleApproval(s, task, r) {
  const at = r.approvedAt || r.at || "";
  if ((task.revisions ?? []).some((v) => v.at > at)) return true;
  if (task.revise?.at && task.revise.at > at) return true;
  return (s.runs ?? []).some((x) => x.taskId === task.id && x.id !== r.id && x.at > r.at && x.status !== "failed");
}

export function dueShares(s, now = new Date(), opt = {}) {
  const today = iso(now);
  const min = now.getHours() * 60 + now.getMinutes();
  const out = [];
  for (const r of s.runs ?? []) {
    if (r.status !== "approved" || r.publish || r.shareSentAt) continue;
    if (r.approvedAt && now - new Date(r.approvedAt) < UNDO_MS) continue; // onaydan sonra geri alma süresi
    const task = (s.tasks ?? []).find((t) => t.id === r.taskId);
    if (!task || task.status === "done") continue;
    if (staleApproval(s, task, r)) continue; // onaydan sonra revize istendiyse eski onaylı metin paylaşılmaz
    const a = autoOfTask(s, task);
    // Otomasyon çıktısı yalnız "Otomatik paylaş" açıksa kendiliğinden paylaşılır; kendiliğinden onaylanmış
    // (via "auto") çıktı da öyle. Kapalıysa kullanıcı "Şimdi paylaş" der.
    if (a ? a.autoShare !== true : r.approvedVia === "auto") continue;
    if (!hasPublish(s, a, task, r)) continue;
    if (missingImage(r)) continue; // LinkedIn gönderisi görselsiz paylaşılmaz
    if (task.day && task.day > today) continue;
    const slot = slotOf(s, task);
    if (task.day === today && slot !== null && min < slot) continue;
    const by = sharerOf(a, task);
    if (by === "me") continue; // kullanıcı kendisi paylaşır
    const acc = accountOf(s, taskRef(s, task));
    if (!((acc?.browser || opt.pb) && (r.post || r.body))) continue;
    out.push({ runId: r.id, by });
  }
  return out;
}

const busy = new Set();
export const publishing = () => [...busy];
export async function shareNow(runId, by = "claude") {
  if (busy.has(runId)) return { ok: false, error: "Zaten paylaşılıyor" };
  if (by !== "claude") return { ok: false, error: "Bu gönderiyi sen paylaşıyorsun" };
  if (missingImage(read().state.runs.find((x) => x.id === runId))) return { ok: false, error: "Görsel eksik; LinkedIn gönderisi görselsiz paylaşılmaz" };
  busy.add(runId);
  try {
    update((st) => { const x = st.runs.find((y) => y.id === runId); if (x) x.tried = [...new Set([...(x.tried ?? []), by])]; });
    const { publish } = await import("./publish.mjs");
    const r = publish(runId);
    // "Zaten paylaşılıyor" hata değil: yazılırsa yedek zinciri işi kullanıcıya devreder, Rou ise o sırada paylaşmaya devam eder.
    if (!r.ok && r.error !== "Zaten paylaşılıyor") update((st) => { const x = st.runs.find((y) => y.id === runId); if (x) x.publish = { error: r.error, at: new Date().toISOString() }; });
    return r;
  } finally {
    busy.delete(runId);
  }
}

// Zamanlayıcıdan: sırası gelen her gönderiyi paylaştırır.
export function shareDue(now = new Date()) {
  const list = dueShares(read().state, now, { pb: pbInstalled() });
  for (const x of list) shareNow(x.runId, x.by).catch((e) => console.error("paylaşım:", e));
  return list;
}

// Paylaşılamayanlar için sıradaki adım: [{ runId, next: "claude" | "me", reason }]. Saf işlev (test edilir).
// Rou bir kez dener; olmazsa paylaşım kullanıcıya kalır.
export function dueFallbacks(s, now = new Date(), opt = {}) {
  const out = [];
  for (const r of s.runs ?? []) {
    const p = r.publish;
    if (r.status !== "approved" || !p || p.handoff || !p.error) continue;
    const task = (s.tasks ?? []).find((t) => t.id === r.taskId);
    if (!task || task.status === "done") continue;
    const reason = `Rou paylaşamadı: ${p.error}`;
    const acc = accountOf(s, taskRef(s, task));
    const tried = r.tried ?? ["claude"];
    out.push({ runId: r.id, next: (acc?.browser || (opt.pb && acc)) && !tried.includes("claude") ? "claude" : "me", reason });
  }
  return out;
}

// Teslim klasörü: <paylaşım klasörü>/<Proje>/<gün> <Platform> · <iş>/ (metin.txt + 01.png…).
// Klasörün hangi çıktıya ait olduğu içindeki gizli .run dosyasında yazar. Gönderi paylaşılınca (Paylaştım, pg posted, Rou)
// klasör Çöp Kutusu'na gider; medyanın aslı data/media'da kalır. Günlük saklama da artakalanı süpürür.
export const HANDOFF_ROOT = SHARE_DIR;
const safeName = (x) => String(x ?? "").replace(/^@/, "").replace(/https?:\/\//, "").replace(/[\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60);
function handoffDirs() {
  const out = [];
  const walk = (d, depth) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { if (!e.isDirectory() || e.name.startsWith(".")) continue; const p = path.join(d, e.name);
      let id = ""; try { id = fs.readFileSync(path.join(p, ".run"), "utf8").trim(); } catch { id = (e.name.match(/ ([a-z0-9]{6})$/) || [])[1] || ""; }
      if (id) out.push({ dir: p, runId: id }); else if (depth < 1) walk(p, depth + 1); } };
  walk(HANDOFF_ROOT, 0);
  return out;
}
// Klasör çöpe gider: macOS'ta ~/.Trash; başka sistemlerde yalnız .run işaretli (uygulamanın yaptığı) klasör, Windows'ta Geri Dönüşüm Kutusu, Linux'ta gio trash
// (shared/platform.mjs trashCommand). Çöpe taşınamazsa silinir.
function toTrash(p) {
  const cmd = trashCommand(p);
  if (cmd && !fs.existsSync(path.join(p, ".run"))) return false;
  if (!cmd) {
    const bin = path.join(os.homedir(), ".Trash");
    let to = path.join(bin, path.basename(p)), n = 2;
    while (fs.existsSync(to)) to = path.join(bin, `${path.basename(p)} ${n++}`);
    try { fs.renameSync(p, to); } catch { return false; }
  } else {
    try { execFileSync(cmd[0], cmd[1], { stdio: "ignore", timeout: 20000, windowsHide: true }); } catch { /* çöp yok: silinir */ }
    if (fs.existsSync(p)) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { return false; } }
  }
  const parent = path.dirname(p);   // boş kalan proje klasörünü de kaldır
  try { if (parent !== HANDOFF_ROOT && !fs.readdirSync(parent).filter((f) => !f.startsWith(".")).length) fs.rmSync(parent, { recursive: true }); } catch {}
  return true;
}
// Paylaşılmış (ya da kaydı silinmiş) çıktıların teslim klasörlerini Çöp Kutusu'na taşır. runId verilirse yalnız onunkini.
export function sweepHandoffs(st, runId) {
  let n = 0;
  for (const h of handoffDirs()) {
    if (runId ? h.runId !== runId : (() => { const r = st.runs.find((x) => x.id === h.runId); return r && r.status !== "posted"; })()) continue;
    if (toTrash(h.dir)) n++;
  }
  return n;
}

// Paylaşımı kullanıcıya bırakır: teslim klasörüne metin + dosyalar, bildirim.
export function handoff(runId, reason) {
  const s = read().state;
  const r = s.runs.find((x) => x.id === runId);
  if (!r) return null;
  const task = s.tasks.find((t) => t.id === r.taskId);
  const acc = task && accountOf(s, taskRef(s, task));
  const where = acc ? `${platformName(acc)} ${acc.handle || acc.name}` : "";
  const proj = task?.projectId && s.projects.find((p) => p.id === task.projectId);
  const group = safeName(proj?.name || acc?.name || "Diğer");
  const base = safeName(`${iso(new Date())} ${acc ? platformName(acc) : "Gönderi"} · ${task?.title || r.title || acc?.name || ""}`);
  sweepHandoffs(s, r.id);   // aynı çıktının eski teslim klasörü (yeniden deneme) çift kalmasın
  let dir = path.join(HANDOFF_ROOT, group, base), k = 2;
  while (fs.existsSync(dir)) dir = path.join(HANDOFF_ROOT, group, `${base} (${k++})`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".run"), r.id);
  fs.writeFileSync(path.join(dir, "metin.txt"), (r.post ? bodyOf(r.post) : r.body) ?? "");
  let files;
  try { files = shareFiles(r, acc?.platform); } catch { files = (r.video ? [r.video] : r.images ?? []).map((f) => path.join(DATA_DIR, f)); }
  files.forEach((src, i) => {
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, `${String(i + 1).padStart(2, "0")}${path.extname(src)}`));
  });
  update((st) => { const x = st.runs.find((y) => y.id === runId); if (x) { x.publish = { handoff: true, reason: String(reason).slice(0, 300), dir, at: new Date().toISOString() }; addNotice(st, { kind: "handoff", runId, text: `${reason}. Metin ve dosyalar paylaşım klasöründe: ${HANDOFF_ROOT}` }); } });
  notify(`Paylaşım sana kaldı${where ? `: ${where}` : ""}`, `${reason}. Metin ve dosyalar paylaşım klasöründe.`);
  return dir;
}

// Zamanlayıcıdan: paylaşılamayanları bir sonraki adıma geçirir.
export function fallbackDue(now = new Date()) {
  const list = dueFallbacks(read().state, now, { pb: pbInstalled() });
  for (const x of list) {
    if (x.next === "claude") {
      update((st) => { const r = st.runs.find((y) => y.id === x.runId); if (r) r.publish = undefined; });
      shareNow(x.runId, "claude").catch((e) => console.error("yedek paylaşım:", e));
    } else handoff(x.runId, x.reason);
  }
  return list;
}

// Paylaşıldı (ya da paylaşılamadı) bilgisini yazar; paylaşılınca iş biter. pg posted ve publish.mjs kullanır.
// "LinkedIn · linkedin.com/company/..." gibi: paylaşımın yapıldığı yer.
function whereOf(st, r) {
  const acc = accountOf(st, taskRef(st, st.tasks.find((t) => t.id === r.taskId)));
  return acc ? `${platformName(acc)} · ${acc.handle || acc.name}` : "";
}
export function markPosted(st, runId, { url, error } = {}) {
  const r = findRun(st, runId);
  const at = new Date().toISOString();
  const by = r.publish?.by ?? r.tried?.at(-1);
  const where = whereOf(st, r);
  if (error) {
    r.publish = { error: String(error).slice(0, 300), at, ...(by ? { by } : {}) };
    addNotice(st, { kind: "share_failed", runId, by, text: `${where ? `${where}. ` : ""}${r.publish.error}` });
    return r;
  }
  Object.assign(r, { status: "posted", postedAt: at, publish: undefined, ...(url && /^https?:\/\//.test(url) ? { postUrl: url } : {}) });
  sweepHandoffs(st, runId);   // paylaşıldı: teslim klasörü Çöp Kutusu'na
  addNotice(st, { kind: "posted", runId, by, text: where });
  const t = st.tasks.find((x) => x.id === r.taskId);
  if (t && t.status !== "done") { t.status = "done"; t.doneAt = at; }
  return r;
}

// Onay (uygulamadaki Onayla ile aynı): paylaşımı olmayan iş onayla biter, olan iş paylaşılınca.
export function approveRun(st, runId, { via } = {}) {
  const r = findRun(st, runId);
  if (r.status !== "ready") throw new Error(r.status === "working" ? "Çıktı daha hazırlanıyor" : `Onay beklemiyor (${r.status}): ${r.title}`);
  if (r.revisedAt) throw new Error("Bu çıktı için revize istendi; yenisini onayla");
  if (r.items?.length) throw new Error("Bu çıktıda seçim var; uygulamada seçilmeli");
  const task = st.tasks.find((t) => t.id === r.taskId);
  const a = autoOfTask(st, task);
  if (a && task && ["voice", "video"].includes(stagesOf(st, a, task, r).current)) throw new Error("Ses ya da video eksik; önce o tamamlanmalı");
  if (missingImage(r)) throw new Error("Görsel eksik; LinkedIn gönderisi görselle onaylanır");
  // Tasarım denetiminden düşük puan almış çıktı gösterilir ama onay beklemeyen otomasyonda kendiliğinden onaylanmaz.
  if (via === "auto" && designLow(r)) throw new Error("Tasarım puanı düşük; onay kullanıcıda");
  const at = new Date().toISOString();
  Object.assign(r, { status: "approved", approvedAt: at, ...(via ? { approvedVia: via } : {}) });
  const shareable = !!r.post || (!!a && ["post", "video"].includes(outputOf(st, a)));
  // Rou'ya verilmiş tek iş: onay "devam et" demek, iş açık kalır (uygulamadaki RunCard ile aynı).
  const keepOpen = !!task && !a && task.who === "claude";
  if (task && !shareable && !keepOpen && task.status !== "done") { task.status = "done"; task.doneAt = at; }
  return r;
}
