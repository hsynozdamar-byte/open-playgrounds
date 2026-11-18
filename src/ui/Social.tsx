import { BrandIcon } from "./BrandIcon";
import { motion } from "motion/react";
import { useEffect, useState, useRef } from "react";
import { Folder, Globe, KeyRound, Pencil, RefreshCw, X } from "lucide-react";
import type { Account, Feed, Platform, World } from "../types";
import type { Ctx } from "../lib";
import { uid } from "../store";
import { FEEDS, LANGS, PLATFORMS, isFeed, platformName, projectsOfAccount } from "../../shared/social.mjs";
import { AddRow } from "./QuickAdd";
import { Orb } from "./Orb";
import { reveal } from "./reveal";
import { toast } from "./Toast";
import { binIt } from "../trashOps";
import { Select } from "./Select";

// Hesaplar dünyada durur: paylaşım hesapları (Instagram, LinkedIn...) ve gelen kaynakları (Gmail, Slack...).
// Hesabın hangi projelerde kullanıldığı (project.accountIds) hesap penceresinin Projeler satırında seçilir.
// Hesap penceresi her yerden açılır: openAccountForm({ worldId }) yeni, ({ worldId, id }) düzenle, projectId verilirse yeni hesap o projede seçilir.

export type AccountDraft = Pick<Account, "platform" | "name" | "handle" | "voice" | "lang" | "login" | "premium">;
type Kind = Platform | Feed;
const MAKES: Record<Platform, string> = {
  instagram: "Gönderi, Reels",
  linkedin: "Gönderi",
  x: "Tweet, flood",
  threads: "Gönderi",
  tiktok: "Dikey video",
  youtube: "Dikey video",
  other: "Düz metin",
};
// Tarayıcıdan paylaşılabilen platformlar (server/publish.mjs HOME ile aynı).
export const PUBLISHABLE = new Set<string>(["instagram", "linkedin", "x", "threads", "tiktok", "youtube"]);
export const emptyAccount = (platform: Kind = "instagram"): AccountDraft => ({ platform, name: "", handle: "", voice: "" });
export const cleanHandle = (a: AccountDraft) => {
  const h = a.handle.trim();
  if (!h || isFeed(a.platform) || a.platform === "other") return h;
  return `@${h.replace(/^@\s*/, "")}`;
};
export const accountLine = (a: Pick<Account, "platform" | "name" | "handle">) => [platformName(a), a.platform === "other" ? "" : a.name, a.handle].filter(Boolean).join(" · ");
export const worldOfAccount = (ws: World[], id: string) => ws.find((w) => w.accounts?.some((a) => a.id === id));

