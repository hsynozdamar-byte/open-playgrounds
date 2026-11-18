import { AddRow } from "../ui/QuickAdd";
import type { Account, World } from "../types";
import { type Ctx, ALL } from "../lib";
import { FEEDS, isFeed } from "../../shared/social.mjs";
import { AccountTile, openAccountForm } from "../ui/Social";

// Incoming: the opposite of Posts. Gmail, Slack, Google Calendar, ClickUp accounts added to worlds are set up here;
// what is read lands in the Notebook as notes. The reading connection is not written yet, sources are only saved.
type Src = Account & { world: World };
export const incomingSources = (ctx: Ctx): Src[] =>
  ctx.state.worlds.filter((w) => ctx.route.lens === ALL || w.id === ctx.route.lens).flatMap((w) => (w.accounts ?? []).filter((a) => isFeed(a.platform)).map((a) => ({ ...a, world: w })));

export function incomingSummary(ctx: Ctx) {
  const n = incomingSources(ctx).length;
  return n ? `${n} ${n === 1 ? "source" : "sources"} · reading soon` : "Add mail, Slack; lands in the Notebook";
}

const missing = (a: Account) => `No ${FEEDS[a.platform as keyof typeof FEEDS]?.field.toLocaleLowerCase("en-US") ?? "address"}`;

export function Incoming({ ctx }: { ctx: Ctx }) {
  const list = incomingSources(ctx);
  const all = ctx.route.lens === ALL;
  const first = all ? ctx.state.worlds[0]?.id : ctx.route.lens;
  return (
    <section className="card autodetail studio">
      <header className="sthead">
        <div className="adtext">
          <h2>Incoming</h2>
          <p className="sub">Mail, messages and meetings land in the Notebook from here. Nothing gets a reply.</p>
        </div>
      </header>

      <div className="stbox">
        <div className="stboxhead">
          <h3>Sources</h3>
          <span className="n">{list.length || ""}</span>
        </div>
        {list.length ? (
          <ul className="acclist">
            {list.map((a) => <AccountTile key={a.id} ctx={ctx} a={a} world={a.world}><span className="accuse">{a.world.name} world{!a.handle ? ` · ${missing(a)}` : ""}</span></AccountTile>)}
          </ul>
        ) : (
          <p className="muted stnote">Add Gmail, Slack, Google Calendar or ClickUp. Each source belongs to a world; what arrives lands in that world's Notebook.</p>
        )}
        {first && <div className="stadd"><AddRow label="Add source" onClick={() => openAccountForm({ worldId: first, group: "feed", pickWorld: all })} /></div>}
      </div>

      <div className="stbox">
        <div className="stboxhead"><h3>How it works</h3></div>
        <ol className="ststeps">
          <li><b>Add</b><span>Pick the source and the world it belongs to.</span></li>
          <li><b>Read</b><span>New mail and messages land in the Notebook as notes. This step is not connected yet.</span></li>
          <li><b>Decide</b><span>In the Notebook you turn them into tasks, put them in a project or archive them.</span></li>
        </ol>
      </div>
    </section>
  );
}
