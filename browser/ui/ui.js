// Playground Browser arayüzü (ana süreçten durum gelir, eylemler gider). Sayfaların kendisi ana süreçteki görünümlerde;
// her bölmenin sayfa alanı (.pbody) ölçülüp ana sürece bildirilir, sayfa tam oraya oturur.
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ICON = {
  back: '<path d="m15 18-6-6 6-6"/>', fwd: '<path d="m9 18 6-6-6-6"/>', reload: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  stop: '<path d="M18 6 6 18M6 6l12 12"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', plus: '<path d="M12 5v14M5 12h14"/>', split: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 4v16"/>',
};
const svg = (k, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
const PLAT = { x: ["X", "#111"], instagram: ["IG", "#d6336c"], linkedin: ["in", "#0a66c2"], threads: ["@", "#111"], tiktok: ["TT", "#111"], youtube: ["YT", "#e62117"], gmail: ["M", "#d93025"], gcal: ["31", "#1a73e8"], slack: ["S", "#4a154b"], clickup: ["C", "#7b68ee"] };
const PLAT_NAME = { x: "X", instagram: "Instagram", linkedin: "LinkedIn", threads: "Threads", tiktok: "TikTok", youtube: "YouTube", gmail: "Gmail", gcal: "Google Calendar", slack: "Slack", clickup: "ClickUp" };
// Hesabın görünen adı: @kullanıcı adı varsa o, yoksa adı (sayfa adresi değil).
const accName = (a) => (a.handle?.startsWith("@") ? a.handle : a.name || a.handle);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

let S = { worlds: [], shown: [], focus: null, tabs: [], sites: {} };
const worldOf = (id) => S.worlds.find((w) => w.id === id);
const tabsOf = (id) => S.tabs.filter((t) => t.worldId === id);
const activeOf = (id) => S.tabs.find((t) => t.worldId === id && t.active);
const act = (a) => window.pb.act(a);
// Dünya küreleri Playgrounds'un motoruyla (orbs.js).
const orbs = window.pbOrbs;
const colorVars = (w) => `--c:${w.color || "#5b3df0"};${w.color2 ? `--c2:${w.color2};` : ""}`;

// Dünyanın hesabı bu adrese mi ait: bölme çubuğunda oturum durumu.
function accountAt(w, url) {
  const h = host(url);
  return h && w.accounts.find((a) => S.sites[a.platform]?.hosts.some((x) => h === x || h.endsWith(`.${x}`)));
}

function renderSide() {
  const nav = $("#worlds");
  nav.innerHTML = S.worlds.map((w, i) => {
    const ts = tabsOf(w.id);
    const work = ts.find((t) => t.who);
    const on = w.accounts.filter((a) => a.on).length;
    const sub = work ? `${work.who}` : ts.length ? `${ts.length} tab${ts.length === 1 ? "" : "s"}${on ? `, ${on} signed in` : ""}` : on ? `${on} signed in` : "Closed";
    const shown = S.shown.includes(w.id);
    return `<button class="wrow ${shown ? "is-shown" : ""} ${S.focus === w.id && S.shown.length > 1 ? "is-focus" : ""}" style="${colorVars(w)}" data-w="${esc(w.id)}" title="${esc(w.name)} (⌘${i + 1})">
      <span class="orb" data-orb="${esc(w.id)}" data-k="side">${work ? '<i class="pulse"></i>' : ""}</span>
      <span class="wtext"><b>${esc(w.name)}</b><span class="${work ? "is-work" : ""}">${esc(sub)}</span></span>
      <span class="wadd ${shown && S.shown.length > 1 ? "on" : ""}" data-add="${esc(w.id)}" title="${shown ? "Remove from side by side" : "Add side by side"}">${svg("split", 15)}</span>
    </button>`;
  }).join("") || `<p class="hint">Worlds come from Playgrounds. Is Playgrounds open?</p>`;
  orbs?.fill(nav);
}

function toggle(id) {
  if (S.shown.includes(id)) { if (S.shown.length > 1) act({ type: "show", worlds: S.shown.filter((x) => x !== id), focus: S.focus === id ? undefined : S.focus }); }
  else if (S.shown.length < 4) act({ type: "show", worlds: [...S.shown, id], focus: id });
  else act({ type: "show", worlds: [...S.shown.slice(1), id], focus: id });
}
$("#worlds").addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  if (add) { e.stopPropagation(); return toggle(add.dataset.add); }
  const row = e.target.closest("[data-w]");
  if (!row) return;
  if (e.metaKey) return toggle(row.dataset.w);
  act({ type: "show", worlds: [row.dataset.w], focus: row.dataset.w });
});

