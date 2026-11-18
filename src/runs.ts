import type { Run } from "./types";

// Bir işin geçerli çıktısı: paylaşılmış çıktı varsa o (sonradan açılan taslak onu gölgelemez), yoksa en yenisi.
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
