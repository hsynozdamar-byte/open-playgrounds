import { useEffect, useState } from "react";
import { ExternalLink, LogIn, Monitor } from "lucide-react";
import type { Account, World } from "../types";
import { type Ctx, ALL } from "../lib";
import { PageHead } from "../ui/PageHead";
import { Orb } from "../ui/Orb";
import { AccountTile } from "../ui/Social";
import { toast } from "../ui/Toast";
import { inShell, LiveBrowser } from "../ui/LiveBrowser";

// Browser: the desktop app's per-world browser (server/pb.mjs). Each world is a profile; Rou works there, the user watches from here.
// While the page is open the state refreshes every 4 s, and the tab images are captured again at the same pace.
type Page = { id: string; title: string; url: string; rou?: string };
type Profile = { worldId: string; dir: string; exists: boolean; open: boolean; accounts: Record<string, boolean | null>; pages: Page[] };
type PB = { installed: boolean; running: boolean; profiles: Profile[]; other: (Page & { dir: string | null })[] };

const post = (url: string, body: object) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }));
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

function usePb() {
  const [pb, setPb] = useState<PB | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let on = true;
    const load = () => {
      if (document.hidden) return;
      fetch("/api/pb").then((r) => r.json()).then((x) => { if (on) { setPb(x); setTick((t) => t + 1); } }).catch(() => {});
    };
    load();
    const id = setInterval(load, 4000);
    return () => { on = false; clearInterval(id); };
  }, []);
  return [pb, tick] as const;
}

export function Browser({ ctx }: { ctx: Ctx }) {
  // Inside the Playgrounds app: the real browser is on this page. On phone and in the browser: the watch view (accounts, tab images).
  if (inShell) return <LiveBrowser ctx={ctx} />;
  return <Watch ctx={ctx} />;
}

function Watch({ ctx }: { ctx: Ctx }) {
  const [pb, tick] = usePb();
  const worlds = ctx.state.worlds.filter((w) => ctx.route.lens === ALL || w.id === ctx.route.lens);
  const open = async (worldId: string) => {
    const r = await post("/api/pb/open", { worldId });
    if (!r.ok) toast(r.error || "Couldn't open");
  };
  const sub = !pb ? "Loading" : !pb.installed ? "The Playgrounds app isn't installed" : pb.running ? "Open, each world in its own session" : "Closed, starts when you open a world";
  return (
    <>
      <PageHead ctx={ctx} title="Browser" sub={sub}>
        {pb?.installed && worlds.length === 1 && <button className="btn primary" onClick={() => open(worlds[0].id)}><Monitor size={15} />Show in browser</button>}
      </PageHead>
      {pb && !pb.installed && (
        <section className="card pbnote">
          <p>The Playgrounds desktop app isn't installed. Run <code>browser/build.sh</code> in the project folder to install it.</p>
        </section>
      )}
      {pb?.installed && worlds.map((w) => <WorldProfile key={w.id} ctx={ctx} world={w} p={pb.profiles.find((x) => x.worldId === w.id)} tick={tick} onOpen={() => open(w.id)} />)}
      {pb?.installed && ctx.route.lens === ALL && pb.other.length > 0 && (
        <section className="card wgroup pbworld">
          <header className="wghead"><span className="wgname"><b>Other profiles</b><span>{pb.other.length} tab{pb.other.length === 1 ? "" : "s"}</span></span></header>
          <ul className="strip pbtabs">{pb.other.map((x) => <TabTile key={x.id} t={x} tick={tick} />)}</ul>
        </section>
      )}
    </>
  );
}

function WorldProfile({ ctx, world, p, tick, onOpen }: { ctx: Ctx; world: World; p?: Profile; tick: number; onOpen: () => void }) {
  const accs = (world.accounts ?? []).filter((a) => a.platform !== "other");
  const pages = p?.pages ?? [];
  const line = p?.open ? `${pages.length} tab${pages.length === 1 ? "" : "s"} open` : "No tabs";
  return (
    <section className="card wgroup pbworld" style={{ ["--w" as string]: world.color }}>
      <header className="wghead">
        <button className="wgname" onClick={() => ctx.go({ lens: world.id })}>
          <Orb world={world} size={18} />
          <b>{world.name}</b>
          <span>{line}</span>
        </button>
        {ctx.route.lens === ALL && <button className="btn sm" onClick={onOpen}><Monitor size={14} />Show in browser</button>}
      </header>
      {accs.length > 0 && (
        <ul className="acclist strip">
          {accs.map((a) => <PbAccount key={a.id} ctx={ctx} a={a} world={world} on={p?.accounts[a.id]} />)}
        </ul>
      )}
      {pages.length > 0 && <ul className="strip pbtabs">{pages.map((t) => <TabTile key={t.id} t={t} tick={tick} />)}</ul>}
      {!accs.length && !pages.length && <p className="muted pbempty">This world has no browser accounts. Add accounts from Posts.</p>}
    </section>
  );
}

// Account box: the session in the profile (from the cookie), going to login and having Rou sign in.
function PbAccount({ ctx, a, world, on }: { ctx: Ctx; a: Account; world: World; on?: boolean | null }) {
  const lg = a.pbLogin;
  const working = !!lg?.phase && !lg.error && lg.ok === undefined;
  const go = async (login: boolean) => {
    const r = await post("/api/pb/open", { accountId: a.id, login });
    if (!r.ok) toast(r.error || "Couldn't open");
  };
  const state = on ? { cls: "is-ok", text: "Signed in" } : on === false ? { cls: "is-off", text: "Signed out" } : { cls: "", text: "Sign-in unknown" };
  return (
    <AccountTile ctx={ctx} a={a} world={world}>
      <div className="pbacc">
        <span className={`pbst ${working ? "is-busy" : state.cls}`}><i />{working ? lg!.phase : state.text}</span>
        {lg?.error && !working && <span className="pberr" title={lg.error}>{lg.error}</span>}
        <div className="pbactions">
          {on ? <button className="btn sm" onClick={() => go(false)}><ExternalLink size={14} />Open</button> : <button className="btn sm" onClick={() => go(true)}><LogIn size={14} />Sign-in page</button>}
        </div>
      </div>
    </AccountTile>
  );
}

// Tab box: a live small image, title, domain; pressing brings that tab forward in the browser.
function TabTile({ t, tick }: { t: Page; tick: number }) {
  // The old image stays until the new one loads (so the box does not flicker). A tab that is not in front in its window is not drawn: then the domain shows.
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const next = `/api/pb/shot?t=${t.id}&v=${tick}`;
    const img = new Image();
    img.onload = () => setSrc(next);
    img.onerror = () => setSrc(null);
    img.src = next;
  }, [t.id, tick]);
  const focus = async () => {
    const r = await post("/api/pb/focus", { targetId: t.id });
    if (!r.ok) toast(r.error || "Tab not found");
  };
  return (
    <li>
      <button className={`pbtab ${t.rou ? "is-rou" : ""}`} onClick={focus} title="Show in browser">
        <span className="pbshot">{src ? <img src={src} alt="" /> : <span className="pbnoshot">{host(t.url)}<small>No image yet</small></span>}{t.rou && <span className="pbrou">{t.rou}</span>}</span>
        <span className="pbmeta"><b>{t.title || host(t.url)}</b><span>{host(t.url)}</span></span>
      </button>
    </li>
  );
}
