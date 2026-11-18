import type { World } from "../types";
import { AgentOrb, family, PlaygroundsOrb, WorldOrb } from "./fluid/FluidOrb";

// Soft Fluid look (src/ui/fluid): an organic blob, edge in the main colour, a complementary tone flowing in from inside, rim light on one side.
// World blob: from the world's colour; flow direction, folds and spread come from the world's identity (each world has its own shape).
export function Orb({ world, size = 40 }: { world: World; size?: number; blob?: boolean }) {
  return <span className="orb sph" style={{ ["--sz" as string]: `${size}px` }} aria-hidden><WorldOrb id={world.id} colors={{ primary: world.color, secondary: world.color2 }} size="100%" /></span>;
}

// Logo, the big blob on the welcome screen and the profile: a multi-colour Playgrounds blob. With world set (Rou's body) the assistant blob takes that colour.
export function Sphere({ size, className = "", world, interactive }: { size: string; className?: string; world?: string; phase?: number; interactive?: boolean }) {
  return (
    <span className={`sph ${className}`} style={{ ["--sz" as string]: size }} aria-hidden>
      {world ? <AgentOrb size="100%" colors={family(world)} /> : <PlaygroundsOrb size="100%" interactive={interactive} />}
    </span>
  );
}

// The Playgrounds logo = home page.
export function Logo({ size = 38 }: { size?: number }) {
  return (
    <span className="logowrap" style={{ width: `var(--logo, ${size}px)`, height: `var(--logo, ${size}px)` }} aria-label="Playgrounds">
      <Sphere size={`var(--logo, ${size}px)`} />
    </span>
  );
}
