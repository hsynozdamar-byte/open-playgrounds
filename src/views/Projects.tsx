import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { runOfTask } from "../runs";
import { ArrowUpRight, FolderKanban, ChevronLeft, ChevronRight, ListChecks, ListPlus, Plus, Send, MoreHorizontal, Repeat, Trash2 } from "lucide-react";
import type { Project, Task, TaskStatus, World } from "../types";
import { type Ctx, ALL, PSTATUS_LABEL, lateKind, newTask, STATUS_LABEL, secsOf, setStatus, worldOf } from "../lib";
import { openNew } from "../ui/Drawer";
import { relDay, today } from "../date";
import { spent } from "../timer";
import { uid } from "../store";
import { Orb } from "../ui/Orb";
import { AddRow, AddTile, QuickAdd } from "../ui/QuickAdd";
import { PageHead } from "../ui/PageHead";
import { TaskList, TaskRow } from "../ui/TaskRow";
import { ProjectBoard } from "../ui/ProjectBoard";
import { ProjectAutomations } from "../ui/ProjectAutomations";
import { ProjectAutos, doNow, whoOf } from "../ui/Auto";
import { BrandCard } from "../ui/Brand";
import { accountsOfProject, isFeed } from "../../shared/social.mjs";
import { openProjectForm } from "../ui/ProjectForm";
import { openAutoForm } from "../ui/AutoForm";
import { MediaCard } from "../ui/Media";
import { SourcesCard } from "../ui/Sources";
import { toast } from "../ui/Toast";
import { DatePick } from "../ui/DatePick";
import { moveProject, projectStats, removeProject, takeProject } from "../projectOps";
import { binIt } from "../trashOps";
import { Select } from "../ui/Select";
import { NewPost } from "./Studio";
import { addDays } from "../date";
import { autoOf, ghosts } from "../ui/Auto";

// Projects: if the lens is "All" all worlds, if a world then that world's projects; if a project is selected the project page.
export function Projects({ ctx }: { ctx: Ctx }) {
  const { state: s, route } = ctx;
  if (route.project) {
    const [kind, wid] = route.project.split(":");
    if (kind === "none") return <ProjectPage ctx={ctx} world={worldOf(s, wid)} />;
    const p = s.projects.find((x) => x.id === route.project);
    if (p) return <ProjectPage ctx={ctx} world={worldOf(s, p.worldId)} project={p} />;
  }
  const worlds = route.lens === ALL ? s.worlds : s.worlds.filter((w) => w.id === route.lens);
  const solo = route.lens === ALL ? null : worlds[0];
  return (
    <div className="projects">
      <PageHead
        ctx={ctx}
       
        title="Projects"
        sub={route.lens === ALL ? "Projects across all your worlds." : "This world's projects and tasks."}
      />
      {solo ? <WorldSection ctx={ctx} world={solo} solo /> : <AllWorlds ctx={ctx} />}
    </div>
  );
}