// Platform kutucukları (Paylaşım ve Gelenler) + alanlar. Proje formu da bunu kullanır.
// group: yalnız paylaşım ya da yalnız gelen kaynakları gösterilir (Gönderiler ve Defter kendi türünü ekler).
export function AccountFields({ a, set, autoFocus, lock, group }: { a: AccountDraft; set: (p: Partial<AccountDraft>) => void; autoFocus?: boolean; lock?: boolean; group?: Group }) {
  const feed = isFeed(a.platform);
  return (
    <div className="accfields">
      {!lock && (
        <>
          {group !== "feed" && <>
          <p className="accgroup">Paylaşım <span>Gönderi hazırlanır, onaylayınca paylaşılır</span></p>
          <div className="plattiles" role="radiogroup" aria-label="Paylaşım hesabı">
            {(Object.keys(PLATFORMS) as Platform[]).map((k) => (
              <button type="button" key={k} role="radio" aria-checked={a.platform === k} className={a.platform === k ? "on" : ""} onClick={() => set({ platform: k })}>
                <BrandIcon platform={k} size={18} />
                <b>{PLATFORMS[k].label}</b>
                <span>{MAKES[k]}</span>
              </button>
            ))}
          </div>
          </>}
          {group !== "post" && <>
          <p className="accgroup">Gelenler <span>Buradan gelenler Defter'e düşer</span></p>
          <div className="plattiles" role="radiogroup" aria-label="Gelen kaynağı">
            {(Object.keys(FEEDS) as Feed[]).map((k) => (
              <button type="button" key={k} role="radio" aria-checked={a.platform === k} className={a.platform === k ? "on" : ""} onClick={() => set({ platform: k })}>
                <BrandIcon platform={k} size={18} />
                <b>{FEEDS[k].label}</b>
                <span>{FEEDS[k].what}</span>
              </button>
            ))}
          </div>
          </>}
        </>
      )}
      {lock && (
        <p className="platag"><BrandIcon platform={a.platform} size={16} /><b>{platformName(a)}</b><span>{feed ? "Gelen kaynağı" : "Paylaşım hesabı"}</span></p>
      )}
      {feed ? (
        <>
          <label className="fld">
            <span>{FEEDS[a.platform as Feed].field}</span>
            <input autoFocus={autoFocus} value={a.handle} onChange={(e) => set({ handle: e.target.value })} placeholder={FEEDS[a.platform as Feed].hint} autoCapitalize="off" spellCheck={false} />
          </label>
          <label className="fld">
            <span>Ad <em>isteğe bağlı</em></span>
            <input value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ör. İş maili" />
          </label>
          <p className="muted accsoon">Okuma bağlantısı henüz kurulmadı. Kurulunca bu hesaptan gelenler bu dünyanın Defter'ine düşer, sen projeye atarsın.</p>
        </>
      ) : (
        <>
          <label className="fld">
            <span>{a.platform === "other" ? "Nerede paylaşılacak" : "Görünen ad"}</span>
            <input autoFocus={autoFocus} value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder={a.platform === "other" ? "Ör. Bülten, blog" : "Ör. Şirket hesabı"} />
          </label>
          {a.platform !== "other" && (
            <label className="fld">
              <span>Kullanıcı adı</span>
              <input value={a.handle} onChange={(e) => set({ handle: e.target.value })} placeholder="@kullaniciadi" autoCapitalize="off" spellCheck={false} />
            </label>
          )}
          {a.platform === "x" && (
            <div className="fld">
              <span>Hesap</span>
              <div className="seg" role="radiogroup" aria-label="X hesabı">
                <button type="button" role="radio" aria-checked={!a.premium} className={!a.premium ? "on" : ""} onClick={() => set({ premium: false })}>Standart · 280</button>
                <button type="button" role="radio" aria-checked={!!a.premium} className={a.premium ? "on" : ""} onClick={() => set({ premium: true })}>Premium · uzun</button>
              </div>
            </div>
          )}
          <div className="fld">
            <span>Dil</span>
            <div className="seg" role="radiogroup" aria-label="Dil">
              {LANGS.map((l) => (
                <button key={l.id} type="button" role="radio" aria-checked={(a.lang ?? "tr") === l.id} className={(a.lang ?? "tr") === l.id ? "on" : ""} onClick={() => set({ lang: l.id })}>{l.label}</button>
              ))}
            </div>
          </div>
          <label className="fld">
            <span>Tarz <em>isteğe bağlı</em></span>
            <textarea rows={2} value={a.voice} onChange={(e) => set({ voice: e.target.value })} placeholder="Nasıl konuşur, neyi asla yazmaz. Uzun rehberi projenin Bilgi kartına ekle." />
          </label>
        </>
      )}
    </div>
  );
}

type Group = "post" | "feed";
// pickWorld: dünya pencerede seçilir (Defter tüm dünyalardayken).
type Req = { worldId: string; id?: string; projectId?: string; platform?: Kind; group?: Group; pickWorld?: boolean };
export const openAccountForm = (r: Req) => dispatchEvent(new CustomEvent("pg-account-form", { detail: r }));

export function AccountFormHost({ ctx }: { ctx: Ctx }) {
  const [req, setReq] = useState<Req | null>(null);
  useEffect(() => {
    const h = (e: Event) => setReq((e as CustomEvent<Req>).detail);
    addEventListener("pg-account-form", h);
    return () => removeEventListener("pg-account-form", h);
  }, []);
  if (!req) return null;
  return <AccountForm key={JSON.stringify(req)} ctx={ctx} req={req} onClose={() => setReq(null)} />;
}

