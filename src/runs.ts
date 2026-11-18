import type { Run } from "./types";

// A task's current output: the shared one if there is one (a draft opened later does not shadow it), else the newest.
export function runOfTask(runs: Run[], taskId: string | undefined): Run | undefined {
  if (!taskId) return undefined;
  let first: Run | undefined;
  for (const r of runs) {
    if (r.taskId !== taskId) continue;
    if (r.status === "posted") return r;
    first ??= r;
  }
  return first;
}
