import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Reorder } from "motion/react";
import { ArrowLeft, ArrowRight, Columns2, LogIn, Plus, RotateCw, Search, X } from "lucide-react";
import type { World } from "../types";
import { type Ctx, ALL } from "../lib";
import { Orb } from "./Orb";

// Playgrounds uygulamasının içindeki gerçek tarayıcı (browser/main.mjs, PG_SHELL=app). Sayfalar ana süreçte; bu bileşen her dünyanın
// bölmesini çizer ve bölmenin sayfa alanını (.lb-body) her karede ölçüp bildirir: gerçek sekme tam oraya oturur. Alanın üstüne
// arayüzden bir şey gelirse (pencere, menü, Rou) "covered" bildirilir; sekme çekilir, yerinde son görüntüsü durur.
type Acc = { id: string; platform: string; name: string; handle?: string; on?: boolean | null };
type PbWorld = { id: string; name: string; color: string; color2?: string; accounts: Acc[] };
type Tab = { id: string; worldId: string; url: string; title: string; favicon: string; loading: boolean; who: string; canBack?: boolean; canFwd?: boolean; active: boolean };
type Snap = { worlds: PbWorld[]; shown: string[]; focus: string | null; sites: Record<string, { hosts: string[]; home: string; login: string }>; tabs: Tab[] };
type Rect = { x: number; y: number; w: number; h: number; covered?: boolean };
type Bridge = {
  shell: boolean; act: (a: object) => void; rects: (r: Record<string, Rect>) => void;
  onState: (fn: (s: Snap) => void) => void; onFocusAddress: (fn: () => void) => void;
  onRoute: (fn: (r: { view: string; world: string }) => void) => void; onShot: (fn: (x: { tab: string; src: string }) => void) => void;
};
const pb = (window as unknown as { pb?: Bridge }).pb;
export const inShell = !!pb?.shell;

// Ana süreçten gelen durum ve görüntüler: tek abonelik, bileşenler useSyncExternalStore ile okur.
let snap: Snap = { worlds: [], shown: [], focus: null, sites: {}, tabs: [] };
const shots = new Map<string, string>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const addrFocus = new Set<() => void>();
if (inShell) {
  pb!.onState((s) => { snap = s; emit(); });
  pb!.onShot(({ tab, src }) => { shots.set(tab, src); snap = { ...snap }; emit(); });
  pb!.onFocusAddress(() => addrFocus.forEach((f) => f()));
  // Rou bir dünyayı öne getirdi: Tarayıcı sayfasına geç (o dünya gösterilir).
  pb!.onRoute((r) => { if (r.view === "browser" && !location.hash.startsWith("#browser")) location.hash = `#browser/${ALL}`; });
}
const useSnap = () => useSyncExternalStore((f) => { subs.add(f); return () => void subs.delete(f); }, () => snap);

const act = (a: object) => pb?.act(a);
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const accName = (a: Acc) => (a.handle?.startsWith("@") ? a.handle : a.name || a.handle || "");
const PLAT: Record<string, [string, string, string]> = {
  x: ["X", "#111", "X"], instagram: ["IG", "#d6336c", "Instagram"], linkedin: ["in", "#0a66c2", "LinkedIn"], threads: ["@", "#111", "Threads"], tiktok: ["TT", "#111", "TikTok"],
  youtube: ["YT", "#e62117", "YouTube"], gmail: ["M", "#d93025", "Gmail"], gcal: ["31", "#1a73e8", "Google Calendar"], slack: ["S", "#4a154b", "Slack"], clickup: ["C", "#7b68ee", "ClickUp"],
};

