import { useEffect, useState } from "react";

// The server's system (GET /api/platform, shared/platform.mjs features): jobs that only work on macOS are hidden elsewhere.
export type Platform = { os: string; features: { focusChrome: boolean; macNotify: boolean; trash: boolean; openFolder: boolean; shell: boolean } };
let last: Platform | null = null;
let inflight: Promise<Platform | null> | null = null;
const load = () => (inflight ??= fetch("/api/platform").then((r) => r.json() as Promise<Platform>).catch(() => null).then((p) => (last = p)));

export function usePlatform() {
  const [p, set] = useState(last);
  useEffect(() => { if (!last) void load().then(set); }, []);
  return p;
}
// Bringing Rou's tab forward: works on every system in the app's own browser, only on macOS in the fallback Chrome path.
export const canFocusTab = (p: Platform | null) => !p || p.features.shell || p.features.focusChrome;