function AccountForm({ ctx, req, onClose }: { ctx: Ctx; req: Req; onClose: () => void }) {
  const s = ctx.state;
  const home = req.id ? worldOfAccount(s.worlds, req.id) : undefined;
  const [wid, setWid] = useState(home?.id ?? req.worldId);
  const world = home || s.worlds.find((w) => w.id === wid);
  const old = world?.accounts?.find((x) => x.id === req.id);
  const project = req.projectId ? s.projects.find((p) => p.id === req.projectId) : undefined;
  const [a, setA] = useState<AccountDraft>(() => (old ? { platform: old.platform, name: old.name, handle: old.handle, voice: old.voice, lang: old.lang, login: old.login ?? "", premium: old.premium } : emptyAccount(req.platform ?? (req.group === "feed" ? "gmail" : undefined))));
  const [confirm, setConfirm] = useState(false);
  // Projeler: hesabın dünyasındaki projelerden bu hesapla paylaşanlar (project.accountIds). Kaydedince yazılır.
  const [pids, setPids] = useState<string[]>(() => (old ? projectsOfAccount(s, old.id).map((p) => p.id) : project ? [project.id] : []));
  const wprojects = s.projects.filter((p) => p.worldId === wid && (p.status !== "done" || pids.includes(p.id)));
  useEffect(() => {
    // Yakalama aşamasında dinler ve olayı durdurur: Esc yalnız bu pencereyi kapatır, altındaki iş kartını değil.
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  }, [onClose]);
  const saving = useRef(false);
  if (!world) return null;
  const save = async () => {
    // Kayıt sürerken ikinci Enter aynı hesabı ikinci kez eklemesin.
    if (saving.current) return;
    saving.current = true;
    try { await saveOnce(); } finally { saving.current = false; }
  };
  const saveOnce = async () => {
    const next: AccountDraft = { ...a, name: a.name.trim(), handle: cleanHandle(a), voice: isFeed(a.platform) ? "" : a.voice.trim(), login: (a.login ?? "").trim() };
    if (!next.login) delete next.login;
    const id = old?.id ?? uid();
    // Seçilen projelere ekle, seçimi kaldırılanlardan çıkar (yalnız hesabın varacağı dünyanın projeleri).
    const link = (st: typeof s) => {
      for (const p of st.projects) {
        if (p.worldId !== wid) continue;
        const has = p.accountIds?.includes(id) ?? false;
        const want = pids.includes(p.id);
        if (want && !has) p.accountIds = [...(p.accountIds ?? []), id];
        if (!want && has) p.accountIds = p.accountIds!.filter((y) => y !== id);
      }
    };
    if (old) {
      ctx.mutate((st) => {
        const from = st.worlds.find((w) => w.id === world.id);
        const x = from?.accounts?.find((y) => y.id === old.id);
        if (!from || !x) return;
        Object.assign(x, next);
        if (!next.login) delete x.login;
        // Başka dünyaya taşındı: eski dünyanın projelerinden çıkar.
        const to = wid !== world.id && st.worlds.find((w) => w.id === wid);
        if (to) {
          from.accounts = from.accounts!.filter((y) => y.id !== x.id);
          (to.accounts ??= []).push(x);
          for (const p of st.projects) if (p.worldId === from.id && p.accountIds?.includes(x.id)) p.accountIds = p.accountIds.filter((y) => y !== x.id);
        }
        link(st);
      });
      toast("Hesap güncellendi");
    } else {
      ctx.mutate((st) => {
        const w = st.worlds.find((x) => x.id === world.id);
        if (!w) return;
        (w.accounts ??= []).push({ id, ...next });
        link(st);
      });
      toast(isFeed(next.platform) ? `${platformName(next)} eklendi. Defter'de Gelenler altında görünür.` : `Hesap eklendi: ${accountLine(next)}`);
    }
    onClose();
  };
  const remove = () => {
    if (!old) return;
    binIt(ctx, "account", accountLine(old), { account: { worldId: world.id, acc: old, projectIds: projectsOfAccount(s, old.id).map((p) => p.id) } }, (st) => {
      const w = st.worlds.find((x) => x.id === world.id);
      if (w?.accounts) w.accounts = w.accounts.filter((x) => x.id !== old.id);
      for (const p of st.projects) if (p.accountIds?.includes(old.id)) p.accountIds = p.accountIds.filter((x) => x !== old.id);
    }, "Hesap kaldırıldı");
    onClose();
  };
  const used = s.automations.filter((x) => x.accountId === old?.id).length;
  const live = old && world.accounts?.find((x) => x.id === old.id);
  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.form className="modal accform" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} onSubmit={(e) => (e.preventDefault(), save())}>
        <div className="afhead">
          <div>
            <h2 className="mtitle">{old ? "Hesabı düzenle" : "Hesap ekle"}</h2>
            <p className="muted msub">{world.name} dünyasının hesabı{project ? `, ${project.name} projesinde kullanılır` : ""}.</p>
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
        </div>
        {(req.pickWorld || old) && (
          <div className="fld">
            <span>Dünya</span>
            <Select className="selfield" label="Dünya" value={wid} onChange={setWid} groups={[{ options: s.worlds.map((w) => ({ value: w.id, label: w.name, color: w.color })) }]}>
              <i className="soptdot" style={{ ["--w" as string]: s.worlds.find((w) => w.id === wid)?.color }} />{s.worlds.find((w) => w.id === wid)?.name}
            </Select>
          </div>
        )}
        <AccountFields a={a} set={(p) => setA((x) => ({ ...x, ...p }))} lock={!!old} group={req.group} />
        {wprojects.length > 0 && (
          <div className="fld">
            <span>Projeler <em>{isFeed(a.platform) ? "gelenler bu projelere önerilir" : "bu hesapla paylaşan projeler"}</em></span>
            <div className="pfaccs">
              {wprojects.map((p) => (
                <button type="button" key={p.id} className={`accchip pick ${pids.includes(p.id) ? "on" : ""}`} aria-pressed={pids.includes(p.id)} onClick={() => setPids((l) => (l.includes(p.id) ? l.filter((x) => x !== p.id) : [...l, p.id]))}>{p.name}</button>
              ))}
            </div>
          </div>
        )}
        <div className="logbox">
          <p className="accgroup"><KeyRound size={14} />Giriş <span>Yalnız gösterim için; şifre saklanmaz</span></p>
          <div className="logrow">
            <label className="fld">
              <span>E-posta ya da kullanıcı adı</span>
              <input value={a.login ?? ""} onChange={(e) => setA((x) => ({ ...x, login: e.target.value }))} placeholder="ornek@gmail.com" autoCapitalize="off" spellCheck={false} autoComplete="off" />
            </label>
          </div>
        </div>
        {live && (PUBLISHABLE.has(live.platform) || live.platform === "other") && <BrowserLink ctx={ctx} acc={live} />}
        {confirm ? (
          <div className="wdel">
            <p><b>{accountLine(a)}</b> kaldırılsın mı?{used ? ` Bu hesabı kullanan ${used} otomasyon düz metin hazırlamaya döner.` : ""}</p>
            <div className="foot"><span /><button type="button" className="btn" onClick={() => setConfirm(false)}>Vazgeç</button><button type="button" className="btn dangerfill" onClick={remove}>Evet, kaldır</button></div>
          </div>
        ) : (
          <div className="foot">
            {old && <button type="button" className="btn danger" onClick={() => setConfirm(true)}>Kaldır</button>}
            <span />
            <button type="button" className="btn" onClick={onClose}>Vazgeç</button>
            <button className="btn primary">{old ? "Kaydet" : "Hesabı ekle"}</button>
          </div>
        )}
      </motion.form>
    </div>
  );
}

