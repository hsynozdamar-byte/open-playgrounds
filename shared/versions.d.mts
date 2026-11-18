import type { Run } from "../src/types";
export const VERSION_MAX: number;
export function snapshot(run: Run, why: string): NonNullable<Run["versions"]>[number];
export function pushVersion(run: Run, why: string): void;
export function applyVersion(run: Run, from: Partial<Run>): void;
export function canTakePart(run: Run, from: Partial<Run>, part: "text" | "media"): boolean;
export function applyPart(run: Run, from: Partial<Run>, part: "text" | "media"): boolean;
