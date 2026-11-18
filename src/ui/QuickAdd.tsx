import { useEffect, useMemo, useState } from "react";
import type { Task } from "../types";
import { type Ctx, ALL, addParsed, dflt, parseQuick, projectOf, worldOf } from "../lib";
import { dur, fromMin, relDay } from "../date";
import { Plus } from "lucide-react";
import { Select, projectGroups } from "./Select";

// Add a task on one line. While typing, what was understood is shown below.
export function QuickAdd({ ctx, preset = {}, placeholder = "Add task", big }: { ctx: Ctx; preset?: Partial<Task>; placeholder?: string; big?: boolean }) {
  const [v, setV] = useState("");
  const [focus, setFocus] = useState(false);
  const lensWorld = preset.worldId ?? dflt(ctx.route.lens, ctx.state);
  // Project picker: "projectId" or "none:<worldId>". A #project / @world in the text overrides it.
  const [pick, setPick] = useState(`none:${lensWorld}`);
  useEffect(() => setPick(`none:${lensWorld}`), [lensWorld]);
  const pickedProject = pick.startsWith("none:") ? null : projectOf(ctx.state, pick);
  const fallback = pickedProject?.worldId ?? (pick.startsWith("none:") ? pick.slice(5) : lensWorld);
  const showPicker = !preset.projectId;
  const parse = (st: typeof ctx.state, text: string) => {
    const r = parseQuick(st, text, fallback);
    if (showPicker && r.worldId === fallback && !r.projectId && !r.newProject && pickedProject) r.projectId = pickedProject.id;
    return r;
  };
  const p = useMemo(() => (v.trim() ? parse(ctx.state, v) : null), [v, ctx.state, fallback, pick]);
  const w = p ? worldOf(ctx.state, p.worldId) : undefined;
  const pr = p ? (p.newProject ? `${p.newProject} (new)` : projectOf(ctx.state, p.projectId ?? preset.projectId ?? null)?.name) : undefined;
  const day = p ? (p.day !== undefined ? p.day : p.time !== undefined ? "today" : preset.day) : undefined;
  return (
    <form
      className={`quick ${big ? "big" : ""} ${focus ? "is-focus" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!p?.title) return;
        ctx.mutate((s) => void addParsed(s, parse(s, v), preset));
        setV("");
      }}
    >
      <div className="qrow">
        <span className="plus"><Plus size={16} /></span>
        <input value={v} onChange={(e) => setV(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} placeholder={placeholder} />
        {showPicker && (
          <Select className="qproj" style={{ ["--w" as string]: worldOf(ctx.state, fallback).color }} label="Project" value={pick} onChange={setPick}
            groups={projectGroups({ worlds: ctx.state.worlds.filter((w) => preset.worldId ? w.id === preset.worldId : ctx.route.lens === ALL || w.id === ctx.route.lens), projects: ctx.state.projects.filter((x) => x.status === "active") })}>
            <i />
            <span>{pickedProject ? pickedProject.name : "No project"}</span>
          </Select>
        )}
      </div>
      {focus && (
        <div className="qhint">
          {p?.title ? (
            <>
              <span className="tag world" style={{ ["--w" as string]: w!.color }}><i />{w!.name}</span>
              {pr && <span className="tag">{pr}</span>}
              <span className="tag">{day === null || day === undefined ? "Someday" : day === "today" ? "Today" : relDay(day)}</span>
              {p.time !== undefined && <span className="tag">{fromMin(p.time)}</span>}
              {p.estimate && <span className="tag">{dur(p.estimate)}</span>}
              {p.deadline && <span className="tag dl">⚑ {relDay(p.deadline)}</span>}
              <span className="k">Enter</span>
            </>
          ) : (
            <span className="muted">@world #project tomorrow 14:00 1h !fri</span>
          )}
        </div>
      )}
    </form>
  );
}

// The add row at the bottom of a card: same look as "Add task", left-aligned, stacked. In a card, adding happens only here.
export function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="addrow" onClick={onClick}><span className="plus"><Plus size={16} /></span>{label}</button>;
}

// The first tile of a strip: the create actions. One action is a big "+" tile, several are stacked add rows.
export function AddTile({ items }: { items: { label: string; onClick: () => void }[] }) {
  if (items.length === 1) return <li className="addtile one"><button type="button" onClick={items[0].onClick}><span className="plus"><Plus size={18} /></span>{items[0].label}</button></li>;
  return <li className="addtile">{items.map((x) => <AddRow key={x.label} label={x.label} onClick={x.onClick} />)}</li>;
}