export function LiveBrowser({ ctx }: { ctx: Ctx }) {
  const s = useSnap();
  const lens = ctx.route.lens;
  // Üst çubukta bir dünya seçiliyse o dünya tek başına gösterilir.
  useEffect(() => {
    if (lens !== ALL && !(s.shown.length === 1 && s.shown[0] === lens)) act({ type: "show", worlds: [lens], focus: lens });
  }, [lens]); // eslint-disable-line react-hooks/exhaustive-deps
  const worldOf = (id: string) => ctx.state.worlds.find((w) => w.id === id);
  const shown = s.shown.map((id) => ({ w: worldOf(id), p: s.worlds.find((x) => x.id === id) })).filter((x): x is { w: World; p: PbWorld } => !!x.w && !!x.p);
  const toggle = (id: string, add: boolean) => {
    if (!add) return act({ type: "show", worlds: [id], focus: id });
    if (s.shown.includes(id)) { if (s.shown.length > 1) act({ type: "show", worlds: s.shown.filter((x) => x !== id) }); }
    else act({ type: "show", worlds: [...s.shown, id].slice(-4), focus: id });
  };
  useRects(shown.map((x) => x.w.id));
  return (
    <div className={`lb ${lens === ALL ? "has-rail" : ""}`}>
      {/* Üst çubukta dünya seçiliyse (tek dünya) şerit gerekmez. Playgrounds seçiliyken dünyalar solda dar, dikey bir şeritte
          (yalnız simge; ad üzerine gelince): üst çubuktaki dünya satırını tekrar etmez (2026-11-01). Tık: yalnız o; ⌘-tık: yan yana. */}
      {lens === ALL && <nav className="lb-worlds" aria-label="Worlds">
        {ctx.state.worlds.map((w) => {
          const ts = s.tabs.filter((t) => t.worldId === w.id);
          const on = s.shown.includes(w.id);
          const work = ts.find((t) => t.who);
          return (
            <button key={w.id} className={`lb-chip ${on ? "is-on" : ""}`} style={{ ["--w" as string]: w.color }} onClick={(e) => toggle(w.id, e.metaKey || e.ctrlKey)} aria-label={w.name}>
              <Orb world={w} size={18} />
              <span className="lb-name">{w.name}</span>
              {work ? <i className="lb-pulse" /> : ts.length > 0 && <small>{ts.length}</small>}
            </button>
          );
        })}
        <span className="lb-hint" aria-label="⌘-click: side by side, up to four"><Columns2 size={15} /></span>
      </nav>}
      <div className={`lb-stage n${Math.max(1, shown.length)}`}>
        {shown.map(({ w, p }) => <Pane key={w.id} world={w} p={p} snap={s} many={shown.length > 1} />)}
        {!shown.length && <p className="lb-none">Pick a world at the top.</p>}
      </div>
    </div>
  );
}

// Her karede bölmelerin sayfa alanı ölçülür; yalnız değişince bildirilir. Sayfadan çıkınca alanlar boşalır, sekmeler çekilir.
function useRects(ids: string[]) {
  const key = ids.join(",");
  useEffect(() => {
    let raf = 0, last = "";
    const tick = () => {
      const out: Record<string, Rect> = {};
      for (const id of ids) {
        const el = document.querySelector<HTMLElement>(`.lb-pane[data-w="${CSS.escape(id)}"] .lb-body`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        out[id] = { x: r.left, y: r.top, w: r.width, h: r.height, covered: covered(el, r) };
      }
      const j = JSON.stringify(out);
      if (j !== last) { last = j; pb?.rects(out); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); pb?.rects({}); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
// 5x5 noktada en üstteki öğe alanın kendisi (ya da içi) değilse alan örtülü.
function covered(el: HTMLElement, r: DOMRect) {
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const top = document.elementFromPoint(r.left + 3 + ((r.width - 6) * i) / 4, r.top + 3 + ((r.height - 6) * j) / 4);
    if (!top || !el.contains(top)) return true;
  }
  return false;
}

function Pane({ world, p, snap: s, many }: { world: World; p: PbWorld; snap: Snap; many: boolean }) {
  const all = s.tabs.filter((t) => t.worldId === world.id);
  // Sekmeler sürüklenerek sıralanır; sürüklerken sıra yerelde tutulur, bırakınca ana sürece gider.
  const [order, setOrder] = useState<string[] | null>(null);
  const ts = order ? [...order.map((id) => all.find((t) => t.id === id)).filter((t): t is Tab => !!t), ...all.filter((t) => !order.includes(t.id))] : all;
  const saveOrder = () => {
    if (!order) return;
    if (order.join() !== all.map((t) => t.id).join()) act({ type: "order", world: world.id, order });
    setOrder(null);
  };
  const cur = ts.find((t) => t.active);
  const addr = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setText(cur?.url && !cur.url.startsWith("about:") ? cur.url : ""); }, [cur?.url, cur?.id]);
  const isFocus = s.focus === world.id;
  useEffect(() => {
    const f = () => { if (s.focus === world.id || (!s.focus && s.shown[0] === world.id)) { addr.current?.focus(); addr.current?.select(); } };
    addrFocus.add(f); return () => void addrFocus.delete(f);
  }, [s.focus, s.shown, world.id]);
  const acc = cur && p.accounts.find((a) => s.sites[a.platform]?.hosts.some((h) => host(cur.url) === h || host(cur.url).endsWith(`.${h}`)));
  const shot = cur && shots.get(cur.id);
  // Sekme yok ya da sekme boş (yeni sekme): hesaplar ve arama gösterilir.
  const blank = !cur || !cur.url || cur.url.startsWith("about:");
  return (
    <section className={`lb-pane ${isFocus && many ? "is-focus" : ""}`} data-w={world.id} style={{ ["--w" as string]: world.color }} onMouseDown={() => { if (s.focus !== world.id) act({ type: "focus", world: world.id }); }}>
      <header className="lb-head">
        <span className="lb-name"><Orb world={world} size={18} /><b>{world.name}</b></span>
        <div className="lb-tabs">
          <Reorder.Group as="div" axis="x" layoutScroll className="lb-tabrow" values={ts.map((t) => t.id)} onReorder={setOrder}>
            {ts.map((t) => (
              <Reorder.Item key={t.id} value={t.id} as="button" className={`lb-tab ${t.active ? "is-on" : ""}`} onClick={() => act({ type: "activate", tab: t.id })} title={t.title || t.url}
                onDragEnd={saveOrder} whileDrag={{ scale: 1.03, zIndex: 2 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
                {t.who ? <i className="lb-who" /> : t.favicon ? <img src={t.favicon} alt="" draggable={false} /> : <span className="lb-fav" />}
                <span className="lb-tt">{t.title || host(t.url) || "New tab"}</span>
                <span className="lb-x" role="button" aria-label="Close tab" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); act({ type: "close", tab: t.id }); }}><X size={12} /></span>
              </Reorder.Item>
            ))}
          </Reorder.Group>
          <button className="lb-icon" onClick={() => { act({ type: "newTab", world: world.id }); setTimeout(() => addr.current?.focus(), 60); }} title="New tab (⌘T)" aria-label="New tab"><Plus size={16} /></button>
        </div>
        {cur?.who && <span className="lb-whochip"><i />{cur.who}</span>}
        {many && <button className="lb-icon" onClick={() => act({ type: "show", worlds: s.shown.filter((x) => x !== world.id) })} title="Close pane" aria-label="Close pane"><X size={15} /></button>}
      </header>
      <div className="lb-bar">
        <button className="lb-icon" disabled={!cur?.canBack} onClick={() => cur && act({ type: "back", tab: cur.id })} aria-label="Back"><ArrowLeft size={16} /></button>
        <button className="lb-icon" disabled={!cur?.canFwd} onClick={() => cur && act({ type: "fwd", tab: cur.id })} aria-label="Forward"><ArrowRight size={16} /></button>
        <button className="lb-icon" disabled={!cur} onClick={() => cur && act({ type: cur.loading ? "stop" : "reload", tab: cur.id })} aria-label={cur?.loading ? "Stop" : "Reload"}>{cur?.loading ? <X size={15} /> : <RotateCw size={15} />}</button>
        <input ref={addr} className="lb-addr" spellCheck={false} placeholder="Search or type an address" value={text}
          onFocus={(e) => { editing.current = true; e.target.select(); }} onBlur={() => { editing.current = false; setText(cur?.url && !cur.url.startsWith("about:") ? cur.url : ""); }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { act({ type: "go", tab: cur?.id, world: world.id, input: text }); e.currentTarget.blur(); }
            if (e.key === "Escape") e.currentTarget.blur();
          }} />
        {acc && <span className={`lb-sess ${acc.on ? "is-ok" : acc.on === false ? "is-off" : ""}`}><i />{accName(acc)}{acc.on ? ", signed in" : acc.on === false ? ", not signed in" : ""}</span>}
      </div>
      <div className="lb-body">
        {blank ? <Empty world={world} p={p} sites={s.sites} tab={cur?.id} />
          : shot && <img className="lb-shot" src={shot} alt="" />}
      </div>
    </section>
  );
}

