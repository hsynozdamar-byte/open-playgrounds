import type { State, Task } from "./types";
import { accountOf, platformName, taskRef } from "../shared/social.mjs";

// Elle eklenen gönderinin (task.post) neye göre hazırlanacağı: Rou'nun prompt'una giden parçaların özeti (server/prepare.mjs).
export const TOPIC_MIN = 3;
export const topicOk = (t?: string) => (t ?? "").replace(/\s+/g, " ").trim().length >= TOPIC_MIN;

export function postBasis(s: State, task: Task) {
  const acc = accountOf(s, taskRef(s, task));
  const p = acc?.project;
  const b = p?.brand;
  const auto = task.autoId ? s.automations.find((a) => a.id === task.autoId) : undefined;
  return {
    topic: (task.topic?.title || task.title || "").trim(),
    project: p?.name ?? "",
    brand: !!b && !!(b.audience || b.pillars?.length || b.use || b.avoid),
    account: acc ? `${platformName(acc)} ${acc.handle && !acc.handle.includes("/") ? acc.handle : acc.name || acc.handle}`.trim() : "",
    voice: (acc?.voice ?? "").trim(),
    sources: (p?.sources ?? []).filter((x) => x.use !== false).length,
    auto: auto?.title ?? "",
  };
}
