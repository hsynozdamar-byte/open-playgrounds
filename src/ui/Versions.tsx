import { Film, RotateCcw, Type } from "lucide-react";
import type { Run } from "../types";
import type { Ctx } from "../lib";
import { applyPart, applyVersion, canTakePart } from "../../shared/versions.mjs";
import { ago } from "../date";
import { toast } from "./Toast";

// Gönderinin sürümleri: bu çıktının eski hâlleri (düzenleme, yeniden çizim, geri dönüş) ve aynı işin önceki çıktıları (revizeler).
// Geri dön seçileni şu anki çıktıya uygular; şu anki hâl de geçmişe girer, yani dönüş de geri alınabilir.
const WHY: Record<string, string> = { edit: "Düzenlemeden önce", render: "Yeniden çizimden önce", kit: "Görünüm değişmeden önce", restore: "Geri dönmeden önce" };

type Item = { key: string; label: string; at: string; img?: string; text: string; from: Partial<Run>; mediaOnly?: boolean };

export function versionsOf(s: Ctx["state"], r: Run): Item[] {
  const own = (r.versions ?? []).map((v, i) => ({ key: `v${i}`, label: WHY[v.why] ?? "Önceki hâl", at: v.at, img: v.images?.[0], text: v.body ?? "", from: v }));
  const older = s.runs
    .filter((x) => x.taskId && x.taskId === r.taskId && x.id !== r.id && x.status !== "working" && (x.status !== "failed" ? x.post || x.body : x.video || x.images?.length))
    // Hazırlanamayan çıktının yalnız görseli/videosu alınabilir (metni hata mesajı olabilir).
    .map((x) => ({ key: x.id, label: x.status === "failed" ? "Hazırlanamayan çıktı" : "Önceki çıktı", at: x.at, img: x.images?.[0] ?? x.cover, text: x.status === "failed" ? (x.video ? "Videosu var" : "Görseli var") : x.body, from: x, mediaOnly: x.status === "failed" }));
  return [...own, ...older].sort((a, b) => b.at.localeCompare(a.at));
}

export function Versions({ r, ctx, onDone }: { r: Run; ctx: Ctx; onDone: () => void }) {
  const list = versionsOf(ctx.state, r);
  const back = (it: Item) => {
    ctx.mutate((st) => { const x = st.runs.find((y) => y.id === r.id); if (x) applyVersion(x, it.from); });
    toast("Bu sürüme dönüldü. Şu anki hâl de geçmişte duruyor.");
    onDone();
  };
  const take = (it: Item, part: "text" | "media") => {
    ctx.mutate((st) => { const x = st.runs.find((y) => y.id === r.id); if (x) applyPart(x, it.from, part); });
    toast(part === "media" ? "Bu sürümün görseli ve videosu alındı, metin aynen kaldı." : "Bu sürümün metni alındı, görsel ve video aynen kaldı.");
    onDone();
  };
  return (
    <div className="vers">
      <div className="vershead"><b>Sürümler</b><span>{list.length ? `${list.length} eski hâl` : "Henüz eski hâl yok"}</span><button className="btn sm ghost" onClick={onDone}>Kapat</button></div>
      {list.length > 0 && (
        <ul>
          {list.map((it) => (
            <li key={it.key}>
              {it.img ? <img src={`/${it.img}`} alt="" loading="lazy" /> : <span className="versnoimg" />}
              <span className="verstext"><b>{it.label}</b><em>{ago(it.at)} önce</em><span>{it.text.split("\n").find((x) => x.trim())}</span></span>
              <span className="versbtns">
                {!it.mediaOnly && <button className="btn sm" onClick={() => back(it)}><RotateCcw size={13} />Geri dön</button>}
                {!it.mediaOnly && canTakePart(r, it.from, "text") && <button className="btn sm ghost" onClick={() => take(it, "text")}><Type size={13} />Yalnız metni</button>}
                {canTakePart(r, it.from, "media") && <button className="btn sm ghost" onClick={() => take(it, "media")}><Film size={13} />{it.from.video ? "Yalnız videoyu" : "Yalnız görseli"}</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
