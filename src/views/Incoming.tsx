import { AddRow } from "../ui/QuickAdd";
import type { Account, World } from "../types";
import { type Ctx, ALL } from "../lib";
import { FEEDS, isFeed } from "../../shared/social.mjs";
import { AccountTile, openAccountForm } from "../ui/Social";

// Gelenler: Gönderiler'in tersi. Dünyalara eklenen Gmail, Slack, Google Takvim, ClickUp hesapları burada kurulur;
// okunanlar Defter'e not olarak düşer. Okuma bağlantısı henüz yazılmadı, kaynaklar yalnız kayıtlı.
type Src = Account & { world: World };
export const incomingSources = (ctx: Ctx): Src[] =>
  ctx.state.worlds.filter((w) => ctx.route.lens === ALL || w.id === ctx.route.lens).flatMap((w) => (w.accounts ?? []).filter((a) => isFeed(a.platform)).map((a) => ({ ...a, world: w })));

export function incomingSummary(ctx: Ctx) {
  const n = incomingSources(ctx).length;
  return n ? `${n} kaynak · okuma yakında` : "Mail, Slack ekle; Defter'e düşer";
}

const missing = (a: Account) => `${FEEDS[a.platform as keyof typeof FEEDS]?.field.toLocaleLowerCase("tr") ?? "adres"} yok`;

export function Incoming({ ctx }: { ctx: Ctx }) {
  const list = incomingSources(ctx);
  const all = ctx.route.lens === ALL;
  const first = all ? ctx.state.worlds[0]?.id : ctx.route.lens;
  return (
    <section className="card autodetail studio">
      <header className="sthead">
        <div className="adtext">
          <h2>Gelenler</h2>
          <p className="sub">Mailler, mesajlar ve toplantılar buradan Defter'e düşer. Hiçbir şeye cevap yazılmaz.</p>
        </div>
      </header>

      <div className="stbox">
        <div className="stboxhead">
          <h3>Kaynaklar</h3>
          <span className="n">{list.length || ""}</span>
        </div>
        {list.length ? (
          <ul className="acclist">
            {list.map((a) => <AccountTile key={a.id} ctx={ctx} a={a} world={a.world}><span className="accuse">{a.world.name} dünyası{!a.handle ? ` · ${missing(a)}` : ""}</span></AccountTile>)}
          </ul>
        ) : (
          <p className="muted stnote">Gmail, Slack, Google Takvim ya da ClickUp ekle. Her kaynak bir dünyaya bağlıdır; gelenler o dünyanın Defter'ine düşer.</p>
        )}
        {first && <div className="stadd"><AddRow label="Kaynak ekle" onClick={() => openAccountForm({ worldId: first, group: "feed", pickWorld: all })} /></div>}
      </div>

      <div className="stbox">
        <div className="stboxhead"><h3>Nasıl çalışır</h3></div>
        <ol className="ststeps">
          <li><b>Ekle</b><span>Kaynağı ve hangi dünyaya ait olduğunu seç.</span></li>
          <li><b>Okunur</b><span>Yeni mailler ve mesajlar Defter'e not olarak düşer. Bu adım henüz bağlı değil.</span></li>
          <li><b>Karar ver</b><span>Defter'de göreve çevirir, projeye koyar ya da arşivlersin.</span></li>
        </ol>
      </div>
    </section>
  );
}