// Hesabın paylaşım yeri: Playgrounds'un kendi tarayıcısı, hesabın dünyasının oturumu. Rou (ya da sen) orada paylaşır.
// Giriş durumu tarayıcının çerezlerinden okunur (/api/pb); giriş yoksa sekme orada açılır.
function BrowserLink({ ctx, acc }: { ctx: Ctx; acc: Account }) {
  const world = worldOfAccount(ctx.state.worlds, acc.id);
  const [login, setLogin] = useState<boolean | null | undefined>(undefined);
  useEffect(() => {
    let on = true;
    fetch("/api/pb").then((r) => r.json()).then((x) => { if (on) setLogin(x.profiles?.find((p: { worldId: string }) => p.worldId === world?.id)?.accounts?.[acc.id] ?? null); }).catch(() => on && setLogin(null));
    return () => { on = false; };
  }, [acc.id, world?.id]);
  const post = (url: string, body: object) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: "Sunucuya ulaşılamadı" }));
  const open = async (asLogin: boolean) => { const r = await post("/api/pb/open", { accountId: acc.id, login: asLogin }); if (!r.ok) toast(r.error ?? "Açılamadı"); };
  return (
    <div className="brlink">
      <div className="brhead">
        <Globe size={15} />
        <b>Paylaşım yeri</b>
      </div>
      <div className={`brstate ${login === true ? "is-ok" : login === false ? "is-bad" : ""}`}>
        <span>
          {login === undefined ? "Giriş durumuna bakılıyor…"
            : login === true ? `Playgrounds tarayıcısında, ${world?.name ?? ""} oturumunda ${platformName(acc)} girişi açık.`
            : login === false ? `${world?.name ?? ""} oturumunda ${platformName(acc)} girişi yok. Paylaşım için bir kez giriş yap.`
            : `Paylaşım Playgrounds tarayıcısında, ${world?.name ?? ""} oturumunda yapılır.`}
        </span>
        {login !== true && login !== undefined && <button type="button" className="btn sm" onClick={() => open(login === false)}>{login === false ? "Giriş yap" : "Tarayıcıda aç"}</button>}
      </div>
    </div>
  );
}

