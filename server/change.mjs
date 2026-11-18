// Rou'nun "kendin yap" işi: kullanıcının onayladığı istek (ör. "bu buton mavi olsun", "YouTube videosu gömülebilsin")
// `claude -p` ile repo kökünde, araç izinleriyle çalışır (kod, komut, `pg` ile veri).
// Yalnız geliştirici açarsa çalışır (PG_CHANGE=1); kapalıyken /api/change 403 döner ve Rou bu işi önermez.
// Çalışma ağacı temizken başlar. Kod değiştiyse tsc + test + build (+ sunucu kodu yükleniyor mu); biri bozulursa kod geri alınır.
// Başarılıysa yerel commit olur, "Geri al" git revert yapar. Sunucu kodu değiştiyse sunucu kendini yeniden başlatır (serve.mjs gözetir).
// Veri değişiklikleri git'te değil; pg ile yapılır, silinenler Çöp Kutusu'na gider. İlerleme state.change'te, geçmiş state.changes'te.
import { spawn } from "node:child_process";
import { resolveSpawn } from "../shared/platform.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runClaude } from "./claude.mjs";
import { MEDIA_DIR, id, read, update } from "./store.mjs";
import { DEFAULT_ROU, rouOf, setChat } from "../shared/rou.mjs";
import { mediaPath } from "./attach.mjs";
import { idle } from "./update.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
let busy = false;
export const changeOn = () => process.env.PG_CHANGE === "1";
let rouId = DEFAULT_ROU; // işi isteyen Rou: sonuç onun sohbetine yazılır

function sh(cmd, args, ms = 240000) {
  return new Promise((resolve) => {
    // Windows'ta npx.cmd cmd.exe üzerinden (shared/platform.mjs).
    const sp = resolveSpawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    const p = spawn(sp.file, sp.args, sp.opts);
    let out = "";
    p.stdout.setEncoding("utf8").on("data", (c) => (out += c));
    p.stderr.setEncoding("utf8").on("data", (c) => (out += c));
    const t = setTimeout(() => p.kill("SIGTERM"), ms);
    p.on("error", (e) => (clearTimeout(t), resolve({ ok: false, out: e.message, raw: "" })));
    p.on("close", (code) => (clearTimeout(t), resolve({ ok: code === 0, out: out.trim(), raw: out })));
  });
}
const git = (...a) => sh("git", ["-c", `user.name=${process.env.PG_GIT_NAME || "Playgrounds Rou"}`, "-c", `user.email=${process.env.PG_GIT_EMAIL || "rou@playgrounds.local"}`, ...a]);
// -z: satır başındaki durum harfleri ve boşluklar korunur; yol 4. karakterden başlar.
const dirty = async () => (await git("status", "--porcelain", "-z", "--untracked-files=all")).raw.split("\0").filter(Boolean).map((l) => l.slice(3));
// Olmayan değişiklik silinmez, git stash'e kaldırılır (`git stash list` → "rou-olmadı …"). Çalışma ağacı yine temizlenir.
// Önceden `checkout . && clean -fd` çalışıyordu: Rou çalışırken başka bir oturumun (ya da kullanıcının) aynı klasörde yazdığı
// kaydedilmemiş dosyalar da geri gelmeyecek şekilde siliniyordu.
const discard = () => git("stash", "push", "--include-untracked", "-m", `rou-olmadı ${new Date().toISOString().slice(0, 16)}`);
// Commit başlığı kısa olur, isteğin tamamı gövdeye yazılır (başlık 2 KB'lık istek metni oluyordu).
const subject = (text) => { const one = String(text).replace(/\s+/g, " ").trim(); return one.length > 72 ? `${one.slice(0, 69).trimEnd()}…` : one; };
// Sunucu gerçekten açılıyor mu: boş veriyle, boş bir portta, zamanlayıcısız başlatılır ve cevap vermesi beklenir.
// Yalnız modülü içe aktarmak app.mjs'teki ya da açılıştaki hatayı görmüyordu; öyle bir commit sunucuyu açılmaz bırakırdı.
async function boots() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-boot-"));
  const port = 5600 + Math.floor(Math.random() * 300);
  const p = spawn(process.execPath, ["server/app.mjs"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PG_DATA: dir, PORT: String(port), PG_NO_SCHEDULE: "1", PG_DRY: "1", PG_SUPERVISED: "" } });
  let out = "", exited = false;
  p.stdout.on("data", (c) => (out += c)); p.stderr.on("data", (c) => (out += c));
  p.on("error", (e) => { out += e.message; exited = true; }); p.on("exit", () => (exited = true));
  try {
    for (let i = 0; i < 24 && !exited; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await fetch(`http://127.0.0.1:${port}/api/backups`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false)) return { ok: true };
    }
    return { ok: false, out: out.trim() || "sunucu cevap vermedi" };
  } finally { p.kill("SIGTERM"); fs.rmSync(dir, { recursive: true, force: true }); }
}
// Sunucunun yeniden başlaması gereken dosyalar (arayüz derlemeyle güncellenir).
const serverSide = (files) => files.some((f) => /^(server|shared|scripts)\/|^package(-lock)?\.json$/.test(f));
const check = async (files) => {
  const t = await sh("npx", ["tsc", "--noEmit", "-p", "."]);
  if (!t.ok) return { ok: false, error: `Tür kontrolü geçmedi: ${t.out.split("\n").slice(0, 3).join(" ")}` };
  const v = await sh("npx", ["vitest", "run"]);
  if (!v.ok) return { ok: false, error: `Testler geçmedi: ${v.out.split("\n").filter((l) => /FAIL|Error|✗|×/.test(l)).slice(0, 3).join(" ")}` };
  if (serverSide(files)) {
    const s = await sh(process.execPath, ["-e", "import('./server/store.mjs').then(() => process.exit(0))"], 30000);
    if (!s.ok) return { ok: false, error: `Sunucu kodu yüklenmedi: ${s.out.split("\n").slice(0, 3).join(" ")}` };
    const up = await boots();
    if (!up.ok) return { ok: false, error: `Sunucu açılmadı: ${up.out.split("\n").slice(-3).join(" ").slice(0, 300)}` };
  }
  if (files.some((f) => /^browser\/.*\.mjs$/.test(f))) {
    const b = await sh(process.execPath, ["--check", "browser/main.mjs"], 30000);
    if (!b.ok) return { ok: false, error: `Uygulama kabuğunun kodu bozuk: ${b.out.split("\n").slice(0, 3).join(" ")}` };
  }
  const b = await sh("npx", ["vite", "build"]);
  return b.ok ? { ok: true } : { ok: false, error: `Derleme olmadı: ${b.out.split("\n").slice(-3).join(" ")}` };
};