function WorldSection({ ctx, world, solo }: { ctx: Ctx; world: World; solo: boolean }) {
  const s = ctx.state;
  const all = s.projects.filter((p) => p.worldId === world.id);
  const projects = all.filter((p) => p.status === "active");
  const rest = all.filter((p) => p.status !== "active").sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0));
  const [showRest, setShowRest] = useState(false);
  const loose = s.tasks.filter((t) => t.worldId === world.id && !t.projectId && t.status !== "done");
  return (
    <section className={`wsec ${solo ? "solo" : ""}`} style={{ ["--w" as string]: world.color }}>
      {!solo && (
        <header className="whead">
          <button className="worb" onClick={() => ctx.go({ lens: world.id })} aria-label={world.name}>
            <Orb world={world} size={22} />
          </button>
          <div className="wtext">
            <button className="wname" onClick={() => ctx.go({ lens: world.id })}>{world.name}<span className="wcount">{projects.length ? `${projects.length} ${projects.length === 1 ? "project" : "projects"}` : "No projects"}</span></button>
            {world.description && <p className="wabout">{world.description}</p>}
          </div>
        </header>
      )}

      <section className="card wgroup">
      <div className="cardhead"><FolderKanban size={15} className="hicon" /><h3>Projects</h3><span className="n">{projects.length || ""}</span></div>
      <ul className="strip ptiles">
        <AddTile items={[{ label: "New project", onClick: () => openProjectForm({ worldId: world.id }) }]} />
        {projects.map((p) => <ProjectTile key={p.id} p={p} ctx={ctx} />)}
        {loose.length > 0 && (
          <li><button className="ptile2 loose" onClick={() => ctx.go({ lens: world.id, project: `none:${world.id}` })}>
            <b>Tasks without a project</b><span className="ptsub">{loose.length} open {loose.length === 1 ? "task" : "tasks"}</span>
          </button></li>
        )}
      </ul>
      </section>
      {rest.length > 0 && (
        <>
          <button className="foldbtn prest" onClick={() => setShowRest(!showRest)}>
            {showRest ? "Hide" : `Paused and done projects · ${rest.length}`}
          </button>
          {showRest && <ul className="strip ptiles">{rest.map((p) => <ProjectTile key={p.id} p={p} ctx={ctx} />)}</ul>}
        </>
      )}
    </section>
  );
}

