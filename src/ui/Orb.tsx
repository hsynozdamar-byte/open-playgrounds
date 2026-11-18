import type { World } from "../types";
import { PlaygroundsOrb, WorldOrb } from "./fluid/FluidOrb";

// Soft Fluid look (src/ui/fluid): an organic blob, the edge in the main color, a complementary tone flowing from inside, rim light on one side.
// A world's blob: from the world's color; flow direction, folds and spread come from the world's id (every world has its own shape).
export function Orb({ world, size = 40 }: { world: World; size?: number; blob?: boolean }) {
  return <span className="orb sph" style={{ ["--sz" as string]: `${size}px` }} aria-hidden><WorldOrb id={world.id} colors={{ primary: world.color, secondary: world.color2 }} size="100%" /></span>;
}

// Logo and profile: the multi-color Playgrounds blob.
export function Sphere({ size, className = "", interactive }: { size: string; className?: string; interactive?: boolean }) {
  return (
    <span className={`sph ${className}`} style={{ ["--sz" as string]: size }} aria-hidden>
      <PlaygroundsOrb size="100%" interactive={interactive} />
    </span>
  );
}

// The Playgrounds logo.
export function Logo({ size = 38 }: { size?: number }) {
  return (
    <span className="logowrap" style={{ width: `var(--logo, ${size}px)`, height: `var(--logo, ${size}px)` }} aria-label="Playgrounds">
      <Sphere size={`var(--logo, ${size}px)`} />
    </span>
  );
}