// Hesap kartında yalnız hesabın kendi bilgisi. Kimin paylaşacağı hesabın değil, işin ve otomasyonun ayarıdır (Paylaşan: Rou / Sen).
export function accountState(a: Account) {
  if (isFeed(a.platform)) return { ok: false, text: "Okuma bağlantısı yakında" };
  return null;
}

export function AccountTile({ ctx, a, world, tags, children }: { ctx: Ctx; a: Account; world: World; tags?: string[]; children?: React.ReactNode }) {
  const st = accountState(a);
  return (
    <li className="accitem">
      <button className="acchead" onClick={() => openAccountForm({ worldId: world.id, id: a.id })} title="Hesabı düzenle">
        <span className="accico" title={platformName(a)}><BrandIcon platform={a.platform} size={18} /></span>
        <span className="accid">
          <b>{a.platform === "other" ? a.name || platformName(a) : a.name || a.handle || world.name}</b>
          <span>{a.handle && a.name ? a.handle : platformName(a)}</span>
        </span>
        <span className="accedit" aria-hidden><Pencil size={14} /></span>
      </button>
      <div className="accmeta">
        {st && <span className={`accst ${st.ok ? "is-ok" : ""}`}><i />{st.text}</span>}
        {a.login && <span className="acctag" title={`Giriş: ${a.login}`}><KeyRound size={12} />Giriş kayıtlı</span>}
        {tags?.map((x) => <span key={x} className="acctag"><Folder size={12} />{x}</span>)}
        {tags && !tags.length && <span className="acctag is-none"><Folder size={12} />{isFeed(a.platform) ? "Gelenler Defter'e düşer" : "Projede değil"}</span>}
      </div>
      {children}
    </li>
  );
}

// Profilde: tüm dünyaların hesapları tek listede. Satır hesabın formunu açar (giriş e-postası, dünya).
// Profil › Hesaplar: bütün hesaplar dünyaya göre gruplu. Satırda yalnız gerçek durum: tarayıcıda giriş açık mı.
// Giriş durumu Playgrounds tarayıcısının çerezlerinden (/api/pb); bilinmiyorsa hiçbir şey yazılmaz.
export function AllAccounts({ ctx }: { ctx: Ctx }) {
  const s = ctx.state;
  const worlds = s.worlds.filter((w) => w.accounts?.length);
  const n = worlds.reduce((k, w) => k + (w.accounts?.length ?? 0), 0);
  const [logins, setLogins] = useState<Record<string, boolean | null>>({});
  useEffect(() => {
    let on = true;
    fetch("/api/pb").then((r) => r.json()).then((x) => { if (on) setLogins(Object.assign({}, ...(x.profiles ?? []).map((p: { accounts: Record<string, boolean | null> }) => p.accounts))); }).catch(() => {});
    return () => { on = false; };
  }, []);
  return (
    <section className="card allacc">
      <div className="sechead"><h2>Hesaplar</h2><span className="n">{n || ""}</span></div>
      {n === 0 && <p className="muted proempty">Instagram, LinkedIn, X: paylaşım yaptığın hesaplar burada toplanır.</p>}
      {worlds.map((w) => (
        <div key={w.id} className="aagroup">
          <h3 className="aaworld"><Orb world={w} size={18} />{w.name}<span className="n">{w.accounts!.length}</span></h3>
          <ul className="aalist">
            {w.accounts!.map((a) => {
              const lg = logins[a.id];
              return (
                <li key={a.id}>
                  <button onClick={() => openAccountForm({ worldId: w.id, id: a.id })}>
                    <span className="accico" title={platformName(a)}><BrandIcon platform={a.platform} size={16} /></span>
                    <span className="aaid"><b>{a.name || a.handle || platformName(a)}</b><span>{a.handle && a.name ? a.handle : platformName(a)}</span></span>
                    <span className="aatags">
                      {lg === true && <span className="aatag is-ok"><i />Giriş açık</span>}
                      {lg === false && <span className="aatag"><i />Giriş yok</span>}
                    </span>
                    <Pencil size={14} className="aaedit" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {s.worlds.length > 0 && <div className="stadd"><AddRow label="Hesap ekle" onClick={() => openAccountForm({ worldId: s.worlds[0].id, pickWorld: true })} /></div>}
    </section>
  );
}
