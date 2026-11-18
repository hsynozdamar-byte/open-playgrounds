import { useMemo, useState } from "react";
import type { Ctx } from "../lib";
import { ALL } from "../lib";
import { dayLong, dayShort, dur, today } from "../date";
import { profileStats } from "../profileStats";
import { Orb, Sphere } from "../ui/Orb";
import { Settings } from "./Settings";
import { AllAccounts } from "../ui/Social";

// Profil: kim olduğun (karşılamadaki girişten), son 7/30/90 günde ne yaptığın ve elindeki her şey.
// Her satır kendi sayfasına götürür: güne tıkla takvim, dünyaya tıkla dünya, projeye tıkla proje.
const PKEY = "pg-profile";
type Me = { name: string; email: string };
export const readMe = (): Me => {
  try { return { name: "", email: "", ...JSON.parse(localStorage.getItem(PKEY) || "{}") }; } catch { return { name: "", email: "" }; }
};
export const saveMe = (m: Partial<Me>) => { try { localStorage.setItem(PKEY, JSON.stringify({ ...readMe(), ...m })); } catch { /* yok */ } };

const PERIODS = [7, 30, 90] as const;
// Profil üç sekme: Özet (ne yaptın), Hesaplar (paylaşım ve giriş hesapları), Ayarlar. Seçili sekme hatırlanır.
type Tab = "summary" | "accounts" | "settings";
const TABS: { id: Tab; label: string }[] = [{ id: "summary", label: "Özet" }, { id: "accounts", label: "Hesaplar" }, { id: "settings", label: "Ayarlar" }];
const TKEY = "pg-profile-tab";
const readTab = (): Tab => { try { const t = localStorage.getItem(TKEY); return t === "accounts" || t === "settings" ? t : "summary"; } catch { return "summary"; } };

