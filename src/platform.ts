import { useEffect, useState } from "react";

// Sunucunun sistemi (GET /api/platform, shared/platform.mjs features): yalnız macOS'ta çalışan işler başka sistemde gizlenir.
export type Platform = { os: string; features: { focusChrome: boolean; macNotify: boolean; trash: boolean; openFolder: boolean; shell: boolean } };
let last: Platform | null = null;
let inflight: Promise<Platform | null> | null = null;
const load = () => (inflight ??= fetch("/api/platform").then((r) => r.json() as Promise<Platform>).catch(() => null).then((p) => (last = p)));

export function usePlatform() {
  const [p, set] = useState(last);
  useEffect(() => { if (!last) void load().then(set); }, []);
  return p;
}
// Rou'nun sekmesini öne getirme: uygulamanın kendi tarayıcısında her sistemde, yedek Chrome yolunda yalnız macOS'ta.
export const canFocusTab = (p: Platform | null) => !p || p.features.shell || p.features.focusChrome;
