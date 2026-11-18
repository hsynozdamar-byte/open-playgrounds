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

// Projeler: mercek "Hepsi" ise tüm dünyalar, bir dünya ise o dünyanın projeleri; proje seçiliyse proje sayfası.
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
       
        title="Projeler"
        sub={route.lens === ALL ? "Tüm dünyalarındaki projeler." : "Bu dünyanın projeleri ve görevleri."}
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
            <button className="wname" onClick={() => ctx.go({ lens: world.id })}>{world.name}<span className="wcount">{projects.length ? `${projects.length} proje` : "Proje yok"}</span></button>
            {world.description && <p className="wabout">{world.description}</p>}
          </div>
        </header>
      )}

      <section className="card wgroup">
      <div className="cardhead"><FolderKanban size={15} className="hicon" /><h3>Projeler</h3><span className="n">{projects.length || ""}</span></div>
      <ul className="strip ptiles">
        <AddTile items={[{ label: "Yeni proje", onClick: () => openProjectForm({ worldId: world.id }) }]} />
        {projects.map((p) => <ProjectTile key={p.id} p={p} ctx={ctx} />)}
        {loose.length > 0 && (
          <li><button className="ptile2 loose" onClick={() => ctx.go({ lens: world.id, project: `none:${world.id}` })}>
            <b>Projesiz görevler</b><span className="ptsub">{loose.length} açık görev</span>
          </button></li>
        )}
      </ul>
      </section>
      {rest.length > 0 && (
        <>
          <button className="foldbtn prest" onClick={() => setShowRest(!showRest)}>
            {showRest ? "Gizle" : `Beklemede ve biten projeler · ${rest.length}`}
          </button>
          {showRest && <ul className="strip ptiles">{rest.map((p) => <ProjectTile key={p.id} p={p} ctx={ctx} />)}</ul>}
        </>
      )}
    </section>
  );
}

// Projesi olan dünyalar kart olarak; hiç projesi ve işi olmayanlar en altta tek satırda toplanır, liste uzamasın.
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
          <p>Projesi olmayan dünyalar</p>
          <ul>
            {empty.map((w) => (
              <li key={w.id} style={{ ["--w" as string]: w.color }}>
                <button className="wechip" onClick={() => openProjectForm({ worldId: w.id })} title={`${w.name} için yeni proje`}>
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

// Hepsi görünümü: her dünya bir kart, projeleri içinde aynı sütunlara oturan satırlar. Boş dünya yalnız başlık satırı.
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
          <span>{active.length ? `${active.length} aktif proje` : "Aktif proje yok"}</span>
        </button>
        {rest.length > 0 && <button className="link wgrest" onClick={() => setShowRest(!showRest)}>{showRest ? "Beklemede ve bitenleri gizle" : `Beklemede ve biten · ${rest.length}`}</button>}
      </header>
      {/* Projeler eşit boyda kutular, soldan sağa; sığmayan yana kayar. İlk kutu yeni proje. */}
      <ul className="strip ptiles">
        <AddTile items={[{ label: "Yeni proje", onClick: () => openProjectForm({ worldId: world.id }) }]} />
        {rows.map((p) => <ProjectTile key={p.id} p={p} ctx={ctx} />)}
        {loose > 0 && (
          <li><button className="ptile2 loose" onClick={() => ctx.go({ lens: world.id, project: `none:${world.id}` })}>
            <b>Projesiz görevler</b><span className="ptsub">{loose} açık görev</span>
          </button></li>
        )}
      </ul>
    </section>
  );
}

// Proje kutusu: ad, durum, ne yürüyor (otomasyon/gönderi ya da görev sayısı), zaman.
function ProjectTile({ p, ctx }: { p: Project; ctx: Ctx }) {
  const s = ctx.state;
  const tasks = s.tasks.filter((t) => t.projectId === p.id);
  const open = tasks.filter((t) => t.status !== "done").length;
  const line = autoLine(s, p) ?? (tasks.length ? `${open} açık görev` : "Görev yok");
  const late = p.deadline && p.status !== "done" && p.deadline < today();
  return (
    <li>
      <button className={`ptile2 p-${p.status}`} onClick={() => ctx.go({ lens: p.worldId, project: p.id })}>
        <span className="pttop"><b>{p.name}</b>{p.status !== "active" && <span className={`pst ps-${p.status}`}><i />{PSTATUS_LABEL[p.status]}</span>}</span>
        <span className="ptsub">{line}</span>
        <span className={`ptwhen ${late ? "late" : ""}`}>{p.deadline ? `⚑ ${relDay(p.deadline)}` : p.ongoing ? <><Repeat size={12} />Sürekli</> : null}</span>
      </button>
    </li>
  );
}

// Otomasyonla yürüyen projenin özeti: "2 otomasyon · bu hafta 9 gönderi · 1 onayını bekliyor (· 2 açık görev)".
// Otomasyonu olmayan projede null: görev sayıları gösterilir.
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
  return [`${autos.length}\u00a0otomasyon`, `bu hafta ${made + coming}\u00a0gönderi`, waiting ? `${waiting}\u00a0onayını bekliyor` : "", open ? `${open}\u00a0açık görev` : ""].filter(Boolean).join(" · ");
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
          {autoLine(s, p) ?? <>{tasks.length ? `${tasks.length - done} açık · ${done} bitti` : "Görev yok"}
          {doing > 0 && <b> · {doing} yapılıyor</b>}
          {overdue > 0 && <em className="plate"> · {overdue} gecikmiş</em>}</>}
        </span>
        <span className={`prdl ${late ? "late" : ""}`}>{p.deadline ? `⚑ ${relDay(p.deadline)}` : p.ongoing ? <><Repeat size={12} />Sürekli</> : ""}</span>
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
        {autoLine(s, p) ?? <>{tasks.length ? `${tasks.length - done} açık · ${done} bitti` : "Görev yok"}
        {doing > 0 && <b> · {doing} yapılıyor</b>}
        {overdue > 0 && <em className="plate"> · {overdue} gecikmiş</em>}
        {sec >= 60 && ` · ${spent(sec)}`}</>}
      </span>
      {p.deadline && <span className={`pdl ${late ? "late" : ""}`}>⚑ {late ? `Deadline geçti · ${relDay(p.deadline)}` : relDay(p.deadline)}</span>}
      {!p.deadline && p.ongoing && <span className="pdl"><Repeat size={12} />Sürekli</span>}
    </motion.button>
  );
}