export function Profile({ ctx }: { ctx: Ctx }) {
  const s = ctx.state;
  const [days, setDays] = useState<number>(30);
  const [me, setMe] = useState(readMe);
  const [editing, setEditing] = useState(false);
  const [tab, setTabState] = useState<Tab>(readTab);
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem(TKEY, t); } catch { /* yok */ } };
  const st = useMemo(() => profileStats(s, days), [s, days]);
  const raw = me.name || (me.email ? me.email.split("@")[0] : "Sen");
  const name = raw.charAt(0).toLocaleUpperCase("tr") + raw.slice(1);
  const maxDay = Math.max(1, ...st.chart.map((c) => c.min));
  const maxHour = Math.max(1, ...st.perHour);
  const maxWorld = Math.max(1, ...st.worlds.map((x) => x.min));
  const rename = (v: string) => { const m = { ...me, name: v.trim() }; setMe(m); saveMe(m); setEditing(false); };
  const go = ctx.go;

  return (
    <div className="profile">
      <header className="card prohead">
        <Sphere size="72px" className="proavatar" />
        <div className="proid">
          {editing ? (
            <input className="proname-in" autoFocus defaultValue={me.name} placeholder={name} aria-label="Adın"
              onBlur={(e) => rename(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") rename(e.currentTarget.value); if (e.key === "Escape") setEditing(false); }} />
          ) : (
            <h1><button className="proname" onClick={() => setEditing(true)} title="Adını değiştir">{name}</button></h1>
          )}
          <p className="sub">{[me.email, st.since ? `${dayLong(st.since)}'den beri, ${st.sinceDays} gün` : null].filter(Boolean).join(". ")}</p>
        </div>
        <div className="seg protabs" role="tablist" aria-label="Profil">
          {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </div>
      </header>

      {tab === "accounts" && <AllAccounts ctx={ctx} />}
      {tab === "settings" && <Settings ctx={ctx} onRename={() => setMe(readMe())} />}
      {tab === "summary" && <>
      <section className="card prochart">
        <div className="sechead">
          <h2>Son {days} gün</h2>
          <div className="seg sm" role="radiogroup" aria-label="Dönem">
            {PERIODS.map((d) => <button key={d} role="radio" aria-checked={days === d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{d} gün</button>)}
          </div>
        </div>
        <div className="prostats">
          <Stat big={st.focus ? dur(st.focus) : "0 dk"} label="Odak süresi" note={`${st.activeDays} günde`} />
          <Stat big={String(st.done)} label="Biten görev" note={st.done ? `günde ${(st.done / days).toFixed(1)}` : "henüz yok"} />
          <Stat big={`${st.streak} gün`} label="Seri" note={st.streak ? "üst üste çalıştın" : "bugün başla"} />
          <Stat big={st.onTime == null ? "–" : `%${st.onTime}`} label="Zamanında" note="deadline'ı olan görevlerde" />
        </div>
        {!st.focus ? (
          // Boşken grafiğin yeri korunur: silik örnek çubuklar + ortada kısa açıklama ve tek ana düğme
          <div className="prochart-empty">
            <div className={`bars d${days} is-ghost`} aria-hidden>
              {st.chart.map((c, i) => <span key={c.day} className="bar"><i style={{ height: `${18 + ((i * 37) % 61)}%` }} /></span>)}
            </div>
            <div className="prochart-cta">
              <p>Sayacı başlat, odak süren burada gün gün birikir.</p>
              <button className="btn sm" onClick={() => go({ view: "focus", lens: ALL })}>Sayacı başlat</button>
            </div>
          </div>
        ) : <div className={`bars d${days}`}>
          {st.chart.map((c) => (
            <button key={c.day} className={`bar ${c.day === today() ? "is-today" : ""}`} onClick={() => go({ view: "calendar", lens: ALL })}
              title={`${dayLong(c.day)}: ${c.min ? dur(c.min) : "çalışılmadı"}`} aria-label={`${dayLong(c.day)}, ${c.min ? dur(c.min) : "çalışılmadı"}`}>
              <i style={{ height: `${c.min ? Math.max(4, (c.min / maxDay) * 100) : 0}%` }} />
              {days === 7 && <span>{dayShort(c.day)}</span>}
            </button>
          ))}
        </div>}
      </section>

      <div className="procols">
        <section className="card prolist">
          <div className="sechead"><h2>Dünyalar</h2></div>
          {st.worlds.map(({ w, min, done, open }) => (
            <button key={w.id} className="prorow" onClick={() => go({ lens: w.id, view: "projects", project: undefined })}>
              <Orb world={w} size={22} />
              <span className="prn">{w.name}</span>
              <span className="prbar"><i style={{ width: `${(min / maxWorld) * 100}%`, background: w.color }} /></span>
              <span className="prv">{min ? dur(min) : "–"}</span>
              <span className="prm">{done} bitti, {open} açık</span>
            </button>
          ))}
        </section>
        <section className="card prolist">
          <div className="sechead"><h2>En çok çalıştığın projeler</h2></div>
          {st.projects.length ? st.projects.map(({ p, min, done }) => {
            const w = s.worlds.find((x) => x.id === p.worldId);
            return (
              <button key={p.id} className="prorow noBar" onClick={() => go({ lens: p.worldId, view: "projects", project: p.id })}>
                {w ? <Orb world={w} size={22} /> : <span />}
                <span className="prn">{p.name}</span>
                <span className="prv">{min ? dur(min) : "–"}</span>
                <span className="prm">{done} görev bitti</span>
              </button>
            );
          }) : <p className="muted proempty">Bu dönemde projelerde çalışılmadı.</p>}
        </section>
      </div>

      {st.peak != null && (
        <section className="card prohours">
          <div className="sechead"><h2>Saatler</h2></div>
          <p className="sub">En çok {String(st.peak).padStart(2, "0")}:00 ile {String((st.peak + 1) % 24).padStart(2, "0")}:00 arasında odaklanıyorsun.</p>
          <div className="hours">
            {st.perHour.map((m, h) => <i key={h} className={h === st.peak ? "is-peak" : ""} style={{ height: `${m ? Math.max(6, (m / maxHour) * 100) : 3}%` }} title={`${String(h).padStart(2, "0")}:00 · ${dur(m)}`} />)}
          </div>
          <div className="hourlbl"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
        </section>
      )}
      </>}
    </div>
  );
}

function Stat({ big, label, note }: { big: string; label: string; note: string }) {
  return (
    <div className="prostat">
      <b>{big}</b>
      <span className="l">{label}</span>
      <span className="m">{note}</span>
    </div>
  );
}
