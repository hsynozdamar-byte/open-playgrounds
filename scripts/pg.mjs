#!/usr/bin/env node
// pg: Playgrounds'a terminalden yazmak için (Claude da bunu kullanır).
//   pg add "Başlık" --pg <dünya> [--project <proje>] [--day bugün|yarın|pzt..paz|YYYY-MM-DD|tarihsiz] [--post <hesapId|@kullanıcı|platform> [--format linkedin] [--brief ".."] [--at 10:00]]  (--post: tek seferlik gönderi; Gönderiler'de görünür)
//          [--at 14:00 --min 90] [--est 60] [--deadline cum] [--status todo|doing|waiting|done] [--check "a;b"] [--notes ".."] [--who claude|me] [--by claude]
//   pg in "Başlık" [--pg <dünya>] [--source mail|slack|clickup|note|claude] [--from ".."] [--body ".."] [--url ..] [--suggest "İş başlığı"]
//   pg world "Ad" [--desc ".."] [--color "#3d5afe"]   pg wcolor <dünya> "#rrggbb" ["#ikinci"]   pg wkit <dünya> '{"alan":değer|null}'   pg project "Ad" --pg <dünya> [--deadline YYYY-MM-DD] [--desc ".."]
//   pg wdesc <dünya> "açıklama"   pg pmove <projeId> <dünya>   (proje işleri, blokları, otomasyonları, notları ve yalnız onun kullandığı hesaplarla taşınır)
//   pg block <taskId> <gün> <HH:MM> <dk>
//   pg brand <projeId> [--use ".."] [--avoid ".."] [--set]   (projenin marka alanlarına ekler, eskisini korur; --set verilen alanı tümden yazar)   pg aaction <otomasyonId> "talimat"   (otomasyonun talimatını değiştirir)   pg avisual <otomasyonId> "kural"   (otomasyonun görsel kural alanını yazar)   pg alang <hesapId> tr|en|tr+en   pg acolor <otomasyonId> "#rrggbb"|yok   (otomasyonun vurgu rengi; yalnız sonraki hazırlıklar)
//   pg src <projeId> "Başlık" --body ".." [--url ..]   (projenin Bilgi'sine not ya da bağlantı ekler)   pg srcrm <projeId> <kaynakId>   (Bilgi kaynağını Çöp Kutusu'na atar)
//   pg pedit <projeId> [--name ".."] [--desc ".."] [--ongoing] [--accounts "id,id"] [--brand-from <projeId>] [--media-dir <klasör> [--good "a.mp4;b.mp4"]]   (projeyi düzenler; --brand-from marka alanlarını aynen kopyalar)
//   pg aproject <otomasyonId> <projeId>   (otomasyonu projeye bağlar; açtığı işler ve hesabının planlı gönderileri de taşınır)
//   pg topic <işId> yok | pg topic <otomasyonId> "YYYY-MM-DD HH:MM" yok   (gönderinin konusunu boşaltır; Rou yenisini yazar)
//   pg aslot <otomasyonId> [--days her|hafta-içi|1,3] [--at "12:30,20:00"]   (otomasyonun günlerini ve saatlerini değiştirir; bugünün eksik işleri açılır)
//   pg auto "Başlık" --pg <dünya> --project X [--at "08:00,20:00"] [--min 30] --days her|hafta-içi|1,3 [--who claude|me] --action ".."   (otomasyon)
//          [--account <hesapId|@kullanıcı> [--format "ig_reel,ig_post"]] [--sharer claude|me]   (birden çok biçim: çalışmalar sırayla alır)
//   pg account "Ad" --pg <dünya> --platform instagram --handle "@kullanıcı" [--lang tr|en|tr+en] [--voice ".."] [--project <projeId>]   (paylaşım hesabı ekler)
//   pg avoice <hesapId> "ses"   (hesabın yazım sesini değiştirir)
//   pg aedit <hesapId> [--name ".."] [--handle "@yeni"] [--login ".."]   (hesabın görünen adını, kullanıcı adını, giriş adını değiştirir)
//   pg run <işId> "Başlık" --body ".." [--img "a.png;b.png"] [--video a.mp4] [--mention "Acme"] [--on cum]   (işin çıktısı; onay bekler)
//   pg run ... --items <json>   (Chrome otomasyonunun önerdiği öğeler)   pg pdf <html> <pdf>
//   pg due   (bugün Rou'nun hazırlayacağı, henüz çıktısı olmayan otomasyon işleri)   pg prepare <işId> [--revise "not"] [--img "a.png;b.png"] [--world <id>] [--project <id>] [--account <id>]   (Claude'a şimdi hazırlat; hedef verilirse gönderi oraya taşınır)   pg image <çıktıId>   (LinkedIn çıktısına eksik görseli üret)
//   pg propose '<json>' [--text "neden"] [--from "Claude Code"]   (dış araç Rou'ya öneri bırakır; tek eylem ya da {"type":"plan","steps":[..]}; kullanıcı uygulamada onaylar)
//   pg posted <çıktıId> --url "<adres>" | --error "<neden>"   (paylaşımın sonucunu yazar; paylaşılınca iş biter)
//   pg pb <dünya> [adres]   (Playgrounds tarayıcısında dünyanın profilini öne getirir; adres verilirse orada açar)   pg pb   (profiller, oturumlar, açık sekmeler)
//   pg notes [--pg <dünya>]   (Defter'de bekleyen notlar, kimlikleriyle)
//   pg start <id> [--pomo]   pg stop   pg now
//   pg rmedia <çıktıId> --from <çıktıId>   (başka bir çıktının videosunu ve görsellerini/kapağını bu çıktıya taşır; metin aynen kalır)
//   pg tnote <id> "metin"   (işin notuna ekler)   pg done <id>   pg status <id> <durum>   pg move <id> <gün>   pg rm <id | çıktıId>
//   pg list [--week] [--pg <dünya>]   pg worlds   pg json
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { read, update, id, MEDIA_DIR, DATA_DIR } from "../server/store.mjs";
import { toTrash } from "../shared/trash.mjs";
import { newWorld, moveProjectTo } from "../shared/world.mjs";
import { materialize, needsMaterialize, setDay } from "../shared/repeat.mjs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { HEADLESS } from "../shared/headless.mjs";
import { expandHome, mediaKey } from "../shared/platform.mjs";
import { formatOf, formatsOf, postOfText, PLATFORMS, accountById, isFeed } from "../shared/social.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const args = { _: [] };
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) args[rest[i].slice(2)] = rest[i + 1]?.startsWith("--") || rest[i + 1] === undefined ? true : rest[++i];
  else args._.push(rest[i]);
}
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Tam ad ya da üç harfli kısaltma. İlk üç harfe bakılırsa "pazartesi" pazar, "cumartesi" cuma olur (öyle kısaltılmasın).
const DAYS = { pazartesi: 1, pzt: 1, salı: 2, sali: 2, sal: 2, çarşamba: 3, carsamba: 3, çar: 3, car: 3, perşembe: 4, persembe: 4, per: 4, cuma: 5, cum: 5, cumartesi: 6, cmt: 6, pazar: 0, paz: 0 };
function parseDay(v, fallback) {
  if (v === undefined || v === true) return fallback;
  const s = String(v).toLocaleLowerCase("tr");
  if (["tarihsiz", "sonra", "-"].includes(s)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date();
  if (["bugün", "bugun"].includes(s)) return iso(d);
  if (["yarın", "yarin"].includes(s)) return d.setDate(d.getDate() + 1), iso(d);
  const k = DAYS[s];
  if (k !== undefined) return d.setDate(d.getDate() + (((k - d.getDay() + 7) % 7) || 7)), iso(d);
  throw new Error(`Gün anlaşılamadı: ${v}`);
}
const norm = (s) => String(s).toLocaleLowerCase("tr").replace(/\s+/g, "");
function world(s, v, optional) {
  if (!v || v === true) { if (optional) return null; throw new Error(`--pg gerekli: ${s.worlds.map((w) => w.id).join(", ")}`); }
  const w = s.worlds.find((w) => w.id === v || norm(w.name) === norm(v));
  if (!w) throw new Error(`Dünya yok: ${v}. Var olanlar: ${s.worlds.map((w) => w.id).join(", ")}`);
  return w;
}
function project(s, w, name) {
  if (!name || name === true) return null;
  // Proje kimliği de verilebilir (ör. --project qndiql); yoksa adla eşleşir, o da yoksa yeni proje açılır.
  let p = s.projects.find((p) => p.worldId === w.id && (p.id === String(name) || norm(p.name) === norm(name)));
  if (!p) s.projects.push((p = { id: id(), worldId: w.id, name, description: "", status: "active", deadline: null }));
  return p.id;
}
// Boş kimlik (ör. boş kalmış bir kabuk değişkeni) her kimliğin başıyla eşleşir ve ilk işi seçerdi: `pg rm ""` onu Çöp'e atardı.
const find = (s, ref) => { if (typeof ref !== "string" || !ref.trim()) throw new Error("İş kimliği gerekli"); const t = s.tasks.find((x) => x.id.startsWith(ref)); if (!t) throw new Error(`İş yok: ${ref}`); return t; };
const now = () => new Date().toISOString();
const addMin = (day, hm, m) => { const [h, mi] = hm.split(":").map(Number); const t = Math.min(24 * 60 - 1, h * 60 + mi + m); return `${day}T${pad(Math.floor(t / 60))}:${pad(t % 60)}`; };
function setStatus(t, st) { t.status = st; if (st === "done") t.doneAt = now(); else delete t.doneAt; }
// Çalışan odak süresini oturum olarak kaydeder (uygulamadaki timer.ts ile aynı kural).
function commit(s) {
  const t = s.timer;
  if (!t || t.phase !== "focus") return;
  const sec = t.pausedAt ? 0 : Math.floor((Date.now() - new Date(t.startedAt)) / 1000);
  const len = t.mode === "pomo" ? Math.min(sec, Math.max(0, t.length * 60 - (t.base ?? 0))) : sec;
  if (len < 60) return;
  const a = new Date(t.startedAt);
  s.sessions.push({ id: id(), taskId: t.taskId, start: a.toISOString(), end: new Date(a.getTime() + len * 1000).toISOString(), mode: t.mode });
}
let out = "";

try {
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    // Bu dosyanın başındaki açıklama komutların listesidir.
    const lines = fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1);
    out = lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n");
  } else if (cmd === "add") {
    update((s) => {
      const w = world(s, args.pg);
      const day = parseDay(args.day, args.at ? iso(new Date()) : null);
      const t = {
        id: id(), worldId: w.id, projectId: project(s, w, args.project), title: args._.join(" "), notes: args.notes || "",
        status: args.status || "todo", day, deadline: args.deadline ? parseDay(args.deadline) : null,
        estimate: args.est ? +args.est : args.min ? +args.min : null,
        checklist: args.check ? String(args.check).split(";").map((x) => ({ id: id(), text: x.trim(), done: false })) : [],
        by: args.by || "me", createdAt: now(),
      };
      if (!t.title) throw new Error("Başlık gerekli");
      // --who claude|me: işi Rou'ya atar (verilmezse kullanıcının).
      if (["claude", "me"].includes(args.who)) t.who = args.who;
      // --post <hesapId|@kullanıcı|platform>: tek seferlik gönderi. Görev Gönderiler'de görünür, kimin hesabından paylaşılacağı bellidir.
      if (args.post) {
        const accs = w.accounts ?? [];
        const q = String(args.post === true ? "" : args.post).replace(/^@/, "").toLowerCase();
        const own = t.projectId ? s.projects.find((p) => p.id === t.projectId)?.accountIds ?? [] : [];
        const acc = accs.find((a) => a.id === q) ?? accs.find((a) => String(a.handle ?? "").replace(/^@/, "").toLowerCase() === q)
          ?? accs.filter((a) => a.platform === q).sort((x, y) => Number(own.includes(y.id)) - Number(own.includes(x.id)))[0]
          // Kimlikle verilen başka dünyanın hesabı (ör. başka dünyanın hesabından): yalnız tam kimlik, kullanıcı adı ya da platform değil.
          ?? (() => { const a = accountById(s, String(args.post)); return a && !isFeed(a.platform) ? a : undefined; })();
        if (!acc) throw new Error(`Hesap yok: ${args.post}. Bu dünyanın hesapları: ${accs.map((a) => `${a.id} ${a.platform} ${a.handle ?? a.name}`).join(", ") || "yok"}`);
        const format = args.format && args.format !== true ? String(args.format) : formatsOf(acc.platform)[0];
        if (!formatsOf(acc.platform).includes(format)) throw new Error(`${acc.platform} için biçim: ${formatsOf(acc.platform).join(" | ")}`);
        if (t.by === "claude") t.who = "claude";
        t.post = { accountId: acc.id, format, brief: args.brief && args.brief !== true ? String(args.brief) : t.notes, ...(args.at ? { at: String(args.at) } : {}) };
      }
      s.tasks.push(t);
      if (args.at && day) s.blocks.push({ id: id(), taskId: t.id, worldId: w.id, title: "", start: `${day}T${args.at}`, end: addMin(day, args.at, +(args.min || 60)), kind: "plan" });
      out = `+ ${t.id}  [${w.id}] ${t.title}  (${day ?? "tarihsiz"}${args.at ? " " + args.at : ""})`;
    });
  } else if (cmd === "in") {
    update((s) => {
      const w = world(s, args.pg, true);
      const i = { id: id(), worldId: w?.id ?? null, source: args.source || "claude", from: args.from || "", url: args.url || "", title: args._.join(" "), body: args.body || "", receivedAt: now(), state: "new", ...(args.suggest ? { suggestion: { title: args.suggest } } : {}) };
      s.inbox.unshift(i);
      out = `+ gelen ${i.id}  ${i.title}`;
    });
  } else if (cmd === "world") {
    update((s) => {
      const name = args._.join(" ").trim();
      if (!name) throw new Error("Dünya adı gerekli");
      if (s.worlds.some((w) => norm(w.name) === norm(name))) throw new Error(`Bu adla bir dünya var: ${name}`);
      const w = newWorld(s, name, args.desc || "", args.color);
      s.worlds.push(w);
      out = `+ dünya ${w.id}`;
    });
  } else if (cmd === "wcolor") {
    update((s) => {
      const w = world(s, args._[0]);
      const c = String(args._[1] || "");
      if (!/^#[0-9a-f]{6}$/i.test(c)) throw new Error("Renk #rrggbb olmalı");
      w.color = c;
      const c2 = String(args._[2] || "");
      if (c2 && !/^#[0-9a-f]{6}$/i.test(c2)) throw new Error("İkinci ton #rrggbb olmalı");
      if (c2) w.color2 = c2; else delete w.color2;
      out = `~ dünya ${w.id} ${c}${c2 ? ` + ${c2}` : ""}`;
    });
  } else if (cmd === "wkit") {
    // Dünyanın görsel kitini (world.kit) günceller: verilen alanlar yazılır, null olan silinir.
    update((s) => {
      const w = world(s, args._[0]);
      let patch;
      try { patch = JSON.parse(String(args._[1] ?? "")); } catch { throw new Error("Kit JSON nesnesi olmalı"); }
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Kit JSON nesnesi olmalı");
      const kit = { ...(w.kit ?? {}) };
      for (const [k, v] of Object.entries(patch)) if (v === null) delete kit[k]; else kit[k] = v;
      w.kit = kit;
      out = `~ kit ${w.id} ${Object.keys(patch).join(", ")}`;
    });
  } else if (cmd === "wdesc") {
    update((s) => {
      const w = world(s, args._[0]);
      w.description = args._.slice(1).join(" ").trim();
      out = `~ dünya ${w.id} açıklama`;
    });
  } else if (cmd === "brand") {
    update((s) => {
      const p = s.projects.find((x) => x.id === args._[0]);
      if (!p) throw new Error(`Proje yok: ${args._[0]}`);
      p.brand = { ...(p.brand || {}) };
      for (const k of ["use", "avoid"]) if (args[k] && args[k] !== true) p.brand[k] = [args.set ? "" : p.brand[k], String(args[k]).trim()].filter(Boolean).join("\n");
      out = `~ proje ${p.id} marka`;
    });
  } else if (cmd === "avoice") {
    update((s) => {
      const acc = s.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === args._[0]);
      if (!acc) throw new Error(`Hesap yok: ${args._[0]}`);
      acc.voice = args._.slice(1).join(" ").trim();
      out = `~ hesap ${acc.id} ses`;
    });
  } else if (cmd === "aedit") {
    update((s) => {
      const acc = s.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === args._[0]);
      if (!acc) throw new Error(`Hesap yok: ${args._[0]}`);
      if (args.name && args.name !== true) acc.name = String(args.name).trim();
      if (args.handle && args.handle !== true) {
        const h = String(args.handle).trim();
        acc.handle = /^[\w.]+$/.test(h) ? `@${h}` : h;
        delete acc.check;  // eski kullanıcı adının kontrolü artık geçmez
      }
      if (args.login && args.login !== true) acc.login = String(args.login).trim();
      out = `~ hesap ${acc.id}  ${acc.name} ${acc.handle ?? ""}${acc.login ? `  giriş ${acc.login}` : ""}`;
    });
  } else if (cmd === "account") {
    update((s) => {
      const w = world(s, args.pg);
      const name = args._.join(" ").trim();
      if (!name) throw new Error("Hesap adı gerekli");
      const platform = String(args.platform ?? "");
      if (!PLATFORMS[platform]) throw new Error(`Platform: ${Object.keys(PLATFORMS).join(" | ")}`);
      const lang = args.lang && args.lang !== true ? String(args.lang) : undefined;
      if (lang && !["tr", "en", "tr+en"].includes(lang)) throw new Error("Dil: tr | en | tr+en");
      const h = args.handle && args.handle !== true ? String(args.handle).trim() : "";
      const handle = /^[\w.]+$/.test(h) ? `@${h}` : h;
      if (handle && (w.accounts ?? []).some((x) => x.platform === platform && x.handle === handle)) throw new Error(`Bu hesap zaten var: ${handle}`);
      const p = args.project && args.project !== true ? s.projects.find((x) => x.id === args.project && x.worldId === w.id) : null;
      if (args.project && !p) throw new Error(`Bu dünyada proje yok: ${args.project}`);
      const acc = { id: id(), platform, name, handle, voice: args.voice && args.voice !== true ? String(args.voice).trim() : "", lang: lang ?? "en" };
      w.accounts = [...(w.accounts ?? []), acc];
      if (p) p.accountIds = [...(p.accountIds ?? []), acc.id];
      out = `+ hesap ${acc.id}  ${acc.name} ${acc.handle}${p ? `  proje ${p.id}` : ""}`;
    });
  } else if (cmd === "alang") {
    update((s) => {
      const acc = s.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === args._[0]);
      if (!acc) throw new Error(`Hesap yok: ${args._[0]}`);
      if (!["tr", "en", "tr+en"].includes(args._[1])) throw new Error("Dil: tr | en | tr+en");
      acc.lang = args._[1];
      out = `~ hesap ${acc.id} dil ${acc.lang}`;
    });
  } else if (cmd === "rmedia") {
    update((s) => {
      const r = s.runs.find((x) => x.id === args._[0]);
      const src = s.runs.find((x) => x.id === args.from);
      if (!r) throw new Error(`Çıktı yok: ${args._[0]}`);
      if (!src) throw new Error(`Kaynak çıktı yok: ${args.from}`);
      if (!src.video && !src.images?.length) throw new Error(`${src.id} çıktısında video ya da görsel yok`);
      for (const f of [src.video, ...(src.images ?? [])].filter(Boolean)) if (!fs.existsSync(path.join(DATA_DIR, f))) throw new Error(`Dosya yok: ${f}`);
      if (src.video) r.video = src.video; else delete r.video;
      r.images = [...(src.images ?? [])];
      if (src.kitHash) r.kitHash = src.kitHash;
      out = `~ çıktı ${r.id}: ${[r.video, ...r.images].join(", ")} (${src.id} çıktısından)`;
    });
  } else if (cmd === "aaction") {
    update((s) => {
      const a = s.automations.find((x) => x.id === args._[0]);
      if (!a) throw new Error(`Otomasyon yok: ${args._[0]}`);
      a.action = args._.slice(1).join(" ").trim();
      out = `~ otomasyon ${a.id} talimat`;
    });
  } else if (cmd === "avisual") {
    update((s) => {
      const a = s.automations.find((x) => x.id === args._[0]);
      if (!a) throw new Error(`Otomasyon yok: ${args._[0]}`);
      a.visual = args._.slice(1).join(" ").trim();
      out = `~ otomasyon ${a.id} görsel kural`;
    });
  } else if (cmd === "acolor") {
    const { isHex } = await import("../shared/series.mjs");
    const v = String(args._[1] ?? "").toLowerCase();
    if (v !== "yok" && !isHex(v)) throw new Error('Renk: "#rrggbb" ya da yok');
    update((s) => {
      const a = s.automations.find((x) => x.id === args._[0]);
      if (!a) throw new Error(`Otomasyon yok: ${args._[0]}`);
      if (v === "yok") delete a.color;
      else a.color = v;
      out = `~ otomasyon ${a.id} renk ${a.color ?? "yok"}`;
    });
  } else if (cmd === "aslot") {
    update((s) => {
      const a = s.automations.find((x) => x.id === args._[0]);
      if (!a) throw new Error(`Otomasyon yok: ${args._[0]}`);
      if (args.days && args.days !== true) { const d = String(args.days); a.days = d === "her" ? [0, 1, 2, 3, 4, 5, 6] : d === "hafta-içi" ? [1, 2, 3, 4, 5] : d.split(",").map(Number); }
      if (args.at && args.at !== true) a.times = String(args.at).split(",").map((x) => x.trim()).filter(Boolean).sort();
      // Uygulamadaki gibi: günler/saatler değişince horizon sıfırlanır, bugünün eksik işleri açılır.
      a.horizon = null;
      materialize(s);
      out = `~ otomasyon ${a.id}  günler ${a.days.join(",")}  saatler ${a.times.join(", ") || "-"}`;
    });
  } else if (cmd === "pedit") {
    update((s) => {
      const p = s.projects.find((x) => x.id === args._[0]);
      if (!p) throw new Error(`Proje yok: ${args._[0]}`);
      if (args.name && args.name !== true) p.name = String(args.name).trim();
      if (args.desc && args.desc !== true) p.description = String(args.desc).trim();
      // --icon <png>: uygulama ikonu (kapakta kelime logosu yerine). --icon yok: siler.
      if (args.icon === "yok") delete p.icon;
      else if (args.icon && args.icon !== true) {
        const f = path.resolve(String(args.icon));
        if (!fs.existsSync(f) || !/\.(png|jpe?g|webp)$/i.test(f)) throw new Error(`İkon görseli yok: ${f}`);
        p.icon = f;
      }
      if (args.ongoing) p.ongoing = true;
      // --media-dir <klasör> [--good "a.mp4;b.mp4"]: projenin Medya klasörü (dosyalar yerinde kalır) ve İyi işaretlenen dosyaları.
      if (args["media-dir"] && args["media-dir"] !== true) {
        const dir = path.resolve(expandHome(args["media-dir"], os.homedir()));
        if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Klasör yok: ${dir}`);
        p.mediaDir = dir;
      }
      if (args.good && args.good !== true) {
        if (!p.mediaDir) throw new Error("Önce --media-dir ver");
        for (const rel of String(args.good).split(";").map((x) => x.trim()).filter(Boolean)) {
          const f = path.resolve(p.mediaDir, rel);
          if (!f.startsWith(p.mediaDir + path.sep) || !fs.existsSync(f)) throw new Error(`Medya klasöründe yok: ${rel}`);
          (p.media ??= {})[mediaKey(path.relative(p.mediaDir, f))] = "good";
        }
      }
      if (args.accounts && args.accounts !== true) p.accountIds = String(args.accounts).split(",").map((x) => x.trim()).filter(Boolean);
      if (args["brand-from"]) {
        const src = s.projects.find((x) => x.id === args["brand-from"]);
        if (!src) throw new Error(`Proje yok: ${args["brand-from"]}`);
        p.brand = structuredClone(src.brand || {});
      }
      out = `~ proje ${p.id}  ${p.name}`;
    });
  } else if (cmd === "aproject") {
    update((s) => {
      const a = s.automations.find((x) => x.id === args._[0]);
      if (!a) throw new Error(`Otomasyon yok: ${args._[0]}`);
      const p = s.projects.find((x) => x.id === args._[1]);
      if (!p) throw new Error(`Proje yok: ${args._[1]}`);
      const from = a.projectId;
      a.projectId = p.id;
      // Çıktılar işe bağlı (run.taskId), işle birlikte gelir.
      let n = 0;
      for (const t of s.tasks) if (t.autoId === a.id || (a.accountId && t.post?.accountId === a.accountId && t.projectId === from)) { t.projectId = p.id; n++; }
      out = `→ otomasyon ${a.id} ${p.id}  ${n} iş taşındı`;
    });
  } else if (cmd === "pmove") {
    update((s) => {
      const p = s.projects.find((x) => x.id === args._[0]);
      if (!p) throw new Error(`Proje yok: ${args._[0]}`);
      const w = world(s, args._[1]);
      moveProjectTo(s, p.id, w.id);
      out = `→ proje ${p.id} ${w.id}`;
    });
  } else if (cmd === "project") {
    update((s) => {
      const w = world(s, args.pg);
      const pid = project(s, w, args._.join(" "));
      const p = s.projects.find((x) => x.id === pid);
      if (args.deadline) p.deadline = parseDay(args.deadline);
      if (args.desc) p.description = args.desc;
      out = `+ proje ${pid}`;
    });
  } else if (cmd === "block") {
    update((s) => {
      const t = find(s, args._[0]);
      const day = parseDay(args._[1]);
      s.blocks.push({ id: id(), taskId: t.id, worldId: t.worldId, title: "", start: `${day}T${args._[2]}`, end: addMin(day, args._[2], +(args._[3] || 60)), kind: "plan" });
      if (!t.day) t.day = day;
      out = `+ blok ${day} ${args._[2]}`;
    });
  } else if (cmd === "auto") {
    // Otomasyon: seçili günlerde her saat için iş açılır. --who claude: Claude hazırlar, kullanıcı onaylar.
    update((s) => {
      const w = world(s, args.pg);
      const d = String(args.days || "her");
      const days = d === "her" ? [0, 1, 2, 3, 4, 5, 6] : d === "hafta-içi" ? [1, 2, 3, 4, 5] : d.split(",").map(Number);
      const a = { id: id(), worldId: w.id, projectId: project(s, w, args.project), title: args._.join(" "), action: args.action && args.action !== true ? args.action : "", times: args.at && args.at !== true ? String(args.at).split(",").map((x) => x.trim()).filter(Boolean).sort() : [], minutes: +(args.min || 30), days, status: "active", who: args.who === "me" ? "me" : "claude", horizon: null, createdAt: now() };
      if (!a.title) throw new Error("Başlık gerekli");
      // --account <hesapId|@kullanıcı>: dünyanın paylaşım hesabı. --format "ig_reel,ig_post": birden çoksa çalışmalar sırayla alır.
      if (args.account && args.account !== true) {
        const ref = String(args.account).replace(/^@/, "").toLowerCase();
        const acc = (w.accounts ?? []).find((x) => x.id === args.account || String(x.handle || "").replace(/^@/, "").toLowerCase() === ref);
        if (!acc) throw new Error(`Hesap yok: ${args.account}`);
        a.accountId = acc.id;
        if (args.format && args.format !== true) {
          const list = String(args.format).split(",").map((x) => x.trim()).filter(Boolean);
          const bad = list.find((f) => !formatsOf(acc.platform).includes(f));
          if (bad) throw new Error(`Biçim ${acc.platform} hesabına uymuyor: ${bad}`);
          a.format = list[0];
          if (list.length > 1) { a.formats = list; a.formatsFrom = iso(new Date()); } // sıra yerel bugünden sayılır
        }
      }
      if (["claude", "me"].includes(args.sharer)) a.sharer = args.sharer;
      (s.automations ??= []).push(a);
      materialize(s);
      out = `+ otomasyon ${a.id}  ${a.title}`;
    });
  } else if (cmd === "run") {
    // pg run <işId> "Çıktı başlığı" --body "Hazırlanan metin" [--img "a.png;b.png"] [--on cum]
    // Eski kullanım: <otomasyonId> verilirse serinin bugünkü işine bağlanır. Görseller data/media'ya kopyalanır.
    const { parseItems, folderOf } = args.items ? await import("../server/browse.mjs") : {};
    update((s) => {
      materialize(s);
      const ref = String(args._[0] ?? "");
      let task = ref && s.tasks.find((x) => x.id.startsWith(ref));
      if (!task) {
        const a = (s.automations ?? []).find((x) => x.id.startsWith(ref));
        if (!a) throw new Error(`İş ya da tekrarlayan iş yok: ${ref}`);
        task = s.tasks.filter((x) => x.autoId === a.id).sort((x, y) => String(y.day).localeCompare(String(x.day)))[0];
        if (!task) throw new Error(`Bu serinin henüz bir işi yok: ${a.title}`);
      }
      const rid = id();
      const images = args.img && args.img !== true ? String(args.img).split(";").map((f) => f.trim()).filter(Boolean).map((f, i) => {
        if (!fs.existsSync(f)) throw new Error(`Görsel yok: ${f}`);
        fs.mkdirSync(MEDIA_DIR, { recursive: true });
        const name = `${rid}-${i}${path.extname(f).toLowerCase()}`;
        fs.copyFileSync(f, path.join(MEDIA_DIR, name));
        return `media/${name}`;
      }) : [];
      let video;
      if (args.video && args.video !== true) {
        const f = String(args.video);
        if (!fs.existsSync(f)) throw new Error(`Video yok: ${f}`);
        fs.mkdirSync(MEDIA_DIR, { recursive: true });
        fs.copyFileSync(f, path.join(MEDIA_DIR, `${rid}${path.extname(f).toLowerCase()}`));
        video = `media/${rid}${path.extname(f).toLowerCase()}`;
      }
      // --items <json dosyası>: Chrome otomasyonunun önerdiği öğeler (onaylanınca uygulamadan yapılır).
      let items;
      if (args.items && args.items !== true) {
        const a = s.automations.find((x) => x.id === task.autoId);
        if (!a) throw new Error("--items yalnız otomasyon işlerinde");
        items = parseItems(JSON.parse(fs.readFileSync(String(args.items), "utf8")), folderOf(a));
      }
      const body = args.body && args.body !== true ? String(args.body) : "";
      // Gönderi görevinin çıktısı gönderinin kendisidir: önizleme, onay ve paylaşım run.post'u okur.
      // --mention "Acme;..." : paylaşırken etiketlenecek sayfalar (paylaşan @Ad'ı platform önerisinden seçer).
      const mentions = args.mention && args.mention !== true ? String(args.mention).split(";").map((x) => x.trim().replace(/^@/, "")).filter(Boolean) : [];
      // Otomasyon görevinde biçim otomasyondan gelir (hesaplı otomasyon: tweet, linkedin...).
      const auto = s.automations.find((x) => x.id === task.autoId);
      const format = task.post?.format ?? (auto?.accountId ? formatOf(s, auto) ?? undefined : undefined);  // format boşsa hesabın platformundan
      const post = format ? { ...postOfText(format, body), ...(mentions.length ? { mentions } : {}) } : undefined;
      if (!post && task.projectId && s.projects.find((p) => p.id === task.projectId)?.accountIds?.length && (video || images.length))
        console.error(`Uyarı: ${task.id} bir gönderi görevi değil; Gönderiler'de görünmez, kimin paylaşacağı belli olmaz. Paylaşılacaksa görevi pg add ... --post <hesap> ile aç.`);
      const r = { id: rid, taskId: task.id, at: now(), title: args._.slice(1).join(" ") || task.title, body, status: "ready", images, ...(video ? { video } : {}), ...(post ? { post } : {}), ...(items ? { items } : {}), on: args.on ? parseDay(args.on) : null, by: args.by && args.by !== true ? String(args.by) : "claude" };
      (s.runs ??= []).unshift(r);
      out = `+ çıktı ${r.id}  ${r.title} → ${task.id}`;
    });
  } else if (cmd === "posted") {
    // pg posted <çıktıId> --url "<gönderi adresi>" | --error "<neden>"   (paylaşımın sonucunu yazar)
    const { markPosted } = await import("../server/share.mjs");
    update((s) => {
      const r = markPosted(s, String(args._[0] ?? ""), { url: args.url && args.url !== true ? String(args.url) : undefined, error: args.error && args.error !== true ? String(args.error) : undefined });
      out = r.status === "posted" ? `Paylaşıldı: ${r.title}${r.postUrl ? `  ${r.postUrl}` : ""}` : `Paylaşılamadı olarak yazıldı: ${r.title}`;
    });
    // Kullanıcı uygulamada değilse de haberi olsun (bildirim; uygulamada ayrıca bildirim ve Bugün'de "Paylaşılanlar").
    const { notify } = await import("../server/notify.mjs");
    notify(out.startsWith("Paylaşıldı") ? "Gönderi paylaşıldı" : "Gönderi paylaşılamadı", out.replace(/^Paylaş[^:]*: /, "").slice(0, 140));
  } else if (cmd === "pb") {
    // Playgrounds tarayıcısı (server/pb.mjs): her dünya bir profil.
    const P = await import("../server/pb.mjs");
    const { state: s } = read();
    if (args._[0]) {
      const w = world(s, args._[0]);
      const r = await P.openProfile(w, args._[1]);
      if (!r.ok) throw new Error(r.error);
      out = `${P.PB_NAME} · ${w.name} profili önde${args._[1] ? `: ${args._[1]}` : ""}`;
    } else {
      const st = await P.pbState(s);
      if (!st.installed) throw new Error(`${P.PB_NAME} masaüstü uygulaması açık değil`);
      out = [`${P.PB_NAME}: ${st.running ? "açık" : "kapalı"}`, ...st.profiles.map((p) => {
        const w = s.worlds.find((x) => x.id === p.worldId);
        const accs = (w.accounts ?? []).map((a) => `${a.handle || a.name} ${p.accounts[a.id] ? "✓" : p.accounts[a.id] === false ? "giriş yok" : "?"}`);
        return [`${w.name} (${w.id})${p.open ? " · açık" : ""}`, accs.length ? `  hesaplar: ${accs.join(", ")}` : "", ...p.pages.map((x) => `  - ${x.title || x.url}  ${x.url}`)].filter(Boolean).join("\n");
      })].join("\n");
    }
  } else if (cmd === "due") {
    const STALE_MS = 6 * 60 * 1000; // uygulamadaki gibi: 6 dakikadır "hazırlanıyor" kalan çıktı yarıda kalmıştır
    // pg due: bugün Rou'nun hazırlaması gereken, henüz çıktısı olmayan otomasyon işleri.
    if (needsMaterialize(read().state)) update((s) => void materialize(s));
    const { state: s } = read();
    const today = iso(new Date());
    const list = s.tasks.filter((t) => {
      const a = s.automations.find((x) => x.id === t.autoId);
      return t.day === today && t.status !== "done" && a && a.who === "claude" && !s.runs.some((r) => r.taskId === t.id && (["ready", "approved"].includes(r.status) || (r.status === "working" && Date.now() - new Date(r.at) < STALE_MS)));
    });
    for (const t of list) {
      const a = s.automations.find((x) => x.id === t.autoId);
      const w = s.worlds.find((x) => x.id === t.worldId);
      const p = s.projects.find((x) => x.id === t.projectId);
      out += `${t.id}  ${t.title}${t.autoSlot ? "  " + t.autoSlot : ""}  [${w?.name ?? t.worldId}${p ? " › " + p.name : ""}]  hazırlayan: ${a.who}\n   ${a.browser ? `Chrome'da yapılır; tam talimat: pg brief ${t.id}` : `talimat: ${a.action || "(yok)"}`}\n`;
    }
    if (!list.length) out = "Bugün hazırlanacak iş yok.";
  } else if (cmd === "pdf") {
    // pg pdf <html> <pdf>: HTML'den A4 PDF (sistemdeki Chrome, geçici ayrı profil; açık Chrome'a dokunmaz).
    const [src, dst] = args._.map((x) => path.resolve(String(x)));
    if (!src || !dst || !fs.existsSync(src)) throw new Error("Kullanım: pg pdf <html dosyası> <pdf dosyası>");
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), "pg-pdf-"));
    spawnSync(HEADLESS, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${prof}`, "--no-pdf-header-footer", `--print-to-pdf=${dst}`, pathToFileURL(src).href], { stdio: "ignore", timeout: 60000 });
    fs.rmSync(prof, { recursive: true, force: true });
    if (!fs.existsSync(dst)) throw new Error("PDF üretilemedi");
    out = `PDF: ${dst}`;
  } else if (cmd === "propose") {
    // Dış araçlar (Claude Code, MCP, başka bir ajan) veriyi doğrudan değiştirmek yerine öneri bırakır.
    // Öneri Rou sohbetinde kart olarak çıkar; kimlikler uygulamada doğrulanır, yalnız Onayla ile uygulanır.
    let action;
    try { action = JSON.parse(args._[0] ?? ""); } catch { throw new Error("Öneri JSON değil. Örnek: pg propose '{\"type\":\"done\",\"taskId\":\"abc123\"}'"); }
    if (Array.isArray(action)) action = { type: "plan", title: typeof args.title === "string" ? args.title : "", steps: action };
    if (!action || typeof action.type !== "string") throw new Error("Önerinin type alanı yok");
    if (["change", "undo_change"].includes(action.type)) throw new Error("Bu öneri tipi dışarıdan bırakılamaz");
    const name = typeof args.from === "string" ? args.from.slice(0, 40) : "Claude Code";
    const text = typeof args.text === "string" ? args.text.slice(0, 2000) : "Bir öneri bıraktım.";
    update((s) => {
      (s.talk ??= []).push({ id: id(), from: "agent", name, text, at: now(), action });
      s.talk = s.talk.slice(-60);
    });
    out = "Öneri Rou'ya bırakıldı. Kullanıcı uygulamada onaylarsa uygulanır.";
  } else if (cmd === "notes") {
    const { state: s } = read();
    const w = args.pg ? world(s, args.pg) : null;
    const list = s.inbox.filter((i) => i.state === "new" && (!w || i.worldId === w.id));
    const wn = (x) => s.worlds.find((y) => y.id === x)?.name;
    const pn = (x) => s.projects.find((y) => y.id === x)?.name;
    out = list.length ? list.map((i) => `${i.id}  ${i.title}${i.worldId ? `  [${[wn(i.worldId), pn(i.projectId)].filter(Boolean).join(" › ")}]` : ""}${i.body ? `\n    ${i.body.replace(/\n/g, "\n    ")}` : ""}`).join("\n") : "Defter boş.";
  } else if (cmd === "prepare") {
    const { prepare } = await import("../server/prepare.mjs");
    // --revise "not" [--world <id>] [--project <id>] [--account <id>]: revize; hedef verilirse gönderi oraya taşınır.
    const str = (v) => (v && v !== true ? String(v) : undefined);
    const move = args.world || args.project || args.account ? { worldId: str(args.world), projectId: str(args.project), accountId: str(args.account) } : undefined;
    // --img "a.png;b.png": revizeye eklenen görseller (Rou ekleri gibi data/media/rou-*), çıktıya bunlar girer, ayrıca görsel üretilmez.
    const files = (str(args.img) ?? "").split(";").map((f) => f.trim()).filter(Boolean).map((f) => {
      if (!fs.existsSync(f) || !/\.(png|jpe?g|webp)$/i.test(f)) throw new Error(`Görsel yok: ${f}`);
      const file = `rou-${id()}${path.extname(f).toLowerCase()}`;
      fs.mkdirSync(MEDIA_DIR, { recursive: true });
      fs.copyFileSync(f, path.join(MEDIA_DIR, file));
      return { file, kind: "image", name: path.basename(f) };
    });
    const r = prepare(find(read().state, args._[0]).id, str(args.revise), files, move);
    if (!r.ok) throw new Error(r.error);
    await r.done;
    const run = read().state.runs.find((x) => x.id === r.runId);
    out = run?.status === "ready" ? `Hazır: ${run.title}. Uygulamada onay bekliyor.` : `Hazırlanamadı: ${run?.body?.slice(0, 200) ?? "?"}`;
  } else if (cmd === "image") {
    // LinkedIn çıktısına eksik görseli üretir; metin aynı kalır, onaylıysa onay geri alınır (görselle yeniden onaylanır).
    const { makeImage } = await import("../server/prepare.mjs");
    const r = makeImage(args._[0]);
    if (!r.ok) throw new Error(r.error);
    await r.done;
    const run = read().state.runs.find((x) => x.id === r.runId);
    out = run?.images?.length ? `Görsel hazır: ${run.title}. Uygulamada onay bekliyor.` : `Görsel üretilemedi: ${run?.renderError ?? "?"}`;
  } else if (cmd === "start") {
    update((s) => {
      const t = find(s, args._[0]);
      commit(s);
      setStatus(t, "doing");
      s.timer = { taskId: t.id, startedAt: now(), mode: args.pomo ? "pomo" : "free", phase: "focus", length: args.pomo ? 25 : 0, round: 1 };
      out = `▶ ${t.title}`;
    });
  } else if (cmd === "stop") {
    update((s) => { commit(s); s.timer = null; });
    out = "■";
  } else if (cmd === "now") {
    const { state: s } = read();
    const t = s.timer, task = t && s.tasks.find((x) => x.id === t.taskId);
    out = task ? `${t.phase === "break" ? "Mola" : t.mode === "pomo" ? "Pomodoro" : "Odak"}: ${task.title} · ${Math.floor((Date.now() - new Date(t.startedAt)) / 60000)} dk` : "Çalışan zamanlayıcı yok.";
  } else if (cmd === "done" || cmd === "status") {
    const STATUSES = ["todo", "doing", "waiting", "done"];
    const st = cmd === "done" ? "done" : args._[1];
    if (!STATUSES.includes(st)) throw new Error(`Durum şunlardan biri olmalı: ${STATUSES.join(", ")}`);
    update((s) => {
      const t = find(s, args._[0]);
      // Sayılan iş bitiyorsa odak süresi kaydedilir.
      if (st === "done" && s.timer?.taskId === t.id) { commit(s); s.timer = null; }
      setStatus(t, st);
      out = `${t.title} → ${t.status}`;
    });
  } else if (cmd === "tnote") {
    // İşin notuna (talimat alanı) satır ekler; eskisi korunur.
    const text = args._.slice(1).join(" ").trim();
    if (!text) throw new Error("Not metni gerekli");
    update((s) => {
      const t = find(s, args._[0]);
      t.notes = [t.notes, text].filter(Boolean).join("\n\n");
      out = `${t.title} · not eklendi`;
    });
  } else if (cmd === "topic") {
    // pg topic <işId> yok | pg topic <otomasyonId> "YYYY-MM-DD HH:MM" yok: gönderinin konusunu boşaltır (Rou yenisini yazar).
    const [id, a1, a2] = args._;
    if ((a2 ?? a1) !== "yok") throw new Error('Kullanım: pg topic <işId> yok | pg topic <otomasyonId> "gün saat" yok');
    update((s) => {
      const a = a2 !== undefined && s.automations.find((x) => x.id === id);
      if (a) {
        if (!a.topics?.[a1]) throw new Error(`Konu yok: ${id} ${a1}`);
        delete a.topics[a1];
        out = `~ otomasyon ${a.id} ${a1} konu boşaltıldı`;
      } else {
        const t = find(s, id);
        delete t.topic;
        out = `${t.title} · konu boşaltıldı`;
      }
    });
  } else if (cmd === "move") {
    update((s) => void setDay(s, find(s, args._[0]), parseDay(args._[1], null), iso(new Date())));
    out = "→";
  } else if (cmd === "src") {
    // pg src <projeId> "Başlık" --body ".." [--url ..]: projenin Bilgi'sine not (adres verilirse bağlantı) ekler; hazırlıklarda kullanılır.
    update((s) => {
      const p = s.projects.find((x) => x.id === args._[0]);
      if (!p) throw new Error(`Proje yok: ${args._[0]}`);
      const title = args._.slice(1).join(" ").trim();
      const body = args.body && args.body !== true ? String(args.body) : "";
      if (!title || !body) throw new Error('Kullanım: pg src <projeId> "Başlık" --body ".." [--url ..]');
      const url = args.url && args.url !== true ? String(args.url) : undefined;
      if (url && !/^https?:\/\//.test(url)) throw new Error(`Adres http(s) olmalı: ${url}`);
      const src = { id: id(), kind: url ? "link" : "note", title, body, ...(url ? { url } : {}), use: true, addedAt: now() };
      (p.sources ??= []).push(src);
      out = `+ Bilgi ${src.id}  ${p.name} · ${title}`;
    });
  } else if (cmd === "srcrm") {
    // pg srcrm <projeId> <kaynakId>: projenin Bilgi kaynağını Çöp Kutusu'na atar (30 gün, geri alınabilir).
    update((s) => {
      const p = s.projects.find((x) => x.id === args._[0]);
      if (!p) throw new Error(`Proje yok: ${args._[0]}`);
      const src = (p.sources ?? []).find((x) => x.id === String(args._[1] ?? ""));
      if (!src) throw new Error(`Kaynak yok: ${args._[1]}`);
      toTrash(s, id(), "source", src.title, { source: { projectId: p.id, src } });
      p.sources = p.sources.filter((x) => x.id !== src.id);
      out = `− ${src.title} (Çöp Kutusu'nda, 30 gün)`;
    });
  } else if (cmd === "rm") {
    update((s) => {
      // Çıktı kimliği verilirse yalnız o çıktı (ör. beğenilmeyen bir video) çöpe gider, iş kalır.
      const r = s.runs.find((x) => x.id === String(args._[0] ?? ""));
      if (r) { toTrash(s, id(), "run", r.title, { runs: [r] }); s.runs = s.runs.filter((x) => x.id !== r.id); return; }
      // Boş bir proje kimliği verilirse (işi, otomasyonu, notu yok) proje çöpe gider.
      const p = s.projects.find((x) => x.id === String(args._[0] ?? ""));
      if (p) {
        if (s.tasks.some((t) => t.projectId === p.id) || (s.automations ?? []).some((a) => a.projectId === p.id) || s.inbox.some((n) => n.projectId === p.id)) throw new Error(`Proje boş değil: ${p.name}`);
        toTrash(s, id(), "project", p.name, { projects: [p] }); s.projects = s.projects.filter((x) => x.id !== p.id); return;
      }
      const t = find(s, args._[0]);
      if (s.timer?.taskId === t.id) s.timer = null;
      for (const n of s.inbox) if (n.taskId === t.id) delete n.taskId;
      toTrash(s, id(), "task", t.title, { tasks: [t], blocks: s.blocks.filter((b) => b.taskId === t.id), sessions: s.sessions.filter((x) => x.taskId === t.id), runs: s.runs.filter((x) => x.taskId === t.id) });
      s.tasks = s.tasks.filter((x) => x.id !== t.id); s.blocks = s.blocks.filter((b) => b.taskId !== t.id); s.sessions = s.sessions.filter((x) => x.taskId !== t.id); s.runs = s.runs.filter((x) => x.taskId !== t.id); });
    out = "− (Çöp Kutusu'nda, 30 gün)";
  } else if (cmd === "worlds") {
    const { state: s } = read();
    for (const w of s.worlds) out += `${w.id.padEnd(10)} ${w.name.padEnd(12)} ${s.tasks.filter((t) => t.worldId === w.id && t.status !== "done").length} açık · ${s.projects.filter((p) => p.worldId === w.id).length} proje\n`;
  } else if (cmd === "json") {
    out = JSON.stringify(read().state, null, 2);
  } else if (cmd && cmd !== "list" && !cmd.startsWith("--")) {
    // Yanlış yazılan komut listeyi basıp 0 ile çıkıyordu; çağıran (Rou, bir araç) işin yapıldığını sanıyordu.
    throw new Error(`Bilinmeyen komut: ${cmd}`);
  } else {
    if (needsMaterialize(read().state)) update((s) => void materialize(s));
    const { state: s } = read();
    const today = iso(new Date());
    // --week: bu haftanın (pazartesi-pazar) işleri ve gecikmiş açık işler.
    const mon = new Date(); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const inWeek = (t) => (t.day && t.day >= iso(mon) && t.day <= iso(sun)) || t.status === "doing" || (t.day && t.day < today && t.status !== "done");
    const list = s.tasks
      .filter((t) => !args.pg || t.worldId === args.pg)
      .filter((t) => (args.week || cmd === "--week" ? inWeek(t) : t.day === today || t.status === "doing" || (t.day && t.day < today && t.status !== "done")))
      .sort((a, b) => String(a.day).localeCompare(String(b.day)));
    for (const t of list) out += `${t.status === "done" ? "✓" : t.status === "doing" ? "▶" : "·"} ${t.id}  ${t.day ?? "tarihsiz  "}  [${t.worldId}] ${t.title}\n`;
    if (!list.length) out = "Liste boş.";
  }
  console.log(out.trimEnd());
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