// Boş sekme (ya da sekmesi olmayan dünya): gri Rou silueti, arama, dünyanın hesapları ve girişleri.
// tab verilirse açılan adres o boş sekmede açılır; yoksa yeni sekme.
function Empty({ world, p, sites, tab }: { world: World; p: PbWorld; sites: Snap["sites"]; tab?: string }) {
  const [q, setQ] = useState("");
  const open = (url: string) => act(tab ? { type: "go", tab, world: world.id, input: url } : { type: "newTab", world: world.id, url });
  return (
    <div className="lb-empty">
      <span className="lb-rou rou-body" aria-hidden />
      <form className="lb-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { act({ type: "go", tab, world: world.id, input: q.trim() }); setQ(""); } }}>
        <Search size={17} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search in ${world.name} or type an address`} aria-label="Search or type an address" spellCheck={false} />
      </form>
      {p.accounts.length ? <>
        <p className="lb-accnote"><Orb world={world} size={16} />{world.name} accounts</p>
        <ul className="lb-accs">
          {p.accounts.map((a) => {
            const [mono, bg, name] = PLAT[a.platform] ?? ["•", "#888", a.platform];
            const site = sites[a.platform];
            return (
              <li key={a.id}>
                <span className="lb-plat" style={{ background: bg }}>{mono}</span>
                <span className="lb-acc"><b>{accName(a)}</b><span className={a.on ? "is-ok" : a.on === false ? "is-off" : ""}>{name}, {a.on ? "signed in" : a.on === false ? "not signed in" : "sign-in unknown"}</span></span>
                {site && <button className={`btn sm ${a.on ? "" : "wfill"}`} onClick={() => open(a.on ? site.home : site.login)}>{a.on ? "Open" : <><LogIn size={14} />Sign in</>}</button>}
              </li>
            );
          })}
        </ul>
      </> : null}
    </div>
  );
}
