import type { Bin, State } from "../src/types";
export const KEEP_DAYS: number;
export function toTrash(s: State, id: string, kind: Bin["kind"], title: string, recs: Bin["recs"]): void;
export function blocker(s: State, b: Bin): string | null;
export function restoreTrash(s: State, id: string): boolean;
export function purgeTrash(s: State, id?: string): void;
export function trashSummary(b: Bin): string;
export function trashOrigin(s: State, b: Bin): string;
