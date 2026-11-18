import type { Automation, Run, State, Task } from "../src/types";
export type Stage = { key: "write" | "voice" | "video" | "image" | "approve" | "publish"; label: string; who: string; state: "done" | "now" | "todo" | "fail" };
export function outputOf(s: State, a: Automation): "text" | "post" | "video" | "report";
export const OUTPUT_LABEL: Record<"text" | "post" | "video" | "report", string>;
export function stagesOf(s: State, a: Automation, task: Task | undefined, run: Run | undefined, now?: number): { output: "text" | "post" | "video" | "report"; steps: Stage[]; current: Stage["key"] | null; busy: boolean; finished: boolean };
export function sharerOf(a: Automation | undefined, task: Task | undefined): "claude" | "me";
export const PLATFORMS: string[];
export const PLATFORM_NAME: Record<string, string>;
export function platformsOf(s: State, a: Automation | undefined): string[];