// Worlds that have projects as cards; ones with no projects and no tasks are gathered in one line at the bottom so the list does not grow long.
function AllWorlds({ ctx }: { ctx: Ctx }) {
  const s = ctx.state;
  const has = (w: World) => s.projects.some((p) => p.worldId === w.id) || s.tasks.some((t) => t.worldId === w.id && !t.projectId && t.status !== "done");
  const full = s.worlds.filter(has);
  const empty = s.worlds.filter((w) => !has(w));
  return (
    <div className="wgroups">
      {full.map((w) => <WorldGroup key={w.id} ctx={ctx} world={w} />)}
      {empty.length > 0 && (
        <section className="card wempty">
          <p>Worlds without projects</p>
          <ul>
            {empty.map((w) => (
              <li key={w.id} style={{ ["--w" as string]: w.color }}>
                <button className="wechip" onClick={() => openProjectForm({ worldId: w.id })} title={`New project in ${w.name}`}>
                  <Orb world={w} size={16} /><span>{w.name}</span><b>+</b>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// All view: each world is a card, its projects are rows that sit in the same columns. An empty world is only a header row.
function WorldGroup({ ctx, world }: { ctx: Ctx; world: World }) {
  const s = ctx.state;
  const all = s.projects.filter((p) => p.worldId === world.id);
  const active = all.filter((p) => p.status === "active");
  const rest = all.filter((p) => p.status !== "active").sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0));
  const [showRest, setShowRest] = useState(false);
  const loose = s.tasks.filter((t) => t.worldId === world.id && !t.projectId && t.status !== "done").length;
  const rows = showRest ? [...active, ...rest] : active;
  return (
    <section className="card wgroup" style={{ ["--w" as string]: world.color }}>
      <header className="wghead">
        <button className="wgname" onClick={() => ctx.go({ lens: world.id })}>
          <Orb world={world} size={18} />
          <b>{world.name}</b>
          <span>{active.length ? `${active.length} active ${active.length === 1 ? "project" : "projects"}` : "No active projects"}</span>
        </button>
        {rest.length > 0 && <button className="link wgrest" onClick={() => setShowRest(!showRest)}>{showRest ? "Hide paused and done" : `Paused and done · ${rest.length}`}</button>}
      </header>
      {/* Projects are equal-size boxes, left to right; what does not fit slides sideways. The first box is a new project. */}
      <ul className="strip ptiles">
        <AddTile items={[{ label: "New project", onClick: () => openProjectForm({ worldId: world.id }) }]} />
        {rows.map((p) => <ProjectTile key={p.id} p={p} ctx={ctx} />)}
        {loose > 0 && (
          <li><button className="ptile2 loose" onClick={() => ctx.go({ lens: world.id, project: `none:${world.id}` })}>
            <b>Tasks without a project</b><span className="ptsub">{loose} open {loose === 1 ? "task" : "tasks"}</span>
          </button></li>
        )}
      </ul>
    </section>
  );
}

// Project box: name, status, what is running (automation/post or task count), time.
function ProjectTile({ p, ctx }: { p: Project; ctx: Ctx }) {
  const s = ctx.state;
  const tasks = s.tasks.filter((t) => t.projectId === p.id);
  const open = tasks.filter((t) => t.status !== "done").length;
  const line = autoLine(s, p) ?? (tasks.length ? `${open} open ${open === 1 ? "task" : "tasks"}` : "No tasks");
  const late = p.deadline && p.status !== "done" && p.deadline < today();
  return (
    <li>
      <button className={`ptile2 p-${p.status}`} onClick={() => ctx.go({ lens: p.worldId, project: p.id })}>
        <span className="pttop"><b>{p.name}</b>{p.status !== "active" && <span className={`pst ps-${p.status}`}><i />{PSTATUS_LABEL[p.status]}</span>}</span>
        <span className="ptsub">{line}</span>
        <span className={`ptwhen ${late ? "late" : ""}`}>{p.deadline ? `⚑ ${relDay(p.deadline)}` : p.ongoing ? <><Repeat size={12} />Ongoing</> : null}</span>
      </button>
    </li>
  );
}

// Summary of a project run by an automation: "2 automations · 9 posts this week · 1 waiting for your approval (· 2 open tasks)".
// Null for a project with no automation: the task counts are shown.
function autoLine(s: Ctx["state"], p: Project): string | null {
  const autos = s.automations.filter((a) => a.projectId === p.id && a.who !== "me");
  if (!autos.length) return null;
  const ids = new Set(autos.map((a) => a.id));
  const t = today();
  const wk = Array.from({ length: 7 }, (_, i) => addDays(t, i - ((new Date().getDay() + 6) % 7)));
  const made = s.tasks.filter((x) => x.autoId && ids.has(x.autoId) && x.day && wk.includes(x.day)).length;
  const coming = ghosts(s, p.worldId, wk.filter((d) => d >= t)).filter((g) => ids.has(g.a.id)).length;
  const waiting = s.runs.filter((r) => r.status === "ready" && runOfTask(s.runs, r.taskId) === r && ids.has(s.tasks.find((x) => x.id === r.taskId)?.autoId ?? "")).length;
  const open = s.tasks.filter((x) => x.projectId === p.id && !x.autoId && x.status !== "done").length;
  return [`${autos.length}\u00a0${autos.length === 1 ? "automation" : "automations"}`, `${made + coming}\u00a0${made + coming === 1 ? "post" : "posts"} this week`, waiting ? `${waiting}\u00a0awaiting approval` : "", open ? `${open}\u00a0open ${open === 1 ? "task" : "tasks"}` : ""].filter(Boolean).join(" · ");
}

function ProjectRow({ p, ctx }: { p: Project; ctx: Ctx }) {
  const s = ctx.state;
  const tasks = s.tasks.filter((t) => t.projectId === p.id);
  const done = tasks.filter((t) => t.status === "done").length;
  const doing = tasks.filter((t) => t.status === "doing").length;
  const overdue = tasks.filter((t) => lateKind(t)).length;
  const late = p.deadline && p.status !== "done" && p.deadline < today();
  return (
    <li>
      <button className={`prow p-${p.status} ${tasks.length ? "" : "is-empty"}`} onClick={() => ctx.go({ lens: p.worldId, project: p.id })}>
        <span className="prname">{p.name}{p.status !== "active" && <span className={`pst ps-${p.status}`}><i />{PSTATUS_LABEL[p.status]}</span>}</span>
        <span className="progress" style={autoLine(s, p) ? { visibility: "hidden" } : undefined}><span style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} /></span>
        <span className="prstat">
          {autoLine(s, p) ?? <>{tasks.length ? `${tasks.length - done} open · ${done} done` : "No tasks"}
          {doing > 0 && <b> · {doing} doing</b>}
          {overdue > 0 && <em className="plate"> · {overdue} late</em>}</>}
        </span>
        <span className={`prdl ${late ? "late" : ""}`}>{p.deadline ? `⚑ ${relDay(p.deadline)}` : p.ongoing ? <><Repeat size={12} />Ongoing</> : ""}</span>
      </button>
    </li>
  );
}

function ProjectCard({ p, ctx, i }: { p: Project; ctx: Ctx; i: number }) {
  const s = ctx.state;
  const tasks = s.tasks.filter((t) => t.projectId === p.id);
  const done = tasks.filter((t) => t.status === "done").length;
  const doing = tasks.filter((t) => t.status === "doing").length;
  const sec = tasks.reduce((n, t) => n + secsOf(s, t.id), 0);
  const late = p.deadline && p.status !== "done" && p.deadline < today();
  const overdue = tasks.filter((t) => lateKind(t)).length;
  return (
    <motion.button
      className={`pcard p-${p.status}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.02 }}
      whileHover={{ y: -2 }}
      onClick={() => ctx.go({ lens: p.worldId, project: p.id })}
    >
      <span className="ptop">
        <span className="pname">{p.name}</span>
        <span className={`pst ps-${p.status}`}><i />{PSTATUS_LABEL[p.status]}</span>
      </span>
      <span className="progress"><motion.span animate={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} /></span>
      <span className="pstat">
        {autoLine(s, p) ?? <>{tasks.length ? `${tasks.length - done} open · ${done} done` : "No tasks"}
        {doing > 0 && <b> · {doing} doing</b>}
        {overdue > 0 && <em className="plate"> · {overdue} late</em>}
        {sec >= 60 && ` · ${spent(sec)}`}</>}
      </span>
      {p.deadline && <span className={`pdl ${late ? "late" : ""}`}>⚑ {late ? `Deadline passed · ${relDay(p.deadline)}` : relDay(p.deadline)}</span>}
      {!p.deadline && p.ongoing && <span className="pdl"><Repeat size={12} />Ongoing</span>}
    </motion.button>
  );
}

const COLS: TaskStatus[] = ["todo", "doing", "waiting", "done"];

function ProjectPage({ ctx, world, project }: { ctx: Ctx; world: World; project?: Project }) {
  const s = ctx.state;
  const tasks = s.tasks.filter((t) => t.worldId === world.id && (project ? t.projectId === project.id : !t.projectId));
  // Tasks opened by an automation (Rou prepares) are not on the kanban but in the "Posts" card; the kanban is for hand-added tasks.
  const isAutoTask = (t: Task) => { const a = autoOf(s, t); return !!a && a.who !== "me"; };
  const manual = project ? tasks.filter((t) => !isAutoTask(t)) : tasks;
  const autos = project ? s.automations.filter((a) => a.projectId === project.id) : [];
  const order = (a: Task, b: Task) => `${a.day ?? "9"}`.localeCompare(`${b.day ?? "9"}`);
  const open = manual.filter((t) => t.status !== "done").sort(order);
  const closed = manual.filter((t) => t.status === "done").sort((a, b) => `${b.day ?? ""}`.localeCompare(`${a.day ?? ""}`));
  const since = Date.now() - 14 * 86400000;
  const recentDone = closed.filter((t) => new Date(t.doneAt ?? t.day ?? 0).getTime() >= since).slice(0, 30);
  const [showDone, setShowDone] = useState(false);
  const [newPost, setNewPost] = useState(false);
  const sec = tasks.reduce((n, t) => n + secsOf(s, t.id), 0);
  const done = tasks.filter((t) => t.status === "done").length;
  const set = (fn: (p: Project) => void) => project && ctx.mutate((st) => { const x = st.projects.find((y) => y.id === project.id); if (x) fn(x); });
  const [ask, setAsk] = useState(false);
  const [menu, setMenu] = useState(false);
  const del = () => {
    if (!project) return;
    const { index: _i, project: p, ...rest } = takeProject(s, project.id);
    binIt(ctx, "project", project.name, { projects: [p], ...rest }, (st) => removeProject(st, project.id), `${project.name} deleted`);
    ctx.go({ project: undefined, lens: world.id });
  };
  const move = (to: string) => {
    if (!project || to === world.id) return;
    ctx.mutate((st) => moveProject(st, project.id, to));
    ctx.go({ lens: to, project: project.id });
    toast(`${project.name} moved to ${worldOf(s, to).name}`, () => ctx.mutate((st) => moveProject(st, project.id, world.id)));
  };

  return (
    <div className="ppage" style={{ ["--w" as string]: world.color }}>
      <header className="card pagehead pphead">
        <div className="pptext">
          <button className="ppcrumb" onClick={() => ctx.go({ project: undefined, lens: world.id })} title={`${world.name} projects`}><ChevronLeft size={15} /><Orb world={world} size={14} />{world.name}<em>›</em>Projects</button>
          <div className="pptitle">
            {project ? (
              <input key={project.id} className="ppname" defaultValue={project.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== project.name) set((x) => (x.name = v)); }} />
            ) : (
              <h1>Tasks without a project</h1>
            )}
            {project && (
              <div className="ppmore">
                <button className="iconbtn" onClick={() => setMenu(!menu)} aria-label="More" aria-expanded={menu}><MoreHorizontal size={18} /></button>
                {menu && (
                  <div className="ppmenu" onMouseLeave={() => setMenu(false)}>
                    {/* Changing the world is rare and a big thing: in the menu, not in the header (2026-11-01). */}
                    {s.worlds.length > 1 && <p className="ppmenuh">Move to another world</p>}
                    {s.worlds.filter((w) => w.id !== world.id).map((w) => <button key={w.id} onClick={() => (setMenu(false), move(w.id))}><i className="ppwdot" style={{ background: w.color }} />{w.name}</button>)}
                    <button className="danger" onClick={() => (setMenu(false), setAsk(true))}><Trash2 size={14} />Delete project</button>
                  </div>
                )}
              </div>
            )}
          </div>
          {project && (
            <textarea key={`d-${project.id}`} className="wabout" rows={1} defaultValue={project.description} placeholder="A short note about the project: goal, scope, links" onBlur={(e) => { const v = e.target.value; if (v !== (project.description ?? "")) set((x) => (x.description = v)); }} />
          )}
          {!project && <p className="sub">{tasks.length - done} open · {done} done{sec >= 60 ? ` · ${spent(sec)} worked` : ""}</p>}
        </div>
        {project && (
          <div className="ppctl">
            {autoLine(s, project) ? <span className="ppstat">{autoLine(s, project)}</span> : <span className="ppstat"><b>{tasks.length - done}</b> open<i /><b>{done}</b> done{sec >= 60 && <><i /><b>{spent(sec)}</b> worked</>}</span>}
            <div className="dlin">
              <span>Status</span>
              <Select className="ppick" label="Status" value={project.status} onChange={(v) => set((x) => (x.status = v as Project["status"]))}
                groups={[{ options: (["active", "paused", "done"] as const).map((st) => ({ value: st, label: PSTATUS_LABEL[st] })) }]}>
                <i className={`pstdot ps-${project.status}`} />{PSTATUS_LABEL[project.status]}
              </Select>
            </div>
            <div className="dlin">
              <span>Time</span>
              <DatePick
                value={project.deadline ?? ""}
                onChange={(v) => set((x) => { x.deadline = v || null; if (v) delete x.ongoing; })}
                label="Deadline"
                placeholder={project.ongoing ? "Ongoing" : "No deadline"}
                icon={project.ongoing && !project.deadline ? <Repeat size={15} /> : undefined}
                className={project.ongoing && !project.deadline ? "has" : ""}
                extra={<button type="button" className={`dpongo ${project.ongoing && !project.deadline ? "on" : ""}`} onClick={() => set((x) => { if (x.ongoing && !x.deadline) delete x.ongoing; else { x.ongoing = true; x.deadline = null; } })}><Repeat size={13} />Ongoing project</button>}
              />
            </div>
          </div>
        )}
        {project && ask && (
          <div className="wdel ppdel">
            <p>Delete <b>{project.name}</b>? {projectStats(s, project.id)}</p>
            <div className="foot">
              <span />
              <button className="btn" onClick={() => setAsk(false)}>Cancel</button>
              <button className="btn dangerfill" onClick={del}>Yes, delete</button>
            </div>
          </div>
        )}
      </header>

      {/* Order: automations that run the project and their outputs on top, hand-added tasks next, settings (account, brand, media, notes) at the bottom. */}

      {/* Tasks in one list: the project's automations (labelled, pressing opens settings/plan/outputs) and hand-added tasks. The automation's daily posts are not here, they are inside the automation. */}
      {/* Settings: accounts and notes side by side (narrow content), brand voice and media below at full width. */}
      {/* Bento: tasks wide on the left; notes on the right. Brand voice, planned posts and media below at full width. Accounts only in Posts. */}
      {/* Project page (2026-11-01): a narrow column on the left (create, notes, brand voice), work on the right (tasks, automations, media). */}
      {project ? (
        <div className="pplayout">
          {/* Top row: Create and Tasks the same size; the space under them is one line across both columns. */}
          <section className="card ppmake" aria-label="Create">
              <button className="ppmk" onClick={() => { const t = newTask(world.id, "New task", { projectId: project.id }); ctx.mutate((st) => void st.tasks.push(t)); openNew(ctx, t.id); }}><span className="ppmki"><ListPlus size={17} /></span><span><b>Add task</b><em>You or Rou do it</em></span></button>
              <button className="ppmk" onClick={() => setNewPost(true)}><span className="ppmki"><Send size={16} /></span><span><b>Create post</b><em>Shared once</em></span></button>
              <button className="ppmk" onClick={() => openAutoForm({ worldId: world.id, projectId: project.id })}><span className="ppmki"><Repeat size={16} /></span><span><b>Set up automation</b><em>Repeats on a schedule</em></span></button>
          </section>
          <section className="card kbcard pptasks">
            <div className="cardhead"><ListChecks size={15} className="hicon" /><h3>Tasks</h3><span className="n">{open.length || ""}</span></div>
            <ProjectBoard ctx={ctx} projectId={project.id} manualOnly />
          </section>
          <aside className="ppside">
            <SourcesCard key={`s-${project.id}`} ctx={ctx} project={project} />
            {accountsOfProject(s, project).some((a) => !isFeed(a.platform)) && <BrandCard key={`b-${project.id}`} ctx={ctx} project={project} />}
          </aside>
          <div className="ppmain">
            <ProjectAutomations ctx={ctx} worldId={world.id} projectId={project.id} />
            <MediaCard key={`m-${project.id}`} ctx={ctx} project={project} />
          </div>
          {newPost && <NewPost ctx={ctx} projectId={project.id} onClose={() => setNewPost(false)} />}
        </div>
      ) : (
        <section className="card kbcard">
          <div className="cardhead"><ListChecks size={15} className="hicon" /><h3>Tasks</h3><span className="n">{open.length || ""}</span></div>
          <h4 className="kbsub">Open tasks<span>{open.length || ""}</span></h4>
          {open.length > 0 ? <TaskList tasks={open} ctx={ctx} o={{ day: true }} /> : <p className="kbempty">No open tasks.</p>}
        </section>
      )}
    </div>
  );
}
