import { useEffect, useState } from "react";
import { ExternalLink, LogIn, Monitor } from "lucide-react";
import type { Account, World } from "../types";
import { type Ctx, ALL } from "../lib";
import { PageHead } from "../ui/PageHead";
import { Orb } from "../ui/Orb";
import { AccountTile } from "../ui/Social";
import { toast } from "../ui/Toast";
import { inShell, LiveBrowser } from "../ui/LiveBrowser";

// Tarayıcı: Playground Browser (server/pb.mjs). Her dünya bir profil; Rou orada çalışır, kullanıcı buradan izler.
// Sayfa açıkken durum 4 sn'de bir yenilenir, sekme görüntüleri de aynı tempoda yeniden çekilir.
type Page = { id: string; title: string; url: string; rou?: string };
type Profile = { worldId: string; dir: string; exists: boolean; open: boolean; accounts: Record<string, boolean | null>; pages: Page[] };
type PB = { installed: boolean; running: boolean; profiles: Profile[]; other: (Page & { dir: string | null })[] };

const post = (url: string, body: object) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: "Sunucuya ulaşılamadı" }));
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
  // Playgrounds uygulamasının içinde: gerçek tarayıcı bu sayfada. Telefonda ve tarayıcıda: izleme (hesaplar, sekme görüntüleri).
  if (inShell) return <LiveBrowser ctx={ctx} />;
  return <Watch ctx={ctx} />;
}

function Watch({ ctx }: { ctx: Ctx }) {
  const [pb, tick] = usePb();
  const worlds = ctx.state.worlds.filter((w) => ctx.route.lens === ALL || w.id === ctx.route.lens);
  const open = async (worldId: string) => {
    const r = await post("/api/pb/open", { worldId });
    if (!r.ok) toast(r.error || "Açılamadı");
  };
  const sub = !pb ? "Yükleniyor" : !pb.installed ? "Playgrounds uygulaması kurulu değil" : pb.running ? "Açık, her dünya kendi oturumunda" : "Kapalı, bir dünyayı açınca başlar";
  return (
    <>
      <PageHead ctx={ctx} title="Tarayıcı" sub={sub}>
        {pb?.installed && worlds.length === 1 && <button className="btn primary" onClick={() => open(worlds[0].id)}><Monitor size={15} />Tarayıcıda göster</button>}
      </PageHead>
      {pb && !pb.installed && (
        <section className="card pbnote">
          <p>Playgrounds masaüstü uygulaması kurulu değil. Proje klasöründe <code>browser/build.sh</code> çalıştırınca kurulur.</p>
        </section>
      )}
      {pb?.installed && worlds.map((w) => <WorldProfile key={w.id} ctx={ctx} world={w} p={pb.profiles.find((x) => x.worldId === w.id)} tick={tick} onOpen={() => open(w.id)} />)}
      {pb?.installed && ctx.route.lens === ALL && pb.other.length > 0 && (
        <section className="card wgroup pbworld">
          <header className="wghead"><span className="wgname"><b>Diğer profiller</b><span>{pb.other.length} sekme</span></span></header>
          <ul className="strip pbtabs">{pb.other.map((x) => <TabTile key={x.id} t={x} tick={tick} />)}</ul>
        </section>
      )}
    </>
  );
}

function WorldProfile({ ctx, world, p, tick, onOpen }: { ctx: Ctx; world: World; p?: Profile; tick: number; onOpen: () => void }) {
  const accs = (world.accounts ?? []).filter((a) => a.platform !== "other");
  const pages = p?.pages ?? [];
  const line = p?.open ? `${pages.length} sekme açık` : "Sekme yok";
  return (
    <section className="card wgroup pbworld" style={{ ["--w" as string]: world.color }}>
      <header className="wghead">
        <button className="wgname" onClick={() => ctx.go({ lens: world.id })}>
          <Orb world={world} size={18} />
          <b>{world.name}</b>
          <span>{line}</span>
        </button>
        {ctx.route.lens === ALL && <button className="btn sm" onClick={onOpen}><Monitor size={14} />Tarayıcıda göster</button>}
      </header>
      {accs.length > 0 && (
        <ul className="acclist strip">
          {accs.map((a) => <PbAccount key={a.id} ctx={ctx} a={a} world={world} on={p?.accounts[a.id]} />)}
        </ul>
      )}
      {pages.length > 0 && <ul className="strip pbtabs">{pages.map((t) => <TabTile key={t.id} t={t} tick={tick} />)}</ul>}
      {!accs.length && !pages.length && <p className="muted pbempty">Bu dünyada tarayıcı hesabı yok. Hesaplar Gönderiler'den eklenir.</p>}
    </section>
  );
}

// Hesap kutusu: profildeki oturum (çerezden), girişe gitme ve Rou'ya giriş yaptırma.
function PbAccount({ ctx, a, world, on }: { ctx: Ctx; a: Account; world: World; on?: boolean | null }) {
  const lg = a.pbLogin;
  const working = !!lg?.phase && !lg.error && lg.ok === undefined;
  const go = async (login: boolean) => {
    const r = await post("/api/pb/open", { accountId: a.id, login });
    if (!r.ok) toast(r.error || "Açılamadı");
  };
  const state = on ? { cls: "is-ok", text: "Giriş açık" } : on === false ? { cls: "is-off", text: "Giriş yok" } : { cls: "", text: "Oturum bilinmiyor" };
  return (
    <AccountTile ctx={ctx} a={a} world={world}>
      <div className="pbacc">
        <span className={`pbst ${working ? "is-busy" : state.cls}`}><i />{working ? lg!.phase : state.text}</span>
        {lg?.error && !working && <span className="pberr" title={lg.error}>{lg.error}</span>}
        <div className="pbactions">
          {on ? <button className="btn sm" onClick={() => go(false)}><ExternalLink size={14} />Aç</button> : <button className="btn sm" onClick={() => go(true)}><LogIn size={14} />Giriş sayfası</button>}
        </div>
      </div>
    </AccountTile>
  );
}

// Sekme kutusu: canlı küçük görüntü, başlık, alan adı; basınca tarayıcıda o sekme öne gelir.
function TabTile({ t, tick }: { t: Page; tick: number }) {
  // Görüntü yüklenene kadar eskisi kalır (kutu yanıp sönmesin). Penceresinde önde olmayan sekme çizilmez: o zaman alan adı görünür.
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
    if (!r.ok) toast(r.error || "Sekme bulunamadı");
  };
  return (
    <li>
      <button className={`pbtab ${t.rou ? "is-rou" : ""}`} onClick={focus} title="Tarayıcıda göster">
        <span className="pbshot">{src ? <img src={src} alt="" /> : <span className="pbnoshot">{host(t.url)}<small>Henüz görüntü yok</small></span>}{t.rou && <span className="pbrou">{t.rou}</span>}</span>
        <span className="pbmeta"><b>{t.title || host(t.url)}</b><span>{host(t.url)}</span></span>
      </button>
    </li>
  );
}