const COLS: TaskStatus[] = ["todo", "doing", "waiting", "done"];

function ProjectPage({ ctx, world, project }: { ctx: Ctx; world: World; project?: Project }) {
  const s = ctx.state;
  const tasks = s.tasks.filter((t) => t.worldId === world.id && (project ? t.projectId === project.id : !t.projectId));
  // Otomasyonun açtığı işler (Rou hazırlar) kanbanda değil, "Gönderiler" kartında; kanban elle eklenen işler için.
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
    binIt(ctx, "project", project.name, { projects: [p], ...rest }, (st) => removeProject(st, project.id), `${project.name} silindi`);
    ctx.go({ project: undefined, lens: world.id });
  };
  const move = (to: string) => {
    if (!project || to === world.id) return;
    ctx.mutate((st) => moveProject(st, project.id, to));
    ctx.go({ lens: to, project: project.id });
    toast(`${project.name}, ${worldOf(s, to).name} dünyasına taşındı`, () => ctx.mutate((st) => moveProject(st, project.id, world.id)));
  };

  return (
    <div className="ppage" style={{ ["--w" as string]: world.color }}>
      <header className="card pagehead pphead">
        <div className="pptext">
          <button className="ppcrumb" onClick={() => ctx.go({ project: undefined, lens: world.id })} title={`${world.name} projeleri`}><ChevronLeft size={15} /><Orb world={world} size={14} />{world.name}<em>›</em>Projeler</button>
          <div className="pptitle">
            {project ? (
              <input key={project.id} className="ppname" defaultValue={project.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== project.name) set((x) => (x.name = v)); }} />
            ) : (
              <h1>Projesiz görevler</h1>
            )}
            {project && (
              <div className="ppmore">
                <button className="iconbtn" onClick={() => setMenu(!menu)} aria-label="Diğer" aria-expanded={menu}><MoreHorizontal size={18} /></button>
                {menu && (
                  <div className="ppmenu" onMouseLeave={() => setMenu(false)}>
                    {/* Dünya değiştirmek nadir ve büyük bir iş: başlıkta değil, menüde (2026-11-01). */}
                    {s.worlds.length > 1 && <p className="ppmenuh">Başka dünyaya taşı</p>}
                    {s.worlds.filter((w) => w.id !== world.id).map((w) => <button key={w.id} onClick={() => (setMenu(false), move(w.id))}><i className="ppwdot" style={{ background: w.color }} />{w.name}</button>)}
                    <button className="danger" onClick={() => (setMenu(false), setAsk(true))}><Trash2 size={14} />Projeyi sil</button>
                  </div>
                )}
              </div>
            )}
          </div>
          {project && (
            <textarea key={`d-${project.id}`} className="wabout" rows={1} defaultValue={project.description} placeholder="Proje hakkında kısa not: hedef, kapsam, linkler" onBlur={(e) => { const v = e.target.value; if (v !== (project.description ?? "")) set((x) => (x.description = v)); }} />
          )}
          {!project && <p className="sub">{tasks.length - done} açık · {done} bitti{sec >= 60 ? ` · ${spent(sec)} çalışıldı` : ""}</p>}
        </div>
        {project && (
          <div className="ppctl">
            {autoLine(s, project) ? <span className="ppstat">{autoLine(s, project)}</span> : <span className="ppstat"><b>{tasks.length - done}</b> açık<i /><b>{done}</b> bitti{sec >= 60 && <><i /><b>{spent(sec)}</b> çalışıldı</>}</span>}
            <div className="dlin">
              <span>Durum</span>
              <Select className="ppick" label="Durum" value={project.status} onChange={(v) => set((x) => (x.status = v as Project["status"]))}
                groups={[{ options: (["active", "paused", "done"] as const).map((st) => ({ value: st, label: PSTATUS_LABEL[st] })) }]}>
                <i className={`pstdot ps-${project.status}`} />{PSTATUS_LABEL[project.status]}
              </Select>
            </div>
            <div className="dlin">
              <span>Zaman</span>
              <DatePick
                value={project.deadline ?? ""}
                onChange={(v) => set((x) => { x.deadline = v || null; if (v) delete x.ongoing; })}
                label="Deadline"
                placeholder={project.ongoing ? "Sürekli" : "Deadline yok"}
                icon={project.ongoing && !project.deadline ? <Repeat size={15} /> : undefined}
                className={project.ongoing && !project.deadline ? "has" : ""}
                extra={<button type="button" className={`dpongo ${project.ongoing && !project.deadline ? "on" : ""}`} onClick={() => set((x) => { if (x.ongoing && !x.deadline) delete x.ongoing; else { x.ongoing = true; x.deadline = null; } })}><Repeat size={13} />Sürekli proje</button>}
              />
            </div>
          </div>
        )}
        {project && ask && (
          <div className="wdel ppdel">
            <p><b>{project.name}</b> silinsin mi? {projectStats(s, project.id)}</p>
            <div className="foot">
              <span />
              <button className="btn" onClick={() => setAsk(false)}>Vazgeç</button>
              <button className="btn dangerfill" onClick={del}>Evet, sil</button>
            </div>
          </div>
        )}
      </header>

      {/* Sıra: projeyi yürüten otomasyonlar ve onların çıktıları üstte, elle eklenen görevler sonra, ayarlar (hesap, marka, medya, bilgi) en altta. */}

      {/* Görevler tek liste: projenin otomasyonları (etiketli, basınca ayar/plan/çıktılar) ve elle eklenen işler. Otomasyonun günlük gönderileri burada değil, otomasyonun içinde. */}
      {/* Ayarlar: hesaplar ve bilgi yan yana (dar içerik), marka sesi ve medya altında tam genişlik. */}
      {/* Bento: görevler solda geniş; bilgi sağda. Marka sesi, planlanan gönderiler ve medya altında tam genişlik. Hesaplar yalnız Gönderiler'de. */}
      {/* Proje sayfası (2026-11-01): solda dar sütun (oluştur, bilgi, marka sesi), sağda iş (görevler, otomasyonlar, medya). */}
      {project ? (
        <div className="pplayout">
          {/* Üst satır: Oluştur ve Görevler aynı boyda; altındaki boşluk iki sütunda tek çizgi. */}
          <section className="card ppmake" aria-label="Oluştur">
              <button className="ppmk" onClick={() => { const t = newTask(world.id, "Yeni görev", { projectId: project.id }); ctx.mutate((st) => void st.tasks.push(t)); openNew(ctx, t.id); }}><span className="ppmki"><ListPlus size={17} /></span><span><b>Görev ekle</b><em>Sen ya da Rou yapar</em></span></button>
              <button className="ppmk" onClick={() => setNewPost(true)}><span className="ppmki"><Send size={16} /></span><span><b>Gönderi oluştur</b><em>Bir kez paylaşılır</em></span></button>
              <button className="ppmk" onClick={() => openAutoForm({ worldId: world.id, projectId: project.id })}><span className="ppmki"><Repeat size={16} /></span><span><b>Otomasyon kur</b><em>Düzenli tekrarlanır</em></span></button>
          </section>
          <section className="card kbcard pptasks">
            <div className="cardhead"><ListChecks size={15} className="hicon" /><h3>Görevler</h3><span className="n">{open.length || ""}</span></div>
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
          <div className="cardhead"><ListChecks size={15} className="hicon" /><h3>Görevler</h3><span className="n">{open.length || ""}</span></div>
          <h4 className="kbsub">Açık görevler<span>{open.length || ""}</span></h4>
          {open.length > 0 ? <TaskList tasks={open} ctx={ctx} o={{ day: true }} /> : <p className="kbempty">Açık görev yok.</p>}
        </section>
      )}
    </div>
  );
}
