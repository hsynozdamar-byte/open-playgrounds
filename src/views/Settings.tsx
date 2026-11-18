import { useState } from "react";
import { Bell, Bot, ChevronRight, Coffee, Copy, Download, History, Sparkles, Timer, Trash2, User } from "lucide-react";
import type { Ctx } from "../lib";
import { BREAK_OPTS, breakLen, POMO_OPTS, pomoLen, setLens } from "../timer";
import { setStill } from "../ui/fluid/engine";
import { openTrash } from "../ui/Trash";
import { openBackups } from "../ui/Backups";
import { toast } from "../ui/Toast";
import { readMe, saveMe } from "./Profile";

// Settings under the profile: only preferences the app really has. Everything is stored on this computer.
const STILL = "pg-still";
export const stillPref = () => { try { return localStorage.getItem(STILL) === "1"; } catch { return false; } };

// What to say to an AI tool opened in this folder. It reads AGENTS.md and works through the `pg` command.
const AGENT_PROMPT = "Read AGENTS.md, then run `npm run pg -- list` and tell me what is on my plate today.";

export function Settings({ ctx, onRename }: { ctx: Ctx; onRename: () => void }) {
  const [me, setMe] = useState(readMe);
  const [pomo, setPomo] = useState(pomoLen);
  const [brk, setBrk] = useState(breakLen);
  const [still, setStillState] = useState(stillPref);
  const [perm, setPerm] = useState(() => ("Notification" in window ? Notification.permission : "denied"));

  const rename = (v: string) => { const m = { ...me, name: v.trim() }; setMe(m); saveMe(m); onRename(); };
  const lens = (f: number, b: number) => { setPomo(f); setBrk(b); setLens(ctx.mutate, f, b); };
  const motion = (v: boolean) => { setStillState(v); setStill(v); try { localStorage.setItem(STILL, v ? "1" : "0"); } catch { /* storage blocked */ } };
  const ask = () => { if ("Notification" in window) Notification.requestPermission().then(setPerm); };
  const exportData = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(ctx.state, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `playgrounds-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copyPrompt = () => navigator.clipboard?.writeText(AGENT_PROMPT).then(() => toast("Copied"), () => toast("Could not copy"));

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
      </div>

      <div className="setcol">
        <div className="card setcard">
          <h2>Data</h2>
          <button className="setrow" onClick={exportData}><Download size={16} strokeWidth={1.9} /><span>Export data</span><ChevronRight className="go" size={16} /></button>
          <button className="setrow" onClick={openBackups}><History size={16} strokeWidth={1.9} /><span>Backups</span><ChevronRight className="go" size={16} /></button>
          <button className="setrow" onClick={openTrash}><Trash2 size={16} strokeWidth={1.9} /><span>Trash</span>{!!ctx.state.trash?.length && <b className="n">{ctx.state.trash.length}</b>}<ChevronRight className="go" size={16} /></button>
        </div>
        <p className="setfoot">Everything stays on this computer and is backed up every day.</p>
      </div>

      <div className="setcol">
        <div className="card setcard">
          <h2>You</h2>
          <label className="setrow"><User size={16} strokeWidth={1.9} /><span>Name</span>
            <input className="setin" key={`n${me.name}`} defaultValue={me.name} placeholder="Your name"
              onBlur={(e) => e.target.value.trim() !== me.name && rename(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
          </label>
        </div>
        <div className="card setcard">
          <h2>AI tools</h2>
          <p className="setnote">Open this folder in Claude Code, Codex, Cursor or Gemini CLI. The tool reads <code>AGENTS.md</code> and works through the <code>pg</code> command; what it adds shows up here at once.</p>
          <button className="setrow" onClick={copyPrompt}><Bot size={16} strokeWidth={1.9} /><span>Copy a first prompt</span><Copy className="go" size={15} /></button>
        </div>
        <p className="setfoot">Tools write suggestions into the Notebook; you decide what becomes a task.</p>
      </div>
    </section>
  );
}
