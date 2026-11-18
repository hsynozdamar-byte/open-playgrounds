import { type Ctx, ALL, worldOf } from "../lib";
import { Logo, Orb } from "./Orb";
import { openWorldSettings } from "./Rail";

// Title row: the selected world's sphere + the page title. The sphere opens the world settings. Same as the Today card.
export function TitleRow({ ctx, children }: { ctx: Ctx; children: React.ReactNode }) {
  const w = ctx.route.lens === ALL ? null : worldOf(ctx.state, ctx.route.lens);
  return (
    <div className="titlerow">
      {w ? (
        <button className="torb" onClick={() => openWorldSettings(w.id)} aria-label={`${w.name} settings`} title={`${w.name}: world settings`}>
          <Orb world={w} size={30} />
        </button>
      ) : (
        <span className="torb" title="All worlds"><Logo size={30} /></span>
      )}
      <h1>{children}</h1>
    </div>
  );
}

// Page header card: sphere + title, the page's own subline if any; the page's controls on the right.
export function PageHead({ ctx, title, sub, className = "", children }: { ctx: Ctx; title: React.ReactNode; sub?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    <header className={`card pagehead ${className}`}>
      <div className="phtext">
        <TitleRow ctx={ctx}>{title}</TitleRow>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {children && <div className="phctl">{children}</div>}
    </header>
  );
}