// ---- bölmeler: dünya başına bir kez kurulur, sonra parçaları güncellenir (adres yazılırken bozulmasın) ----
const panes = new Map();
function pane(w) {
  let el = panes.get(w.id);
  if (el) return el;
  el = document.createElement("section");
  el.className = "pane";
  el.dataset.w = w.id;
  el.innerHTML = `
    <header class="phead"><span class="pname"><span class="orb sm" data-orb="${esc(w.id)}" data-k="pane"></span><span class="nm"></span></span><div class="tabs"></div>
      <button class="iconbtn" data-a="newTab" title="New tab (⌘T)">${svg("plus")}</button><span class="whoslot"></span><button class="iconbtn closep" data-a="unshow" title="Close pane">${svg("x", 15)}</button></header>
    <div class="pbar">
      <button class="iconbtn" data-a="back" title="Back">${svg("back")}</button><button class="iconbtn" data-a="fwd" title="Forward">${svg("fwd")}</button><button class="iconbtn" data-a="reload" title="Reload">${svg("reload", 15)}</button>
      <input class="addr" spellcheck="false" placeholder="Search or type an address">
      <span class="sessslot"></span>
    </div>
    <div class="pbody"><div class="empty"></div></div>`;
  el.addEventListener("mousedown", () => { if (S.focus !== w.id) act({ type: "focus", world: w.id }); });
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]");
    const tab = activeOf(w.id);
    if (b) {
      const a = b.dataset.a;
      if (a === "newTab") { act({ type: "newTab", world: w.id }); setTimeout(() => $(".addr", el).focus(), 50); }
      else if (a === "unshow") act({ type: "show", worlds: S.shown.filter((x) => x !== w.id) });
      else if (a === "reload" && tab?.loading) act({ type: "stop", tab: tab.id });
      else if (tab) act({ type: a, tab: tab.id });
      return;
    }
    const x = e.target.closest("[data-x]");
    if (x) { e.stopPropagation(); return act({ type: "close", tab: x.dataset.x }); }
    const t = e.target.closest("[data-t]");
    if (t) return act({ type: "activate", tab: t.dataset.t });
    const open = e.target.closest("[data-open]");
    if (open) return act({ type: "newTab", world: w.id, url: open.dataset.open });
  });
  const addr = $(".addr", el);
  addr.addEventListener("focus", () => addr.select());
  addr.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const tab = activeOf(w.id); act({ type: "go", tab: tab?.id, world: w.id, input: addr.value }); addr.blur(); }
    if (e.key === "Escape") { addr.value = activeOf(w.id)?.url ?? ""; addr.blur(); }
  });
  orbs?.fill(el);
  panes.set(w.id, el);
  return el;
}

function fillPane(el, w) {
  el.setAttribute("style", colorVars(w));
  el.classList.toggle("is-focus", S.focus === w.id && S.shown.length > 1);
  $(".nm", el).textContent = w.name;
  $(".closep", el).hidden = S.shown.length < 2;
  const ts = tabsOf(w.id);
  const cur = activeOf(w.id);
  $(".tabs", el).innerHTML = ts.map((t) => `<button class="tab ${t.active ? "on" : ""}" data-t="${t.id}" title="${esc(t.title || t.url)}">
      ${t.who ? '<i class="who"></i>' : t.favicon ? `<img src="${esc(t.favicon)}" alt="">` : '<span class="fav"></span>'}
      <span class="tt">${esc(t.title || host(t.url) || "New tab")}</span><span class="x" data-x="${t.id}" title="Close">${svg("x", 12)}</span></button>`).join("");
  $(".whoslot", el).innerHTML = cur?.who ? `<span class="who-chip"><i></i>${esc(cur.who)}</span>` : "";
  const [back, fwd, reload] = el.querySelectorAll(".pbar .iconbtn");
  back.disabled = !cur?.canBack; fwd.disabled = !cur?.canFwd; reload.disabled = !cur;
  reload.innerHTML = cur?.loading ? svg("stop", 15) : svg("reload", 15);
  const addr = $(".addr", el);
  if (document.activeElement !== addr) addr.value = cur?.url && !cur.url.startsWith("about:") ? cur.url : "";
  const acc = cur && accountAt(w, cur.url);
  $(".sessslot", el).innerHTML = acc ? `<span class="sess ${acc.on ? "ok" : acc.on === false ? "off" : ""}"><i></i>${esc(accName(acc))}${acc.on ? ", signed in" : acc.on === false ? ", not signed in" : ""}</span>` : "";
  $(".empty", el).hidden = !!cur;
  if (!cur) { $(".empty", el).innerHTML = emptyOf(w); orbs?.fill($(".empty", el)); }
}

