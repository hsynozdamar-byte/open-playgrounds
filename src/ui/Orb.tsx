import type { World } from "../types";
import { AgentOrb, family, PlaygroundsOrb, WorldOrb } from "./fluid/FluidOrb";

// Soft Fluid kimliği (src/ui/fluid): organik leke, kenar ana renk, içten tamamlayıcı ton akar, bir yanda kenar ışığı.
// Dünya lekesi: dünyanın renginden; akış yönü, kıvrım ve dağılım dünyanın kimliğinden gelir (her dünya kendi şeklinde).
export function Orb({ world, size = 40 }: { world: World; size?: number; blob?: boolean }) {
  return <span className="orb sph" style={{ ["--sz" as string]: `${size}px` }} aria-hidden><WorldOrb id={world.id} colors={{ primary: world.color, secondary: world.color2 }} size="100%" /></span>;
}

// Logo, karşılamadaki dev leke ve profil: çok renkli Playgrounds lekesi. world verilirse (Rou'nun gövdesi) asistan lekesi o renkte.
export function Sphere({ size, className = "", world, interactive }: { size: string; className?: string; world?: string; phase?: number; interactive?: boolean }) {
  return (
    <span className={`sph ${className}`} style={{ ["--sz" as string]: size }} aria-hidden>
      {world ? <AgentOrb size="100%" colors={family(world)} /> : <PlaygroundsOrb size="100%" interactive={interactive} />}
    </span>
  );
}

// Playgrounds logosu = ana sayfa.
export function Logo({ size = 38 }: { size?: number }) {
  return (
    <span className="logowrap" style={{ width: `var(--logo, ${size}px)`, height: `var(--logo, ${size}px)` }} aria-label="Playgrounds">
      <Sphere size={`var(--logo, ${size}px)`} />
    </span>
  );
}
