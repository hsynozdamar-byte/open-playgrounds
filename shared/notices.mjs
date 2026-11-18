// Bildirimler: sistemin kullanıcıya geri dönüşleri (paylaşıldı, paylaşılamadı, sana kaldı, onay bekliyor, hazırlanamadı).
// state.notices'ta durur (yeni önce, en çok MAX). Üst çubuktaki zil ve Rou sohbeti aynı kayıtları gösterir.
// Kayıt yalnız ne olduğunu söyler; düğmeler (Yeniden dene, Klasörü aç...) işin O ANKİ durumuna göre çizilir (noticeCtas).
export const MAX = 80;
// Bildirimler en çok bir hafta durur; daha eskisi okunduysa da okunmadıysa da silinir.
export const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const freshNotices = (list, now = Date.now()) => (list ?? []).filter((n) => now - new Date(n.at).getTime() < KEEP_MS);
// Eski bildirimleri atar; bir şey değiştiyse true (store okurken bir kez yazar).
export function pruneNotices(st, now = Date.now()) {
  const before = st.notices?.length ?? 0;
  if (!before) return false;
  st.notices = freshNotices(st.notices, now);
  return st.notices.length !== before;
}
const id = () => Math.random().toString(36).slice(2, 8);

// kind: posted | share_failed | handoff | ready | failed
export function addNotice(st, n) {
  const run = n.runId ? st.runs?.find((r) => r.id === n.runId) : undefined;
  const task = st.tasks?.find((t) => t.id === (n.taskId ?? run?.taskId));
  const x = { id: id(), at: new Date().toISOString(), ...n, ...(task ? { taskId: task.id, worldId: task.worldId } : {}), title: n.title ?? task?.title ?? run?.title ?? "" };
  // Aynı iş için aynı türden okunmamış bildirim varsa yenisi onun yerine geçer (yeniden denemeler listeyi doldurmasın).
  const list = freshNotices(st.notices).filter((y) => !(y.runId && y.runId === x.runId && y.kind === x.kind && !y.read));
  st.notices = [x, ...list].slice(0, MAX);
  return x;
}

export const KIND_LINE = {
  posted: "Paylaşıldı",
  share_failed: "Paylaşılamadı",
  handoff: "Paylaşım sana kaldı",
  ready: "Onayını bekliyor",
  failed: "Hazırlanamadı",
  ask: "Rou soruyor",
};

// Düğmeler, işin şimdiki durumundan: zaten paylaşılmışsa "Yeniden dene" çıkmaz, onaylanmışsa "İncele" yerine kart açılır.
// Sonuç: [{ id, label, primary? }]; id'ler arayüzde işe dönüşür (src/ui/Notices.tsx run).
export function noticeCtas(s, n) {
  const run = n.runId ? s.runs?.find((r) => r.id === n.runId) : undefined;
  const out = [];
  if (run?.status === "posted") {
    if (run.postUrl) out.push({ id: "view", label: "Gönderiyi aç", primary: true });
    out.push({ id: "card", label: "Kartı aç" });
    return out;
  }
  if (n.kind === "share_failed" && run?.status === "approved" && !run.publish?.phase) out.push({ id: "retry", label: "Yeniden dene", primary: true });
  if (n.kind === "handoff" && run?.publish?.dir) out.push({ id: "folder", label: "Klasörü aç", primary: true });
  if (n.kind === "ready" && run?.status === "ready") out.push({ id: "card", label: "İncele", primary: true });
  if (n.kind === "ask" && run?.act?.question) out.push({ id: "card", label: "Cevapla", primary: true });
  // Hazırlanamadı: işin EN SON çıktısına bakılır (eski çıktı "failed" kaldığı için yeni hazırlık sürerken de düğme duruyordu,
  // defalarca basılabiliyordu). Yeni çıktı hazırlanıyorsa düğme "Yeniden hazırlanıyor" olur ve basılmaz; yeni çıktı geldiyse kart açılır.
  if (n.kind === "failed") {
    const latest = (s.runs ?? []).find((r) => r.taskId === (n.taskId ?? run?.taskId));
    if (latest?.status === "working") out.push({ id: "busy", label: "Yeniden hazırlanıyor…", busy: true });
    else if (latest && latest.id !== run?.id && latest.status === "ready") out.push({ id: "card", label: "İncele", primary: true });
    else if (run?.status === "failed" && (!latest || latest.status === "failed")) out.push({ id: "redo", label: "Yeniden hazırlat", primary: true });
  }
  if (!out.some((c) => c.id === "card") && (n.taskId || run)) out.push({ id: "card", label: "Kartı aç", primary: !out.length });
  return out;
}

// Şimdi ne durumda: bildirim eskidiyse (paylaşılamadı ama sonra paylaşıldı) kısa bir satır.
export function noticeNow(s, n) {
  const run = n.runId ? s.runs?.find((r) => r.id === n.runId) : undefined;
  if (!run) return "";
  if (n.kind !== "posted" && run.status === "posted") return "Sonra paylaşıldı";
  if (run.publish?.phase) return run.publish.phase;
  if (n.kind === "ask" && !run.act?.question) return "Cevaplandı";
  if (n.kind === "ready" && run.status !== "ready") return run.status === "approved" ? "Onaylandı" : "";
  if (n.kind === "failed") {
    const latest = (s.runs ?? []).find((r) => r.taskId === run.taskId);
    if (latest && latest.id !== run.id) return latest.status === "working" ? (latest.phase ? `Yeniden hazırlanıyor: ${latest.phase}` : "Yeniden hazırlanıyor") : latest.status === "ready" ? "Yeniden hazırlandı, onayını bekliyor" : latest.status === "approved" ? "Yeniden hazırlandı ve onaylandı" : "";
  }
  return "";
}

export const unreadNotices = (s) => freshNotices(s.notices).filter((n) => !n.read).length;
