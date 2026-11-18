import { Sparkles } from "lucide-react";
import type { Ctx } from "../lib";
import type { Task } from "../types";
import { postBasis, topicOk } from "../postBasis";
import { kickOffWhat, prepare } from "./Auto";
import { toast } from "./Toast";

export const SHORT_TOPIC = "Konu çok kısa. Başlığa ne anlatılacağını yaz, Rou ona göre yazar.";

// Elle eklenen gönderinin kartında: Rou bu gönderiyi neye göre yazacak. Çıktı yoksa buradan hazırlatılır.
export function PostBasis({ task, ctx }: { task: Task; ctx: Ctx }) {
  const s = ctx.state;
  const b = postBasis(s, task);
  const ran = s.runs.some((r) => r.taskId === task.id);
  const ok = topicOk(b.topic);
  const go = () => {
    if (!ok) return toast(SHORT_TOPIC);
    void prepare(task.id);
    toast("Rou gönderiyi hazırlıyor");
  };
  const rows: [string, string][] = [
    ["Konu", b.topic || "Yok"],
    ["Proje", b.project || "Projesiz"],
    ["Proje markası", b.brand ? "Var" : "Yok"],
    ["Hesap", b.account || "Yok"],
    ["Hesabın tonu", b.voice || "Yazılmamış"],
    ["Bilgi kaynakları", b.sources ? `${b.sources} kaynak` : "Yok"],
    ["Bağlı olduğu", b.auto ? `Otomasyon: ${b.auto}` : "Tek seferlik"],
  ];
  return (
    <section className="dsec pbasis">
      <div className="dsechead"><span className="flabel">Neye göre hazırlanır</span></div>
      <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={k === "Konu" && !ok ? "is-warn" : ""}>{v}</dd></div>)}</dl>
      {!ok && <p className="pbwarn">{SHORT_TOPIC}</p>}
      {!ran && !kickOffWhat(s, task) && task.status !== "done" && <button className="btn sm dsecbtn" onClick={go}><Sparkles size={14} />Şimdi hazırlat</button>}
    </section>
  );
}
