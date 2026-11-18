import type { State } from "./types";
import { addDays } from "./date";

// Haftalık paylaşım raporu (dünyada hangi projede ne kadar içerik paylaşıldı): seçili haftada paylaşılan
// gönderiler dünya → proje → hesap kırılımıyla, bir önceki haftayla birlikte. Paylaşıldı = run.status "posted", gün postedAt'in yerel günü.
const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export type ReportAcc = { id: string; name: string; platform: string; n: number };
export type ReportProj = { id: string; name: string; n: number; accounts: ReportAcc[] };
export type ReportWorld = { id: string; name: string; color?: string; n: number; prev: number; projects: ReportProj[] };

function postedIn(s: State, from: string, to: string) {
  return s.runs.filter((r) => r.status === "posted" && r.postedAt && localDay(r.postedAt) >= from && localDay(r.postedAt) <= to);
}

// Süren hafta (today bu haftadaysa) geçen haftanın tamamıyla değil, aynı güne kadarki kısmıyla karşılaştırılır.
export function weekReport(s: State, wk: string, today?: string): { total: number; prev: number; worlds: ReportWorld[] } {
  const where = (taskId?: string) => {
    const t = s.tasks.find((x) => x.id === taskId);
    const a = t?.autoId ? s.automations.find((x) => x.id === t.autoId) : undefined;
    const accId = t?.post?.accountId ?? a?.accountId;
    const projectId = t?.projectId ?? a?.projectId;
    const worldId = t?.worldId ?? a?.worldId ?? s.projects.find((p) => p.id === projectId)?.worldId;
    return { worldId, projectId, accId };
  };
  const running = !!today && today >= wk && today <= addDays(wk, 6);
  const cur = postedIn(s, wk, addDays(wk, 6)), old = postedIn(s, addDays(wk, -7), running ? addDays(today!, -7) : addDays(wk, -1));
  const worlds = new Map<string, ReportWorld>();
  for (const r of cur) {
    const { worldId, projectId, accId } = where(r.taskId);
    const w0 = s.worlds.find((w) => w.id === worldId);
    const wid = w0?.id ?? "none";
    if (!worlds.has(wid)) worlds.set(wid, { id: wid, name: w0?.name ?? "No world", color: w0?.color, n: 0, prev: 0, projects: [] });
    const W = worlds.get(wid)!; W.n++;
    const p0 = s.projects.find((p) => p.id === projectId);
    let P = W.projects.find((p) => p.id === (p0?.id ?? "none"));
    if (!P) W.projects.push((P = { id: p0?.id ?? "none", name: p0?.name ?? "No project", n: 0, accounts: [] }));
    P.n++;
    const acc = s.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === accId);
    let A = P.accounts.find((x) => x.id === (acc?.id ?? "none"));
    if (!A) P.accounts.push((A = { id: acc?.id ?? "none", name: acc?.name ?? "No account", platform: String(acc?.platform ?? ""), n: 0 }));
    A.n++;
  }
  for (const r of old) { const w = worlds.get(s.worlds.find((x) => x.id === where(r.taskId).worldId)?.id ?? "none"); if (w) w.prev++; }
  const list = [...worlds.values()].sort((a, b) => b.n - a.n);
  for (const w of list) { w.projects.sort((a, b) => b.n - a.n); for (const p of w.projects) p.accounts.sort((a, b) => b.n - a.n); }
  return { total: cur.length, prev: old.length, worlds: list };
}