const phase = (p, fresh = false) => update((s) => void (s.change = { ...(fresh ? {} : s.change), ...p, at: new Date().toISOString() }));
const say = (text, action, extra = {}) => update((s) => setChat(s, rouId, (l) => [...l, { role: "rou", text, at: new Date().toISOString(), ...(action ? { action } : {}), ...extra }]));

// Yaptığı işin görseli sohbette: kapak ya da görsel değiştiyse sonuç sohbette gösterilir.
// Rou son satıra "GÖSTER: dosya, runId" yazar; dosyalar data/media'dan mesaja eklenir, runId'ler çıktının kendi görünümüyle gösterilir.
// Satır yoksa iş sırasında data/media'ya düşen görsel ve videolar eklenir (o sırada hazırlanan başka çıktılarınki hariç).
const SHOWABLE = /\.(png|jpe?g|webp|gif|mp4|mov|webm)$/i;
export function shownOf(out, since, s = read().state) {
  const lines = String(out ?? "").split("\n");
  const marks = lines.filter((l) => /^\s*(GÖSTER|GOSTER)\s*:/i.test(l));
  const text = lines.filter((l) => !marks.includes(l)).join("\n").trim();
  const kind = (f) => (/\.(mp4|mov|webm)$/i.test(f) ? "video" : "image");
  const ok = (f) => SHOWABLE.test(f) && fs.existsSync(path.join(MEDIA_DIR, f));
  let files = [], show = [];
  for (const tok of marks.flatMap((l) => l.replace(/^[^:]*:/, "").split(/[,\s]+/)).map((t) => t.replace(/[`"'()]/g, "").trim()).filter(Boolean)) {
    const f = path.basename(tok);
    if (s.runs?.some((r) => r.id === tok)) show.push(tok);
    else if (ok(f)) files.push(f);
  }
  if (!marks.length && since) {
    const fresh = new Set(s.runs?.filter((r) => new Date(r.at) >= since).map((r) => r.id));
    try {
      files = fs.readdirSync(MEDIA_DIR).filter((f) => ok(f) && !/^rou-/.test(f) && !fresh.has(f.split("-")[0]) && fs.statSync(path.join(MEDIA_DIR, f)).mtimeMs >= since.getTime())
        .sort((a, b) => fs.statSync(path.join(MEDIA_DIR, b)).mtimeMs - fs.statSync(path.join(MEDIA_DIR, a)).mtimeMs);
    } catch { files = []; }
  }
  files = [...new Set(files)].slice(0, 4).map((f) => ({ file: f, name: f, kind: kind(f) }));
  show = [...new Set(show)].slice(0, 3);
  return { text, extra: { ...(files.length ? { files } : {}), ...(show.length ? { show } : {}) } };
}

const PROMPT = (text, seen = []) => [
  "Sen Rou'sun: kullanıcının Playgrounds uygulamasındaki asistanı. Aslında Claude'sun ve şu an bu bilgisayarda, uygulamanın repo kökünde, dosya ve komut araçlarınla çalışıyorsun. Önce CLAUDE.md'yi oku.",
  `Kullanıcı şunu istedi ve onayladı: «${text}»`,
  seen.length ? `Kullanıcı bununla ilgili şu dosyaları ekledi; Read ile açıp bak (ör. ekran görüntüsündeki yeri bul):\n${seen.map((p) => `- ${p}`).join("\n")}` : "",
  [
    "Nasıl:",
    "- Uygulama kodu (src/, server/, shared/, scripts/, tests/) gerekiyorsa değiştir; yeni özellik de olabilir. Çevredeki kodun adlandırmasına ve yorum yoğunluğuna uy, tür ölçeğini ve renk token'larını kullan. Mantık değişirse tests/ altına test ekle.",
    "- Veri (dünya, proje, iş, not, otomasyon) yalnız `node scripts/pg.mjs ...` ile yazılır (komutlar CLAUDE.md'de; dünya için `pg world`). data/ altındaki dosyaları elle düzenleme. Uydurma iş, not ya da sayı ekleme.",
    "- Gerekirse komut çalıştır (ör. npm test, npx tsc, bu projeye npm install). Kontrolü ve commit'i sistem senden sonra kendisi yapar: git commit, push, reset, checkout yapma.",
    "- Yapma: dışarıya bir şey gönderme ya da yayınlama (mesaj, e-posta, gönderi, deploy), parola ya da kimlik bilgisi girme, bu repo dışındaki dosyaları silme, sistem ayarlarını değiştirme, `npm run dev` gibi sürekli çalışan süreç başlatma. Böyle bir şey gerekiyorsa yapmadan nedenini yaz.",
    "- İsteneni en küçük eksiksiz değişiklikle yap; isteğin dışına taşma. Uzun tire (—) kullanma. Arayüz metinleri Türkçe.",
    "- İstek belirsizse hiçbir şeyi değiştirme, ne eksik olduğunu yaz.",
  ].join("\n"),
  "Bitince ne yaptığını kullanıcıya bir iki kısa Türkçe cümleyle anlat; yapılan işi geçmiş zamanla söyle (yaptım, değiştirdim), metinde dosya yolu verme. Bir görsel ya da video ürettiysen veya değiştirdiysen (kapak, görsel, video) en sona ayrı bir satırda `GÖSTER: <data/media içindeki dosya adı>` yaz (birden çoksa virgülle, en çok 4); bir çıktının (runId) görselini ya da metnini değiştirdiysen onun runId'sini de bu satıra ekle. Uygulama bunları sohbette gösterir, kullanıcı sonucu orada görür.",
].filter(Boolean).join("\n\n");

// Sıra: bir değişiklik sürerken onaylanan yenisi
// düşmez, state.changeQueue'ya girer ve öncekisi bitince başlar. Sıra dosyada durur: sunucu kodu değişip yeniden başlarsa
// (restartServer) kalan iş yeni kodla, açılışta resumeChanges ile sürer. Her iş başlarken çalışma ağacı temiz olmalı (run denetler).
const MAX_QUEUE = 5;
let restarting = false;
const sayTo = (to, text) => update((s) => setChat(s, to, (l) => [...l, { role: "rou", text, at: new Date().toISOString() }]));

export function startChange(text, who, files) {
  if (!changeOn()) return { ok: false, error: "Rou'nun kod değişikliği kapalı" };
  text = String(text || "").trim().slice(0, 2000);
  if (!text) return { ok: false, error: "İstek boş" };
  const to = rouOf(read().state, who).id;
  const seen = (Array.isArray(files) ? files : []).map(mediaPath).filter(Boolean).slice(0, 8);
  const q = read().state.changeQueue ?? [];
  if (q.length >= MAX_QUEUE) return { ok: false, error: `Sırada zaten ${q.length} değişiklik var` };
  if (busy || restarting || q.length) {
    const n = q.length + 1;
    update((s) => void (s.changeQueue ??= []).push({ id: id(), text, rouId: to, seen, at: new Date().toISOString() }));
    sayTo(to, `Şu an başka bir değişiklik yapıyorum; bunu sıraya aldım (${n}. sırada). Öncekisi bitince kendiliğinden başlarım.`);
    return { ok: true, queued: n };
  }
  begin({ text, rouId: to, seen });
  return { ok: true };
}

const RETRY_MS = 2 * 60 * 1000, MAX_TRIES = 60;
let retry;
function begin(job) {
  busy = true;
  rouId = job.rouId;
  void run(job.text, job.seen).catch((e) => console.error("değişiklik:", e?.stack ?? e)).then((res) => {
    if (res !== "dirty") return;
    const tries = (job.tries ?? 0) + 1;
    if (tries > MAX_TRIES) return sayTo(job.rouId, `Değişikliği yapamadım: kodda iki saattir kaydedilmemiş başka bir iş duruyor. «${job.text.slice(0, 120)}» için yeniden onay ver.`);
    if (tries === 1) sayTo(job.rouId, "Kodda şu an yarım kalmış başka bir iş var. Bu değişikliği bekletiyorum; o iş kaydedilince kendiliğinden başlarım.");
    update((s) => void (s.changeQueue ??= []).unshift({ ...job, tries }));
    clearTimeout(retry);
    retry = setTimeout(drain, RETRY_MS);
  }).finally(() => { busy = false; if (!retry || (read().state.changeQueue?.[0]?.tries ?? 0) === 0) drain(); });
}

// Sıradaki işi başlatır; sunucu yeniden başlayacaksa bekler (yeni kodla açılışta sürer).
function drain() {
  retry = clearTimeout(retry);
  if (busy || restarting) return;
  let job;
  update((s) => { job = s.changeQueue?.shift(); if (job && !job.id) job.id = id(); if (s.changeQueue && !s.changeQueue.length) delete s.changeQueue; });
  if (job) begin(job);
}

// Açılışta: önceki süreçten kalan sıra sürer. Yarıda kalmış iş (sunucu o sırada kapandı) "Çalışıyor"da takılı kalmaz.
export function resumeChanges() {
  if (!changeOn()) return;
  const c = read().state.change;
  if (c && !c.done && !c.waiting && !busy) { log({ id: c.id, text: c.text, at: new Date().toISOString(), error: "Yarıda kaldı: uygulama yeniden başladı." }); phase({ phase: "Olmadı", error: "Yarıda kaldı: uygulama yeniden başladı.", done: true }); }
  drain();
}

async function run(text, seen) {
  const cid = id();
  const since = new Date();
  phase({ id: cid, text, phase: "Hazırlanıyor", rouId }, true);
  try {
    if ((await dirty()).length) { phase({ phase: "Bekliyor", waiting: true }); return "dirty"; }
    phase({ phase: "Çalışıyor" });
    const r = await runClaude(PROMPT(text, seen), 20 * 60 * 1000, undefined, { cwd: ROOT, args: ["--allowedTools", "Read,Edit,Write,Glob,Grep,Bash", "--permission-mode", "bypassPermissions"] });
    if (!r.ok) return fail(r.error.slice(0, 200), true);
    const files = await dirty();
    // Kod değişmediyse iş verideydi ya da sistemdeydi (ör. pg ile dünya açıldı): geri alınacak commit yok.
    if (!files.length) {
      phase({ phase: "Bitti", done: true });
      log({ id: cid, text, at: new Date().toISOString() });
      const o = shownOf(r.out, since);
      return say(o.text.slice(0, 600) || "Bitti.", undefined, o.extra);
    }
    phase({ phase: "Kontrol ediyor" });
    const c = await check(files);
    if (!c.ok) return fail(`${c.error} Kod değişikliği geri alındı (git stash'te duruyor).`, true);
    // Aynı anda başka bir oturum (Claude Code) commit ediyorsa index.lock bir an tutulu olur: biraz bekleyip bir kez daha denenir.
    const commit = async () => { await git("add", "-A"); return git("commit", "-q", "-m", `Rou: ${subject(text)}`, "-m", String(text)); };
    let m = await commit();
    if (!m.ok && /index\.lock/.test(m.out)) { await new Promise((r) => setTimeout(r, 3000)); m = await commit(); }
    if (!m.ok) return fail(`Commit edilemedi (${m.out.split("\n")[0].slice(0, 160)}); değişiklik geri alındı.`, true);
    const sha = (await git("rev-parse", "HEAD")).out;
    log({ id: cid, text, sha, at: new Date().toISOString() });
    const restart = serverSide(files);
    phase({ phase: "Bitti", done: true, code: true, ...(restart ? { restart: true } : {}) });
    const o = shownOf(r.out, since);
    say(o.text.slice(0, 600) || "Bitti.", { type: "undo_change", changeId: cid }, o.extra);
    if (restart) restartServer();
  } catch (e) {
    await fail(String(e).slice(0, 200), true);
  }
}

// serve.mjs altında çalışıyorsak 75 koduyla çıkılır, serve.mjs yeni kodla başlatır. npm run dev'de Vite'ı elle yeniden başlatmak gerekir.
// Süren hazırlık ve paylaşımlar bitene kadar beklenir (en çok 15 dk); yoksa yarıda kalıp "Hazırlanamadı" olurlar.
function restartServer() {
  if (process.env.PG_SUPERVISED) restarting = true;
  if (process.env.PG_SUPERVISED) void idle().then(() => setTimeout(() => process.exit(75), 400));
  else say("Sunucu kodu değişti; npm run dev'i yeniden başlatınca devreye girer.");
}

// Geçmiş (Rou sohbetinin Değişiklikler sekmesi): kod değişikliği (sha, Geri al), yalnız veri ya da sistem işi, olmayanlar (error).
const log = (c) => update((s) => { (s.changes ??= []).unshift(c); s.changes.splice(40); });

async function fail(msg, revert = false) {
  if (revert) await discard();
  const c = read().state.change;
  if (c?.id && !c.done) log({ id: c.id, text: c.text, at: new Date().toISOString(), error: msg });
  phase({ phase: "Olmadı", error: msg, done: true });
  say(`Değişikliği yapamadım. ${msg}`);
}

// Geri al: o değişikliğin commit'i git revert ile geri çevrilir, sonra yeniden derlenir.
export function undoChange(changeId, who) {
  if (!changeOn()) return { ok: false, error: "Rou'nun kod değişikliği kapalı" };
  if (busy || restarting) return { ok: false, error: "Rou şu an bir değişiklik yapıyor" };
  busy = true;
  rouId = rouOf(read().state, who).id;
  void (async () => {
    const c = read().state.changes?.find((x) => x.id === changeId && !x.undone);
    if (!c) return say("Geri alınacak değişikliği bulamadım.");
    if ((await dirty()).length) return say("Kodda kaydedilmemiş değişiklikler var; geri alamadım.");
    phase({ id: c.id, text: c.text, phase: "Geri alıyor", rouId }, true);
    const r = await git("revert", "--no-edit", c.sha);
    if (!r.ok) { await git("revert", "--abort"); phase({ phase: "Olmadı", done: true }); return say("Bu değişiklik sonradan başka değişikliklerle karıştığı için geri alınamadı."); }
    const files = (await git("show", "--name-only", "--format=", c.sha)).out.split("\n").filter(Boolean);
    const k = await check(files);
    update((s) => { const x = s.changes?.find((y) => y.id === c.id); if (x) x.undone = true; });
    const restart = k.ok && serverSide(files);
    phase({ phase: "Bitti", done: true, code: true, ...(restart ? { restart: true } : {}) });
    say(k.ok ? `Geri aldım: «${c.text}».` : `Geri aldım ama kontrol geçmedi: ${k.error}`);
    if (restart) restartServer();
  })().finally(() => { busy = false; drain(); });
  return { ok: true };
}
