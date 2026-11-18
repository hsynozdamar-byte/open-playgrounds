import type { State, World } from "../src/types";
export const SWATCHES: string[];
export function worldId(s: State, name: string): string;
export function newWorld(s: State, name: string, description?: string, color?: string): World;
export function moveProjectTo(s: State, projectId: string, worldId: string): void;
