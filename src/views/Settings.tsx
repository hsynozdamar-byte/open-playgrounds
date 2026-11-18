import { useState } from "react";
import { Bell, ChevronRight, Coffee, Download, FolderOpen, Globe, History, LogOut, Mail, MapPin, Sparkles, Timer, Trash2, User } from "lucide-react";
import type { Ctx } from "../lib";
import { BREAK_OPTS, breakLen, POMO_OPTS, pomoLen, setLens } from "../timer";
import { setStill } from "../ui/fluid/engine";
import { openTrash } from "../ui/Trash";
import { openBackups } from "../ui/Backups";
import { readMe, saveMe } from "./Profile";
import { AssistantSetting } from "../ui/AssistantSetting";

// Account and settings under Profile: only preferences that really exist in the app. Everything is stored on this computer.
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
    // The name is used in Rou's prompts too (the server reads state.settings.userName).
    if (k === "name") ctx.mutate((st) => { st.settings = { ...st.settings, userName: m.name || undefined }; });
  };
  const set = ctx.state.settings ?? {};
  // Where tasks live (Rou reads it when looking for real work) and folders Rou may read (one path per line).
  const saveHints = (v: string) => ctx.mutate((st) => { st.settings = { ...st.settings, workHints: v.trim() || undefined }; });
  const saveDirs = (v: string) => ctx.mutate((st) => { const dirs = v.split("\n").map((x) => x.trim()).filter(Boolean); st.settings = { ...st.settings, workDirs: dirs.length ? dirs : undefined }; });
  const lens = (f: number, b: number) => { setPomo(f); setBrk(b); setLens(ctx.mutate, f, b); };
  const motion = (v: boolean) => { setStillState(v); setStill(v); try { localStorage.setItem(STILL, v ? "1" : "0"); } catch { /* no storage */ } };
  const ask = () => { if ("Notification" in window) Notification.requestPermission().then(setPerm); };
  const exportData = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(ctx.state, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `playgrounds-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const logout = () => { try { sessionStorage.removeItem("pg-in"); } catch { /* no storage */ } dispatchEvent(new Event(LOGOUT)); };

  return (
    <section className="prosettings" aria-label="Settings">
      <div className="setcol">
        <div className="card setcard">
          <h2>Focus</h2>
          <div className="setrow"><Timer size={16} strokeWidth={1.9} /><span>Pomodoro</span>
            <div className="seg sm" role="radiogroup" aria-label="Pomodoro length, minutes">{POMO_OPTS.map((m) => <button key={m} role="radio" aria-checked={pomo === m} className={pomo === m ? "on" : ""} onClick={() => lens(m, brk)}>{m}</button>)}</div>
          </div>
          <div className="setrow"><Coffee size={16} strokeWidth={1.9} /><span>Break</span>
            <div className="seg sm" role="radiogroup" aria-label="Break length, minutes">{BREAK_OPTS.map((m) => <button key={m} role="radio" aria-checked={brk === m} className={brk === m ? "on" : ""} onClick={() => lens(pomo, m)}>{m}</button>)}</div>
          </div>
          <div className="setrow"><Bell size={16} strokeWidth={1.9} /><span>Notifications</span>
            {perm === "granted" ? <em className="setval">On</em> : perm === "default" ? <button className="btn sm" onClick={ask}>Allow</button> : <em className="setval">Off</em>}
          </div>
          <label className="setrow"><Sparkles size={16} strokeWidth={1.9} /><span>Moving logos</span>
            <input type="checkbox" role="switch" className="setswitch" checked={!still} onChange={(e) => motion(!e.target.checked)} />
          </label>
        </div>
        <p className="setfoot">Lengths are in minutes. A running pomodoro updates right away.</p>
        <AssistantSetting ctx={ctx} />
      </div>

      <div className="setcol">
        <div className="card setcard">
          <h2>Data</h2>
          <button className="setrow" onClick={exportData}><Download size={16} strokeWidth={1.9} /><span>Export data</span><ChevronRight className="go" size={16} /></button>
          <button className="setrow" onClick={openBackups}><History size={16} strokeWidth={1.9} /><span>Backups</span><ChevronRight className="go" size={16} /></button>
          <button className="setrow" onClick={openTrash}><Trash2 size={16} strokeWidth={1.9} /><span>Trash</span>{!!ctx.state.trash?.length && <b className="n">{ctx.state.trash.length}</b>}<ChevronRight className="go" size={16} /></button>
          <label className="setrow settext"><MapPin size={16} strokeWidth={1.9} /><span>Where is my work?</span>
            <textarea className="setin" rows={3} key={`h${set.workHints ?? ""}`} defaultValue={set.workHints ?? ""} placeholder="E.g. my portfolio at example.com/work, videos in ~/Movies"
              onBlur={(e) => e.target.value.trim() !== (set.workHints ?? "") && saveHints(e.target.value)} />
          </label>
          <label className="setrow settext"><FolderOpen size={16} strokeWidth={1.9} /><span>Folders Rou can read</span>
            <textarea className="setin" rows={3} key={`d${(set.workDirs ?? []).join("|")}`} defaultValue={(set.workDirs ?? []).join("\n")} placeholder={"One folder per line, e.g.\n~/Movies/Project"}
              onBlur={(e) => e.target.value.split("\n").map((x) => x.trim()).filter(Boolean).join("\n") !== (set.workDirs ?? []).join("\n") && saveDirs(e.target.value)} />
          </label>
        </div>
        <p className="setfoot">Everything stays on this computer and is backed up every day. When Rou looks for your real work, it only reads the projects' Media folders and the folders listed here.</p>
      </div>

      <div className="setcol">
        <div className="card setcard">
          <h2>Account</h2>
          <label className="setrow"><User size={16} strokeWidth={1.9} /><span>Name</span>
            <input className="setin" key={`n${me.name}`} defaultValue={me.name} placeholder="Your name"
              onBlur={(e) => e.target.value.trim() !== me.name && field("name", e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
          </label>
          <label className="setrow"><Mail size={16} strokeWidth={1.9} /><span>Email</span>
            <input className="setin" type="email" key={`e${me.email}`} defaultValue={me.email} placeholder="Add"
              onBlur={(e) => e.target.value.trim() !== me.email && field("email", e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
          </label>
          {/* On mobile there is no Browser tab (seven pages do not fit); it opens from here. */}
          <button className="setrow" onClick={() => ctx.go({ view: "browser", project: undefined })}><Globe size={16} strokeWidth={1.9} /><span>Browser and sign-ins</span><ChevronRight className="go" size={16} /></button>
        </div>
        <div className="card setcard setout-card">
          <button className="setrow setout" onClick={logout}><LogOut size={16} strokeWidth={1.9} /><span>Sign out</span></button>
        </div>
        <p className="setfoot">Signing out keeps your data and opens the welcome screen.</p>
      </div>
    </section>
  );
}