function emptyOf(w) {
  const rows = w.accounts.map((a) => {
    const [mono, bg] = PLAT[a.platform] ?? ["•", "#888"];
    const site = S.sites[a.platform];
    return `<div class="acc"><span class="plat" style="background:${bg}">${esc(mono)}</span>
      <span class="t"><b>${esc(accName(a))}</b><span class="${a.on ? "ok" : a.on === false ? "off" : ""}">${esc(PLAT_NAME[a.platform] ?? a.platform)}, ${a.on ? "signed in" : a.on === false ? "not signed in" : "sign-in unknown"}</span></span>
      <button class="btn ${a.on ? "" : "pri"}" data-open="${esc(a.on ? site.home : site.login)}">${a.on ? "Open" : "Sign in"}</button></div>`;
  }).join("");
  return `<div class="in"><h2><span class="orb" data-orb="${esc(w.id)}" data-k="empty"></span>${esc(w.name)}</h2>
    ${rows ? `<p>This world's accounts stay signed in in this profile. Rou works here.</p><div class="accs">${rows}</div>` : `<p>This world has no browser accounts. Start by typing in the address bar.</p>`}</div>`;
}

function renderStage() {
  const stage = $("#stage");
  const list = S.shown.map(worldOf).filter(Boolean);
  stage.className = `stage n${Math.max(1, list.length)}`;
  for (const [id, el] of panes) if (!S.shown.includes(id)) el.remove();
  list.forEach((w, i) => {
    const el = pane(w);
    if (stage.children[i] !== el) stage.insertBefore(el, stage.children[i] ?? null);
    fillPane(el, w);
  });
  if (!list.length) stage.innerHTML = `<p class="none">Pick a world on the left.</p>`;
  else stage.querySelector(".none")?.remove();
  const f = worldOf(S.focus) ?? list[0];
  if (f) { document.body.style.setProperty("--w", f.color || "#5b3df0"); document.body.style.setProperty("--w2", f.color2 || f.color || "#5b3df0"); }
  queueRects();
}

// Sayfa alanları: her değişimde ve pencere boyu değişince ölçülüp gönderilir.
let rq = 0;
function queueRects() {
  cancelAnimationFrame(rq);
  rq = requestAnimationFrame(() => {
    const out = {};
    for (const [id, el] of panes) if (el.isConnected) { const r = $(".pbody", el).getBoundingClientRect(); out[id] = { x: r.left, y: r.top, w: r.width, h: r.height }; }
    window.pb.rects(out);
  });
}
new ResizeObserver(queueRects).observe($("#stage"));

// Kenar çubuğu daraltılabilir: yalnız küreler kalır (tercih bu bilgisayarda saklanır).
function setMini(on) {
  document.body.classList.toggle("is-mini", on);
  const b = $("#sidetog"); const t = on ? "Expand sidebar (⌘\\)" : "Collapse sidebar (⌘\\)";
  b.title = t; b.setAttribute("aria-label", t.replace(/ \(.*\)$/, ""));
  try { localStorage.setItem("pb-mini", on ? "1" : ""); } catch {}
  queueRects();
}
const toggleMini = () => setMini(!document.body.classList.contains("is-mini"));
$("#sidetog").addEventListener("click", toggleMini);
window.pb.onToggleSide?.(toggleMini);
try { if (localStorage.getItem("pb-mini")) setMini(true); } catch {}
window.pb.onState((s) => { S = s; orbs?.setWorlds(s.worlds); renderSide(); renderStage(); });
orbs?.fill();
window.pb.onFocusAddress(() => { const el = panes.get(S.focus); if (el) $(".addr", el).focus(); });
