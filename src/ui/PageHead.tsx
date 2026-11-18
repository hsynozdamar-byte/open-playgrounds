import { type Ctx, ALL, worldOf } from "../lib";
import { Logo, Orb } from "./Orb";
import { openWorldSettings } from "./Rail";

// Başlık satırı: seçili dünyanın küresi + sayfa başlığı. Küre dünya ayarlarını açar. Bugün kartıyla aynı.
export function TitleRow({ ctx, children }: { ctx: Ctx; children: React.ReactNode }) {
  const w = ctx.route.lens === ALL ? null : worldOf(ctx.state, ctx.route.lens);
  return (
    <div className="titlerow">
      {w ? (
        <button className="torb" onClick={() => openWorldSettings(w.id)} aria-label={`${w.name} ayarları`} title={`${w.name}: dünya ayarları`}>
          <Orb world={w} size={30} />
        </button>
      ) : (
        <span className="torb" title="Tüm dünyalar"><Logo size={30} /></span>
      )}
      <h1>{children}</h1>
    </div>
  );
}

// Sayfa başı kartı: küre + başlık, varsa sayfanın kendi alt satırı; sağda sayfanın kontrolleri.
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
