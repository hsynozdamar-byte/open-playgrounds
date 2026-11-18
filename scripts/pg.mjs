#!/usr/bin/env node
// pg: write to Playgrounds from the terminal (your AI tools use it too).
//   pg add "Title" --pg <world> [--project <project>] [--day today|tomorrow|mon..sun|YYYY-MM-DD|someday] [--post <accountId|@handle|platform> [--format linkedin] [--brief ".."] [--at 10:00]]  (--post: a one-off post; it shows on Posts)
//          [--at 14:00 --min 90] [--est 60] [--deadline fri] [--status todo|doing|waiting|done] [--check "a;b"] [--notes ".."] [--who claude|me] [--by claude]
//   pg in "Title" [--pg <world>] [--source mail|slack|clickup|note|claude] [--from ".."] [--body ".."] [--url ..] [--suggest "Task title"]
//   pg world "Name" [--desc ".."] [--color "#3d5afe"]   pg wcolor <world> "#rrggbb" ["#second"]   pg wkit <world> '{"field":value|null}'   pg project "Name" --pg <world> [--deadline YYYY-MM-DD] [--desc ".."]
//   pg wdesc <world> "description"   pg pmove <projectId> <world>   (the project moves with its tasks, blocks, automations, notes and the accounts only it uses)
//   pg block <taskId> <day> <HH:MM> <min>
//   pg brand <projectId> [--use ".."] [--avoid ".."] [--set]   (adds to the project's brand fields and keeps the old text; --set replaces the given field)   pg aaction <automationId> "instruction"   (changes the automation's instruction)   pg avisual <automationId> "rule"   (writes the automation's visual rule)   pg alang <accountId> tr|en|tr+en   pg acolor <automationId> "#rrggbb"|none   (the automation's accent colour; later preparations only)
//   pg src <projectId> "Title" --body ".." [--url ..]   (adds a note or link to the project's Notes)   pg srcrm <projectId> <sourceId>   (moves a Notes source to the Trash)
//   pg pedit <projectId> [--name ".."] [--desc ".."] [--ongoing] [--accounts "id,id"] [--brand-from <projectId>] [--media-dir <folder> [--good "a.mp4;b.mp4"]]   (edits the project; --brand-from copies the brand fields as they are)
//   pg aproject <automationId> <projectId>   (moves the automation to a project, with the tasks it opened and its account's planned posts)
//   pg topic <taskId> none | pg topic <automationId> "YYYY-MM-DD HH:MM" none   (clears a post's topic; Rou writes a new one)
//   pg aslot <automationId> [--days every|weekdays|weekends|1,3] [--at "12:30,20:00"]   (changes the automation's days and times; today's missing tasks are opened)
//   pg auto "Title" --pg <world> --project X [--at "08:00,20:00"] [--min 30] --days every|weekdays|weekends|1,3 [--who claude|me] --action ".."   (automation)
//          [--account <accountId|@handle> [--format "ig_reel,ig_post"]] [--sharer claude|me]   (several formats: runs take them in turn)
//   pg account "Name" --pg <world> --platform instagram --handle "@handle" [--lang tr|en|tr+en] [--voice ".."] [--project <projectId>]   (adds a sharing account)
//   pg avoice <accountId> "voice"   (changes the account's writing voice)
//   pg aedit <accountId> [--name ".."] [--handle "@new"] [--login ".."]   (changes the account's display name, handle or login name)
//   pg run <taskId> "Title" --body ".." [--img "a.png;b.png"] [--video a.mp4] [--mention "Acme"] [--on fri]   (a task's output; it waits for approval)
//   pg run ... --items <json>   (items proposed by a Chrome automation)   pg pdf <html> <pdf>
//   pg due   (automation tasks Rou should prepare today that have no output yet)   pg prepare <taskId> [--revise "note"] [--img "a.png;b.png"] [--world <id>] [--project <id>] [--account <id>]   (Rou prepares it now; with a target the post moves there)   pg image <runId>   (makes the missing image for a LinkedIn output)
//   pg propose '<json>' [--text "why"] [--from "Claude Code"]   (an outside tool leaves Rou a proposal; one action or {"type":"plan","steps":[..]}; the user approves it in the app)
//   pg posted <runId> --url "<address>" | --error "<reason>"   (writes the result of a share; the task is done once shared)
//   pg pb <world> [address]   (brings the world's profile to the front in the Playgrounds browser; opens the address there if given)   pg pb   (profiles, logins, open tabs)
//   pg notes [--pg <world>]   (notes waiting in the Notebook, with their ids)
//   pg start <id> [--pomo]   pg stop   pg now
//   pg rmedia <runId> --from <runId>   (moves another output's video and images/cover to this output; the text stays as it is)
//   pg tnote <id> "text"   (appends to the task's note)   pg done <id>   pg status <id> <status>   pg move <id> <day>   pg rm <id | runId>
//   pg list [--week] [--pg <world>]   pg worlds   pg json
//   Days: today, tomorrow, someday, mon..sun or monday..sunday (the next one), YYYY-MM-DD. The Turkish words (bugün, yarın, tarihsiz, pzt..paz) and her|hafta-içi|yok still work.
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
// A full name or a set abbreviation, never a bare prefix ("t" would be both tue and thu). The Turkish names stay as aliases.
const DAYS = {
  monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 0, sun: 0,
  pazartesi: 1, pzt: 1, salı: 2, sali: 2, sal: 2, çarşamba: 3, carsamba: 3, çar: 3, car: 3, perşembe: 4, persembe: 4, per: 4, cuma: 5, cum: 5, cumartesi: 6, cmt: 6, pazar: 0, paz: 0,
};
// Lower-cased both ways, so "FRIDAY" and "PAZAR" match under any locale rule.
const lowers = (v) => [...new Set([String(v).trim().toLowerCase(), String(v).trim().toLocaleLowerCase("tr")])];
function parseDay(v, fallback) {
  if (v === undefined || v === true) return fallback;
  const forms = lowers(v);
  const is = (...w) => forms.some((f) => w.includes(f));
  if (is("someday", "none", "tarihsiz", "sonra", "-")) return null;
  const iso8601 = forms.find((f) => /^\d{4}-\d{2}-\d{2}$/.test(f));
  if (iso8601) return iso8601;
  const d = new Date();
  if (is("today", "tod", "bugün", "bugun")) return iso(d);
  if (is("tomorrow", "tmr", "yarın", "yarin")) return d.setDate(d.getDate() + 1), iso(d);
  const k = forms.map((f) => DAYS[f]).find((x) => x !== undefined);
  if (k !== undefined) return d.setDate(d.getDate() + (((k - d.getDay() + 7) % 7) || 7)), iso(d);
  throw new Error(`Unknown day: ${v}`);
}
// --days value: every | weekdays | weekends | 1,3 (the Turkish her | hafta-içi also work).
function parseDays(d) {
  const f = lowers(d);
  if (f.some((x) => ["every", "her"].includes(x))) return [0, 1, 2, 3, 4, 5, 6];
  if (f.some((x) => ["weekdays", "hafta-içi", "hafta-ici"].includes(x))) return [1, 2, 3, 4, 5];
  if (f.some((x) => ["weekends", "hafta-sonu"].includes(x))) return [0, 6];
  return String(d).split(",").map(Number);
}
const isNone = (v) => lowers(v).some((x) => ["none", "yok"].includes(x));
const norm = (s) => String(s).toLocaleLowerCase("tr").replace(/\s+/g, "");
function world(s, v, optional) {
  if (!v || v === true) { if (optional) return null; throw new Error(`--pg is required: ${s.worlds.map((w) => w.id).join(", ")}`); }
  const w = s.worlds.find((w) => w.id === v || norm(w.name) === norm(v));
  if (!w) throw new Error(`No world: ${v}. Worlds: ${s.worlds.map((w) => w.id).join(", ")}`);
  return w;
}
function project(s, w, name) {
  if (!name || name === true) return null;
  // A project id works too (e.g. --project qndiql); otherwise the name is matched, and a new name opens a new project.
  let p = s.projects.find((p) => p.worldId === w.id && (p.id === String(name) || norm(p.name) === norm(name)));
  if (!p) s.projects.push((p = { id: id(), worldId: w.id, name, description: "", status: "active", deadline: null }));
  return p.id;
}
// An empty id (e.g. a blank shell variable) would match the start of every id and pick the first task: `pg rm ""` would trash it.
const find = (s, ref) => { if (typeof ref !== "string" || !ref.trim()) throw new Error("A task id is required"); const t = s.tasks.find((x) => x.id.startsWith(ref)); if (!t) throw new Error(`No task: ${ref}`); return t; };
const now = () => new Date().toISOString();
const addMin = (day, hm, m) => { const [h, mi] = hm.split(":").map(Number); const t = Math.min(24 * 60 - 1, h * 60 + mi + m); return `${day}T${pad(Math.floor(t / 60))}:${pad(t % 60)}`; };
function setStatus(t, st) { t.status = st; if (st === "done") t.doneAt = now(); else delete t.doneAt; }
// Writes the running focus time as a session (the same rule as the app's timer.ts).
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
    // The comment block at the top of this file is the command list.
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
      if (!t.title) throw new Error("A title is required");
      // --who claude|me: assigns the task to Rou (the user's own if omitted).
      if (["claude", "me"].includes(args.who)) t.who = args.who;
      // --post <accountId|@handle|platform>: a one-off post. The task shows on Posts and the account that shares it is known.
      if (args.post) {
        const accs = w.accounts ?? [];
        const q = String(args.post === true ? "" : args.post).replace(/^@/, "").toLowerCase();
        const own = t.projectId ? s.projects.find((p) => p.id === t.projectId)?.accountIds ?? [] : [];
        const acc = accs.find((a) => a.id === q) ?? accs.find((a) => String(a.handle ?? "").replace(/^@/, "").toLowerCase() === q)
          ?? accs.filter((a) => a.platform === q).sort((x, y) => Number(own.includes(y.id)) - Number(own.includes(x.id)))[0]
          // An account of another world, given by its exact id only (not by handle or platform).
          ?? (() => { const a = accountById(s, String(args.post)); return a && !isFeed(a.platform) ? a : undefined; })();
        if (!acc) throw new Error(`No account: ${args.post}. Accounts of this world: ${accs.map((a) => `${a.id} ${a.platform} ${a.handle ?? a.name}`).join(", ") || "none"}`);
        const format = args.format && args.format !== true ? String(args.format) : formatsOf(acc.platform)[0];
        if (!formatsOf(acc.platform).includes(format)) throw new Error(`Formats for ${acc.platform}: ${formatsOf(acc.platform).join(" | ")}`);
        if (t.by === "claude") t.who = "claude";
        t.post = { accountId: acc.id, format, brief: args.brief && args.brief !== true ? String(args.brief) : t.notes, ...(args.at ? { at: String(args.at) } : {}) };
      }
      s.tasks.push(t);
      if (args.at && day) s.blocks.push({ id: id(), taskId: t.id, worldId: w.id, title: "", start: `${day}T${args.at}`, end: addMin(day, args.at, +(args.min || 60)), kind: "plan" });
      out = `+ ${t.id}  [${w.id}] ${t.title}  (${day ?? "someday"}${args.at ? " " + args.at : ""})`;
    });
  } else if (cmd === "in") {
    update((s) => {
      const w = world(s, args.pg, true);
      const i = { id: id(), worldId: w?.id ?? null, source: args.source || "claude", from: args.from || "", url: args.url || "", title: args._.join(" "), body: args.body || "", receivedAt: now(), state: "new", ...(args.suggest ? { suggestion: { title: args.suggest } } : {}) };
      s.inbox.unshift(i);
      out = `+ inbox ${i.id}  ${i.title}`;
    });
  } else if (cmd === "world") {
    update((s) => {
      const name = args._.join(" ").trim();
      if (!name) throw new Error("A world name is required");
      if (s.worlds.some((w) => norm(w.name) === norm(name))) throw new Error(`A world with this name exists: ${name}`);
      const w = newWorld(s, name, args.desc || "", args.color);
      s.worlds.push(w);
      out = `+ world ${w.id}`;
    });
  } else if (cmd === "wcolor") {
    update((s) => {
      const w = world(s, args._[0]);
      const c = String(args._[1] || "");
      if (!/^#[0-9a-f]{6}$/i.test(c)) throw new Error("Colour must be #rrggbb");
      w.color = c;
      const c2 = String(args._[2] || "");
      if (c2 && !/^#[0-9a-f]{6}$/i.test(c2)) throw new Error("Second tone must be #rrggbb");
      if (c2) w.color2 = c2; else delete w.color2;
      out = `~ world ${w.id} ${c}${c2 ? ` + ${c2}` : ""}`;
    });
  } else if (cmd === "wkit") {
    // Updates the world's visual kit (world.kit): given fields are written, null removes one.
    update((s) => {
      const w = world(s, args._[0]);
      let patch;
      try { patch = JSON.parse(String(args._[1] ?? "")); } catch { throw new Error("The kit must be a JSON object"); }
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("The kit must be a JSON object");
      const kit = { ...(w.kit ?? {}) };
      for (const [k, v] of Object.entries(patch)) if (v === null) delete kit[k]; else kit[k] = v;
      w.kit = kit;
      out = `~ kit ${w.id} ${Object.keys(patch).join(", ")}`;
    });
  } else if (cmd === "wdesc") {
    update((s) => {
      const w = world(s, args._[0]);
      w.description = args._.slice(1).join(" ").trim();
      out = `~ world ${w.id} description`;
    });
  } else if (cmd === "brand") {
    update((s) => {
      const p = s.projects.find((x) => x.id === args._[0]);
      if (!p) throw new Error(`No project: ${args._[0]}`);
      p.brand = { ...(p.brand || {}) };
      for (const k of ["use", "avoid"]) if (args[k] && args[k] !== true) p.brand[k] = [args.set ? "" : p.brand[k], String(args[k]).trim()].filter(Boolean).join("\n");
      out = `~ project ${p.id} brand`;
    });
  } else if (cmd === "avoice") {
    update((s) => {
      const acc = s.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === args._[0]);
      if (!acc) throw new Error(`No account: ${args._[0]}`);
      acc.voice = args._.slice(1).join(" ").trim();
      out = `~ account ${acc.id} voice`;
    });
  } else if (cmd === "aedit") {
    update((s) => {
      const acc = s.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === args._[0]);
      if (!acc) throw new Error(`No account: ${args._[0]}`);
      if (args.name && args.name !== true) acc.name = String(args.name).trim();
      if (args.handle && args.handle !== true) {
        const h = String(args.handle).trim();
        acc.handle = /^[\w.]+$/.test(h) ? `@${h}` : h;
        delete acc.check;  // the check of the old handle no longer applies
      }
      if (args.login && args.login !== true) acc.login = String(args.login).trim();
      out = `~ account ${acc.id}  ${acc.name} ${acc.handle ?? ""}${acc.login ? `  login ${acc.login}` : ""}`;
    });
  } else if (cmd === "account") {
    update((s) => {
      const w = world(s, args.pg);
      const name = args._.join(" ").trim();
      if (!name) throw new Error("An account name is required");
      const platform = String(args.platform ?? "");
      if (!PLATFORMS[platform]) throw new Error(`Platform: ${Object.keys(PLATFORMS).join(" | ")}`);
      const lang = args.lang && args.lang !== true ? String(args.lang) : undefined;
      if (lang && !["tr", "en", "tr+en"].includes(lang)) throw new Error("Language: tr | en | tr+en");
      const h = args.handle && args.handle !== true ? String(args.handle).trim() : "";
      const handle = /^[\w.]+$/.test(h) ? `@${h}` : h;
      if (handle && (w.accounts ?? []).some((x) => x.platform === platform && x.handle === handle)) throw new Error(`This account already exists: ${handle}`);
      const p = args.project && args.project !== true ? s.projects.find((x) => x.id === args.project && x.worldId === w.id) : null;
      if (args.project && !p) throw new Error(`No project in this world: ${args.project}`);
      const acc = { id: id(), platform, name, handle, voice: args.voice && args.voice !== true ? String(args.voice).trim() : "", lang: lang ?? "en" };
      w.accounts = [...(w.accounts ?? []), acc];
      if (p) p.accountIds = [...(p.accountIds ?? []), acc.id];
      out = `+ account ${acc.id}  ${acc.name} ${acc.handle}${p ? `  project ${p.id}` : ""}`;
    });
  } else if (cmd === "alang") {
    update((s) => {
      const acc = s.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === args._[0]);
      if (!acc) throw new Error(`No account: ${args._[0]}`);
      if (!["tr", "en", "tr+en"].includes(args._[1])) throw new Error("Language: tr | en | tr+en");
      acc.lang = args._[1];
      out = `~ account ${acc.id} language ${acc.lang}`;
    });
  } else if (cmd === "rmedia") {
    update((s) => {
      const r = s.runs.find((x) => x.id === args._[0]);
      const src = s.runs.find((x) => x.id === args.from);
      if (!r) throw new Error(`No output: ${args._[0]}`);
      if (!src) throw new Error(`No source output: ${args.from}`);
      if (!src.video && !src.images?.length) throw new Error(`Output ${src.id} has no video or images`);
      for (const f of [src.video, ...(src.images ?? [])].filter(Boolean)) if (!fs.existsSync(path.join(DATA_DIR, f))) throw new Error(`No such file: ${f}`);
      if (src.video) r.video = src.video; else delete r.video;
      r.images = [...(src.images ?? [])];
      if (src.kitHash) r.kitHash = src.kitHash;
      out = `~ output ${r.id}: ${[r.video, ...r.images].join(", ")} (from output ${src.id})`;
    });
  } else if (cmd === "aaction") {
    update((s) => {
      const a = s.automations.find((x) => x.id === args._[0]);
      if (!a) throw new Error(`No automation: ${args._[0]}`);
      a.action = args._.slice(1).join(" ").trim();
      out = `~ automation ${a.id} instruction`;
    });
  } else if (cmd === "avisual") {
    update((s) => {
      const a = s.automations.find((x) => x.id === args._[0]);
      if (!a) throw new Error(`No automation: ${args._[0]}`);
      a.visual = args._.slice(1).join(" ").trim();
      out = `~ automation ${a.id} visual rule`;
    });
  } else if (cmd === "acolor") {
    const { isHex } = await import("../shared/series.mjs");
    const raw = String(args._[1] ?? "");
    const none = isNone(raw);
    const v = raw.toLowerCase();
    if (!none && !isHex(v)) throw new Error('Colour: "#rrggbb" or none');
    update((s) => {
      const a = s.automations.find((x) => x.id === args._[0]);
      if (!a) throw new Error(`No automation: ${args._[0]}`);
      if (none) delete a.color;
      else a.color = v;
      out = `~ automation ${a.id} colour ${a.color ?? "none"}`;
    });
  } else if (cmd === "aslot") {
    update((s) => {
      const a = s.automations.find((x) => x.id === args._[0]);
      if (!a) throw new Error(`No automation: ${args._[0]}`);
      if (args.days && args.days !== true) a.days = parseDays(String(args.days));
      if (args.at && args.at !== true) a.times = String(args.at).split(",").map((x) => x.trim()).filter(Boolean).sort();
      // As in the app: changing days or times resets the horizon and opens today's missing tasks.
      a.horizon = null;
      materialize(s);
      out = `~ automation ${a.id}  days ${a.days.join(",")}  times ${a.times.join(", ") || "-"}`;
    });
  } else if (cmd === "pedit") {
    update((s) => {
      const p = s.projects.find((x) => x.id === args._[0]);
      if (!p) throw new Error(`No project: ${args._[0]}`);
      if (args.name && args.name !== true) p.name = String(args.name).trim();
      if (args.desc && args.desc !== true) p.description = String(args.desc).trim();
      // --icon <png>: the app icon (used on covers instead of the wordmark). --icon none removes it.
      if (args.icon !== undefined && args.icon !== true && isNone(args.icon)) delete p.icon;
      else if (args.icon && args.icon !== true) {
        const f = path.resolve(String(args.icon));
        if (!fs.existsSync(f) || !/\.(png|jpe?g|webp)$/i.test(f)) throw new Error(`No icon image: ${f}`);
        p.icon = f;
      }
      if (args.ongoing) p.ongoing = true;
      // --media-dir <folder> [--good "a.mp4;b.mp4"]: the project's Media folder (files stay in place) and the files marked Good.
      if (args["media-dir"] && args["media-dir"] !== true) {
        const dir = path.resolve(expandHome(args["media-dir"], os.homedir()));
        if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`No such folder: ${dir}`);
        p.mediaDir = dir;
      }
      if (args.good && args.good !== true) {
        if (!p.mediaDir) throw new Error("Give --media-dir first");
        for (const rel of String(args.good).split(";").map((x) => x.trim()).filter(Boolean)) {
          const f = path.resolve(p.mediaDir, rel);
          if (!f.startsWith(p.mediaDir + path.sep) || !fs.existsSync(f)) throw new Error(`Not in the media folder: ${rel}`);
          (p.media ??= {})[mediaKey(path.relative(p.mediaDir, f))] = "good";
        }
      }
      if (args.accounts && args.accounts !== true) p.accountIds = String(args.accounts).split(",").map((x) => x.trim()).filter(Boolean);
      if (args["brand-from"]) {
        const src = s.projects.find((x) => x.id === args["brand-from"]);
        if (!src) throw new Error(`No project: ${args["brand-from"]}`);
        p.brand = structuredClone(src.brand || {});
      }
      out = `~ project ${p.id}  ${p.name}`;
    });
  } else if (cmd === "aproject") {
    update((s) => {
      const a = s.automations.find((x) => x.id === args._[0]);
      if (!a) throw new Error(`No automation: ${args._[0]}`);
      const p = s.projects.find((x) => x.id === args._[1]);
      if (!p) throw new Error(`No project: ${args._[1]}`);
      const from = a.projectId;
      a.projectId = p.id;
      // Outputs belong to the task (run.taskId) and move with it.
      let n = 0;
      for (const t of s.tasks) if (t.autoId === a.id || (a.accountId && t.post?.accountId === a.accountId && t.projectId === from)) { t.projectId = p.id; n++; }
      out = `→ automation ${a.id} ${p.id}  ${n} tasks moved`;
    });
  } else if (cmd === "pmove") {
    update((s) => {
      const p = s.projects.find((x) => x.id === args._[0]);
      if (!p) throw new Error(`No project: ${args._[0]}`);
      const w = world(s, args._[1]);
      moveProjectTo(s, p.id, w.id);
      out = `→ project ${p.id} ${w.id}`;
    });
  } else if (cmd === "project") {
    update((s) => {
      const w = world(s, args.pg);
      const pid = project(s, w, args._.join(" "));
      const p = s.projects.find((x) => x.id === pid);
      if (args.deadline) p.deadline = parseDay(args.deadline);
      if (args.desc) p.description = args.desc;
      out = `+ project ${pid}`;
    });
  } else if (cmd === "block") {
    update((s) => {
      const t = find(s, args._[0]);
      const day = parseDay(args._[1]);
      s.blocks.push({ id: id(), taskId: t.id, worldId: t.worldId, title: "", start: `${day}T${args._[2]}`, end: addMin(day, args._[2], +(args._[3] || 60)), kind: "plan" });
      if (!t.day) t.day = day;
      out = `+ block ${day} ${args._[2]}`;
    });
  } else if (cmd === "auto") {
    // Automation: on the chosen days one task opens for each time. --who claude: Rou prepares, the user approves.
    update((s) => {
      const w = world(s, args.pg);
      const d = String(args.days || "every");
      const days = parseDays(d);
      const a = { id: id(), worldId: w.id, projectId: project(s, w, args.project), title: args._.join(" "), action: args.action && args.action !== true ? args.action : "", times: args.at && args.at !== true ? String(args.at).split(",").map((x) => x.trim()).filter(Boolean).sort() : [], minutes: +(args.min || 30), days, status: "active", who: args.who === "me" ? "me" : "claude", horizon: null, createdAt: now() };
      if (!a.title) throw new Error("A title is required");
      // --account <accountId|@handle>: the world's sharing account. --format "ig_reel,ig_post": with several, runs take them in turn.
      if (args.account && args.account !== true) {
        const ref = String(args.account).replace(/^@/, "").toLowerCase();
        const acc = (w.accounts ?? []).find((x) => x.id === args.account || String(x.handle || "").replace(/^@/, "").toLowerCase() === ref);
        if (!acc) throw new Error(`No account: ${args.account}`);
        a.accountId = acc.id;
        if (args.format && args.format !== true) {
          const list = String(args.format).split(",").map((x) => x.trim()).filter(Boolean);
          const bad = list.find((f) => !formatsOf(acc.platform).includes(f));
          if (bad) throw new Error(`Format does not fit a ${acc.platform} account: ${bad}`);
          a.format = list[0];
          if (list.length > 1) { a.formats = list; a.formatsFrom = iso(new Date()); } // the order counts from local today
        }
      }
      if (["claude", "me"].includes(args.sharer)) a.sharer = args.sharer;
      (s.automations ??= []).push(a);
      materialize(s);
      out = `+ automation ${a.id}  ${a.title}`;
    });
  } else if (cmd === "run") {
    // pg run <taskId> "Output title" --body "Prepared text" [--img "a.png;b.png"] [--on fri]
    // Legacy use: an <automationId> attaches to the series' latest task. Images are copied to data/media.
    const { parseItems, folderOf } = args.items ? await import("../server/browse.mjs") : {};
    update((s) => {
      materialize(s);
      const ref = String(args._[0] ?? "");
      let task = ref && s.tasks.find((x) => x.id.startsWith(ref));
      if (!task) {
        const a = (s.automations ?? []).find((x) => x.id.startsWith(ref));
        if (!a) throw new Error(`No task or automation: ${ref}`);
        task = s.tasks.filter((x) => x.autoId === a.id).sort((x, y) => String(y.day).localeCompare(String(x.day)))[0];
        if (!task) throw new Error(`This series has no task yet: ${a.title}`);
      }
      const rid = id();
      const images = args.img && args.img !== true ? String(args.img).split(";").map((f) => f.trim()).filter(Boolean).map((f, i) => {
        if (!fs.existsSync(f)) throw new Error(`No such image: ${f}`);
        fs.mkdirSync(MEDIA_DIR, { recursive: true });
        const name = `${rid}-${i}${path.extname(f).toLowerCase()}`;
        fs.copyFileSync(f, path.join(MEDIA_DIR, name));
        return `media/${name}`;
      }) : [];
      let video;
      if (args.video && args.video !== true) {
        const f = String(args.video);
        if (!fs.existsSync(f)) throw new Error(`No such video: ${f}`);
        fs.mkdirSync(MEDIA_DIR, { recursive: true });
        fs.copyFileSync(f, path.join(MEDIA_DIR, `${rid}${path.extname(f).toLowerCase()}`));
        video = `media/${rid}${path.extname(f).toLowerCase()}`;
      }
      // --items <json file>: items proposed by a Chrome automation (done from the app once approved).
      let items;
      if (args.items && args.items !== true) {
        const a = s.automations.find((x) => x.id === task.autoId);
        if (!a) throw new Error("--items only works on automation tasks");
        items = parseItems(JSON.parse(fs.readFileSync(String(args.items), "utf8")), folderOf(a));
      }
      const body = args.body && args.body !== true ? String(args.body) : "";
      // A post task's output is the post itself: preview, approval and sharing read run.post.
      // --mention "Acme;...": pages to tag when sharing (the sharer picks @Name from the platform's suggestions).
      const mentions = args.mention && args.mention !== true ? String(args.mention).split(";").map((x) => x.trim().replace(/^@/, "")).filter(Boolean) : [];
      // On an automation task the format comes from the automation (account automations: tweet, linkedin...).
      const auto = s.automations.find((x) => x.id === task.autoId);
      const format = task.post?.format ?? (auto?.accountId ? formatOf(s, auto) ?? undefined : undefined);  // with no format, from the account's platform
      const post = format ? { ...postOfText(format, body), ...(mentions.length ? { mentions } : {}) } : undefined;
      if (!post && task.projectId && s.projects.find((p) => p.id === task.projectId)?.accountIds?.length && (video || images.length))
        console.error(`Warning: ${task.id} is not a post task; it will not show on Posts and nobody is set to share it. If it should be shared, create the task with pg add ... --post <account>.`);
      const r = { id: rid, taskId: task.id, at: now(), title: args._.slice(1).join(" ") || task.title, body, status: "ready", images, ...(video ? { video } : {}), ...(post ? { post } : {}), ...(items ? { items } : {}), on: args.on ? parseDay(args.on) : null, by: args.by && args.by !== true ? String(args.by) : "claude" };
      (s.runs ??= []).unshift(r);
      out = `+ output ${r.id}  ${r.title} → ${task.id}`;
    });
  } else if (cmd === "posted") {
    // pg posted <runId> --url "<post address>" | --error "<reason>"   (writes the result of a share)
    const { markPosted } = await import("../server/share.mjs");
    update((s) => {
      const r = markPosted(s, String(args._[0] ?? ""), { url: args.url && args.url !== true ? String(args.url) : undefined, error: args.error && args.error !== true ? String(args.error) : undefined });
      out = r.status === "posted" ? `Shared: ${r.title}${r.postUrl ? `  ${r.postUrl}` : ""}` : `Marked as not shared: ${r.title}`;
    });
    // Notify the user even when the app is not open.
    const { notify } = await import("../server/notify.mjs");
    notify(out.startsWith("Shared") ? "Post shared" : "Post not shared", out.replace(/^[^:]*: /, "").slice(0, 140));
  } else if (cmd === "pb") {
    // The Playgrounds browser (server/pb.mjs): one profile per world.
    const P = await import("../server/pb.mjs");
    const { state: s } = read();
    if (args._[0]) {
      const w = world(s, args._[0]);
      const r = await P.openProfile(w, args._[1]);
      if (!r.ok) throw new Error(r.error);
      out = `${P.PB_NAME} · ${w.name} profile in front${args._[1] ? `: ${args._[1]}` : ""}`;
    } else {
      const st = await P.pbState(s);
      if (!st.installed) throw new Error(`The ${P.PB_NAME} desktop app is not open`);
      out = [`${P.PB_NAME}: ${st.running ? "open" : "closed"}`, ...st.profiles.map((p) => {
        const w = s.worlds.find((x) => x.id === p.worldId);
        const accs = (w.accounts ?? []).map((a) => `${a.handle || a.name} ${p.accounts[a.id] ? "✓" : p.accounts[a.id] === false ? "not signed in" : "?"}`);
        return [`${w.name} (${w.id})${p.open ? " · open" : ""}`, accs.length ? `  accounts: ${accs.join(", ")}` : "", ...p.pages.map((x) => `  - ${x.title || x.url}  ${x.url}`)].filter(Boolean).join("\n");
      })].join("\n");
    }
  } else if (cmd === "due") {
    const STALE_MS = 6 * 60 * 1000; // as in the app: an output stuck "working" for 6 minutes was cut off
    // pg due: automation tasks Rou should prepare today that have no output yet.
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
      out += `${t.id}  ${t.title}${t.autoSlot ? "  " + t.autoSlot : ""}  [${w?.name ?? t.worldId}${p ? " › " + p.name : ""}]  prepared by: ${a.who}\n   ${a.browser ? `Done in Chrome; full instruction: pg brief ${t.id}` : `instruction: ${a.action || "(none)"}`}\n`;
    }
    if (!list.length) out = "Nothing to prepare today.";
  } else if (cmd === "pdf") {
    // pg pdf <html> <pdf>: an A4 PDF from HTML (the system Chrome with a temporary profile; an open Chrome is not touched).
    const [src, dst] = args._.map((x) => path.resolve(String(x)));
    if (!src || !dst || !fs.existsSync(src)) throw new Error("Usage: pg pdf <html file> <pdf file>");
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), "pg-pdf-"));
    spawnSync(HEADLESS, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${prof}`, "--no-pdf-header-footer", `--print-to-pdf=${dst}`, pathToFileURL(src).href], { stdio: "ignore", timeout: 60000 });
    fs.rmSync(prof, { recursive: true, force: true });
    if (!fs.existsSync(dst)) throw new Error("Could not make the PDF");
    out = `PDF: ${dst}`;
  } else if (cmd === "propose") {
    // Outside tools (Claude Code, MCP, another agent) leave a proposal instead of changing data directly.
    // It shows as a card in the Rou chat; ids are checked in the app and it applies only on Approve.
    let action;
    try { action = JSON.parse(args._[0] ?? ""); } catch { throw new Error("The proposal is not JSON. Example: pg propose '{\"type\":\"done\",\"taskId\":\"abc123\"}'"); }
    if (Array.isArray(action)) action = { type: "plan", title: typeof args.title === "string" ? args.title : "", steps: action };
    if (!action || typeof action.type !== "string") throw new Error("The proposal has no type field");
    if (["change", "undo_change"].includes(action.type)) throw new Error("This proposal type cannot be left from outside");
    const name = typeof args.from === "string" ? args.from.slice(0, 40) : "Claude Code";
    const text = typeof args.text === "string" ? args.text.slice(0, 2000) : "I left a proposal.";
    update((s) => {
      (s.talk ??= []).push({ id: id(), from: "agent", name, text, at: now(), action });
      s.talk = s.talk.slice(-60);
    });
    out = "Proposal left for Rou. It applies if the user approves it in the app.";
  } else if (cmd === "notes") {
    const { state: s } = read();
    const w = args.pg ? world(s, args.pg) : null;
    const list = s.inbox.filter((i) => i.state === "new" && (!w || i.worldId === w.id));
    const wn = (x) => s.worlds.find((y) => y.id === x)?.name;
    const pn = (x) => s.projects.find((y) => y.id === x)?.name;
    out = list.length ? list.map((i) => `${i.id}  ${i.title}${i.worldId ? `  [${[wn(i.worldId), pn(i.projectId)].filter(Boolean).join(" › ")}]` : ""}${i.body ? `\n    ${i.body.replace(/\n/g, "\n    ")}` : ""}`).join("\n") : "The Notebook is empty.";
  } else if (cmd === "prepare") {
    const { prepare } = await import("../server/prepare.mjs");
    // --revise "note" [--world <id>] [--project <id>] [--account <id>]: a revision; with a target the post moves there.
    const str = (v) => (v && v !== true ? String(v) : undefined);
    const move = args.world || args.project || args.account ? { worldId: str(args.world), projectId: str(args.project), accountId: str(args.account) } : undefined;
    // --img "a.png;b.png": images added to the revision (like Rou attachments, data/media/rou-*); the output uses these and no image is generated.
    const files = (str(args.img) ?? "").split(";").map((f) => f.trim()).filter(Boolean).map((f) => {
      if (!fs.existsSync(f) || !/\.(png|jpe?g|webp)$/i.test(f)) throw new Error(`No such image: ${f}`);
      const file = `rou-${id()}${path.extname(f).toLowerCase()}`;
      fs.mkdirSync(MEDIA_DIR, { recursive: true });
      fs.copyFileSync(f, path.join(MEDIA_DIR, file));
      return { file, kind: "image", name: path.basename(f) };
    });
    const r = prepare(find(read().state, args._[0]).id, str(args.revise), files, move);
    if (!r.ok) throw new Error(r.error);
    await r.done;
    const run = read().state.runs.find((x) => x.id === r.runId);
    out = run?.status === "ready" ? `Ready: ${run.title}. Waiting for approval in the app.` : `Could not prepare: ${run?.body?.slice(0, 200) ?? "?"}`;
  } else if (cmd === "image") {
    // Makes the missing image for a LinkedIn output; the text stays, and an approved output returns to waiting (approved again with the image).
    const { makeImage } = await import("../server/prepare.mjs");
    const r = makeImage(args._[0]);
    if (!r.ok) throw new Error(r.error);
    await r.done;
    const run = read().state.runs.find((x) => x.id === r.runId);
    out = run?.images?.length ? `Image ready: ${run.title}. Waiting for approval in the app.` : `Could not make the image: ${run?.renderError ?? "?"}`;
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
    out = task ? `${t.phase === "break" ? "Break" : t.mode === "pomo" ? "Pomodoro" : "Focus"}: ${task.title} · ${Math.floor((Date.now() - new Date(t.startedAt)) / 60000)} min` : "No timer running.";
  } else if (cmd === "done" || cmd === "status") {
    const STATUSES = ["todo", "doing", "waiting", "done"];
    const st = cmd === "done" ? "done" : args._[1];
    if (!STATUSES.includes(st)) throw new Error(`Status must be one of: ${STATUSES.join(", ")}`);
    update((s) => {
      const t = find(s, args._[0]);
      // If the timed task is finishing, its focus time is saved.
      if (st === "done" && s.timer?.taskId === t.id) { commit(s); s.timer = null; }
      setStatus(t, st);
      out = `${t.title} → ${t.status}`;
    });
  } else if (cmd === "tnote") {
    // Appends a line to the task's note (the instruction field); the old text stays.
    const text = args._.slice(1).join(" ").trim();
    if (!text) throw new Error("Note text is required");
    update((s) => {
      const t = find(s, args._[0]);
      t.notes = [t.notes, text].filter(Boolean).join("\n\n");
      out = `${t.title} · note added`;
    });
  } else if (cmd === "topic") {
    // pg topic <taskId> none | pg topic <automationId> "YYYY-MM-DD HH:MM" none: clears a post's topic (Rou writes a new one).
    const [id, a1, a2] = args._;
    if (!isNone(a2 ?? a1)) throw new Error('Usage: pg topic <taskId> none | pg topic <automationId> "day time" none');
    update((s) => {
      const a = a2 !== undefined && s.automations.find((x) => x.id === id);
      if (a) {
        if (!a.topics?.[a1]) throw new Error(`No topic: ${id} ${a1}`);
        delete a.topics[a1];
        out = `~ automation ${a.id} ${a1} topic cleared`;
      } else {
        const t = find(s, id);
        delete t.topic;
        out = `${t.title} · topic cleared`;
      }
    });
  } else if (cmd === "move") {
    update((s) => void setDay(s, find(s, args._[0]), parseDay(args._[1], null), iso(new Date())));
    out = "→";
  } else if (cmd === "src") {
    // pg src <projectId> "Title" --body ".." [--url ..]: adds a note (a link if an address is given) to the project's Notes; used in preparations.
    update((s) => {
      const p = s.projects.find((x) => x.id === args._[0]);
      if (!p) throw new Error(`No project: ${args._[0]}`);
      const title = args._.slice(1).join(" ").trim();
      const body = args.body && args.body !== true ? String(args.body) : "";
      if (!title || !body) throw new Error('Usage: pg src <projectId> "Title" --body ".." [--url ..]');
      const url = args.url && args.url !== true ? String(args.url) : undefined;
      if (url && !/^https?:\/\//.test(url)) throw new Error(`The address must be http(s): ${url}`);
      const src = { id: id(), kind: url ? "link" : "note", title, body, ...(url ? { url } : {}), use: true, addedAt: now() };
      (p.sources ??= []).push(src);
      out = `+ Notes ${src.id}  ${p.name} · ${title}`;
    });
  } else if (cmd === "srcrm") {
    // pg srcrm <projectId> <sourceId>: moves the project's Notes source to the Trash (30 days, can be restored).
    update((s) => {
      const p = s.projects.find((x) => x.id === args._[0]);
      if (!p) throw new Error(`No project: ${args._[0]}`);
      const src = (p.sources ?? []).find((x) => x.id === String(args._[1] ?? ""));
      if (!src) throw new Error(`No source: ${args._[1]}`);
      toTrash(s, id(), "source", src.title, { source: { projectId: p.id, src } });
      p.sources = p.sources.filter((x) => x.id !== src.id);
      out = `− ${src.title} (in the Trash, 30 days)`;
    });
  } else if (cmd === "rm") {
    update((s) => {
      // With an output id only that output (e.g. a rejected video) is trashed; the task stays.
      const r = s.runs.find((x) => x.id === String(args._[0] ?? ""));
      if (r) { toTrash(s, id(), "run", r.title, { runs: [r] }); s.runs = s.runs.filter((x) => x.id !== r.id); return; }
      // With an empty project's id (no tasks, automations or notes) the project is trashed.
      const p = s.projects.find((x) => x.id === String(args._[0] ?? ""));
      if (p) {
        if (s.tasks.some((t) => t.projectId === p.id) || (s.automations ?? []).some((a) => a.projectId === p.id) || s.inbox.some((n) => n.projectId === p.id)) throw new Error(`The project is not empty: ${p.name}`);
        toTrash(s, id(), "project", p.name, { projects: [p] }); s.projects = s.projects.filter((x) => x.id !== p.id); return;
      }
      const t = find(s, args._[0]);
      if (s.timer?.taskId === t.id) s.timer = null;
      for (const n of s.inbox) if (n.taskId === t.id) delete n.taskId;
      toTrash(s, id(), "task", t.title, { tasks: [t], blocks: s.blocks.filter((b) => b.taskId === t.id), sessions: s.sessions.filter((x) => x.taskId === t.id), runs: s.runs.filter((x) => x.taskId === t.id) });
      s.tasks = s.tasks.filter((x) => x.id !== t.id); s.blocks = s.blocks.filter((b) => b.taskId !== t.id); s.sessions = s.sessions.filter((x) => x.taskId !== t.id); s.runs = s.runs.filter((x) => x.taskId !== t.id); });
    out = "− (in the Trash, 30 days)";
  } else if (cmd === "worlds") {
    const { state: s } = read();
    for (const w of s.worlds) out += `${w.id.padEnd(10)} ${w.name.padEnd(12)} ${s.tasks.filter((t) => t.worldId === w.id && t.status !== "done").length} open · ${s.projects.filter((p) => p.worldId === w.id).length} projects\n`;
  } else if (cmd === "json") {
    out = JSON.stringify(read().state, null, 2);
  } else if (cmd && cmd !== "list" && !cmd.startsWith("--")) {
    // A mistyped command used to print the list and exit 0; the caller (Rou, a tool) thought the job was done.
    throw new Error(`Unknown command: ${cmd}`);
  } else {
    if (needsMaterialize(read().state)) update((s) => void materialize(s));
    const { state: s } = read();
    const today = iso(new Date());
    // --week: this week's tasks (Monday to Sunday) and late open tasks.
    const mon = new Date(); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const inWeek = (t) => (t.day && t.day >= iso(mon) && t.day <= iso(sun)) || t.status === "doing" || (t.day && t.day < today && t.status !== "done");
    const list = s.tasks
      .filter((t) => !args.pg || t.worldId === args.pg)
      .filter((t) => (args.week || cmd === "--week" ? inWeek(t) : t.day === today || t.status === "doing" || (t.day && t.day < today && t.status !== "done")))
      .sort((a, b) => String(a.day).localeCompare(String(b.day)));
    for (const t of list) out += `${t.status === "done" ? "✓" : t.status === "doing" ? "▶" : "·"} ${t.id}  ${t.day ?? "someday   "}  [${t.worldId}] ${t.title}\n`;
    if (!list.length) out = "The list is empty.";
  }
  console.log(out.trimEnd());
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
