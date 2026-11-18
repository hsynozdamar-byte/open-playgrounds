import { useState } from "react";
import { Bell, ChevronRight, Coffee, Download, FolderOpen, Globe, History, LogOut, Mail, MapPin, Sparkles, Timer, Trash2, User } from "lucide-react";
import type { Ctx } from "../lib";
import { BREAK_OPTS, breakLen, POMO_OPTS, pomoLen, setLens } from "../timer";
import { setStill } from "../ui/fluid/engine";
import { openTrash } from "../ui/Trash";
import { openBackups } from "../ui/Backups";
import { readMe, saveMe } from "./Profile";

// Profilin altındaki hesap ve ayarlar: yalnız uygulamada gerçekten olan tercihler. Her şey bu bilgisayarda saklanır.
const STILL = "pg-still";
export const stillPref = () => { try { return localStorage.getItem(STILL) === "1"; } catch { return false; } };
export const LOGOUT = "pg-logout";

export function Settings({ ctx, onRename }: { ctx: Ctx; onRename: () => void }) {
  const [me, setMe] = useState(readMe);
  const [pomo, setPomo] = useState(pomoLen);
  const [brk, setBrk] = useState(breakLen);
  const [still, setStillState] = useState(stillPref);
  const [perm, setPerm] = useState(() => ("Notification" in window ? Notification.permission : "denied"));

  const field = (k: "name" | "email", v: string) => {
    const m = { ...me, [k]: v.trim() }; setMe(m); saveMe(m); onRename();
    // Ad, Rou'nun istemlerinde de kullanılır (sunucu state.settings.userName okur).
    if (k === "name") ctx.mutate((st) => { st.settings = { ...st.settings, userName: m.name || undefined }; });
  };
  const set = ctx.state.settings ?? {};
  // İşlerin nerede durduğu (Rou gerçek işi ararken okur) ve Rou'nun okuyabileceği klasörler (satır başına bir yol).
  const saveHints = (v: string) => ctx.mutate((st) => { st.settings = { ...st.settings, workHints: v.trim() || undefined }; });
  const saveDirs = (v: string) => ctx.mutate((st) => { const dirs = v.split("\n").map((x) => x.trim()).filter(Boolean); st.settings = { ...st.settings, workDirs: dirs.length ? dirs : undefined }; });
  const lens = (f: number, b: number) => { setPomo(f); setBrk(b); setLens(ctx.mutate, f, b); };
  const motion = (v: boolean) => { setStillState(v); setStill(v); try { localStorage.setItem(STILL, v ? "1" : "0"); } catch { /* yok */ } };
  const ask = () => { if ("Notification" in window) Notification.requestPermission().then(setPerm); };
  const exportData = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(ctx.state, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `playgrounds-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const logout = () => { try { sessionStorage.removeItem("pg-in"); } catch { /* yok */ } dispatchEvent(new Event(LOGOUT)); };

  return (
    <section className="prosettings" aria-label="Ayarlar">
      <div className="setcol">
        <div className="card setcard">
          <h2>Odak</h2>
          <div className="setrow"><Timer size={16} strokeWidth={1.9} /><span>Pomodoro</span>
            <div className="seg sm" role="radiogroup" aria-label="Pomodoro süresi, dakika">{POMO_OPTS.map((m) => <button key={m} role="radio" aria-checked={pomo === m} className={pomo === m ? "on" : ""} onClick={() => lens(m, brk)}>{m}</button>)}</div>
          </div>
          <div className="setrow"><Coffee size={16} strokeWidth={1.9} /><span>Mola</span>
            <div className="seg sm" role="radiogroup" aria-label="Mola süresi, dakika">{BREAK_OPTS.map((m) => <button key={m} role="radio" aria-checked={brk === m} className={brk === m ? "on" : ""} onClick={() => lens(pomo, m)}>{m}</button>)}</div>
          </div>
          <div className="setrow"><Bell size={16} strokeWidth={1.9} /><span>Bildirimler</span>
            {perm === "granted" ? <em className="setval">Açık</em> : perm === "default" ? <button className="btn sm" onClick={ask}>İzin ver</button> : <em className="setval">Kapalı</em>}
          </div>
          <label className="setrow"><Sparkles size={16} strokeWidth={1.9} /><span>Hareketli logolar</span>
            <input type="checkbox" role="switch" className="setswitch" checked={!still} onChange={(e) => motion(!e.target.checked)} />
          </label>
        </div>
        <p className="setfoot">Süreler dakika. Çalışan bir pomodoro hemen güncellenir.</p>
      </div>

      <div className="setcol">
        <div className="card setcard">
          <h2>Veri</h2>
          <button className="setrow" onClick={exportData}><Download size={16} strokeWidth={1.9} /><span>Verileri dışa aktar</span><ChevronRight className="go" size={16} /></button>
          <button className="setrow" onClick={openBackups}><History size={16} strokeWidth={1.9} /><span>Yedekler</span><ChevronRight className="go" size={16} /></button>
          <button className="setrow" onClick={openTrash}><Trash2 size={16} strokeWidth={1.9} /><span>Çöp Kutusu</span>{!!ctx.state.trash?.length && <b className="n">{ctx.state.trash.length}</b>}<ChevronRight className="go" size={16} /></button>
          <label className="setrow settext"><MapPin size={16} strokeWidth={1.9} /><span>İşlerim nerede?</span>
            <textarea className="setin" rows={3} key={`h${set.workHints ?? ""}`} defaultValue={set.workHints ?? ""} placeholder="Ör. portfolyo sitem example.com/work, videolar ~/Videolar"
              onBlur={(e) => e.target.value.trim() !== (set.workHints ?? "") && saveHints(e.target.value)} />
          </label>
          <label className="setrow settext"><FolderOpen size={16} strokeWidth={1.9} /><span>Rou'nun okuyabileceği klasörler</span>
            <textarea className="setin" rows={3} key={`d${(set.workDirs ?? []).join("|")}`} defaultValue={(set.workDirs ?? []).join("\n")} placeholder={"Her satıra bir klasör, ör.\n~/Videolar/Proje"}
              onBlur={(e) => e.target.value.split("\n").map((x) => x.trim()).filter(Boolean).join("\n") !== (set.workDirs ?? []).join("\n") && saveDirs(e.target.value)} />
          </label>
        </div>
        <p className="setfoot">Her şey bu bilgisayarda saklanır, her gün yedeklenir. Rou gerçek işini ararken yalnız projelerin Medya klasörlerine ve buradaki klasörlere bakar.</p>
      </div>

      <div className="setcol">
        <div className="card setcard">
          <h2>Hesap</h2>
          <label className="setrow"><User size={16} strokeWidth={1.9} /><span>Ad</span>
            <input className="setin" key={`n${me.name}`} defaultValue={me.name} placeholder="Adın"
              onBlur={(e) => e.target.value.trim() !== me.name && field("name", e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
          </label>
          <label className="setrow"><Mail size={16} strokeWidth={1.9} /><span>E-posta</span>
            <input className="setin" type="email" key={`e${me.email}`} defaultValue={me.email} placeholder="Ekle"
              onBlur={(e) => e.target.value.trim() !== me.email && field("email", e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
          </label>
          {/* Mobilde Tarayıcı sekmesi yok (yedi sayfa sığmıyor); buradan açılır. */}
          <button className="setrow" onClick={() => ctx.go({ view: "browser", project: undefined })}><Globe size={16} strokeWidth={1.9} /><span>Tarayıcı ve oturumlar</span><ChevronRight className="go" size={16} /></button>
        </div>
        <div className="card setcard setout-card">
          <button className="setrow setout" onClick={logout}><LogOut size={16} strokeWidth={1.9} /><span>Çıkış yap</span></button>
        </div>
        <p className="setfoot">Çıkış yapınca verilerin silinmez, karşılama ekranı açılır.</p>
      </div>
    </section>
  );
}
