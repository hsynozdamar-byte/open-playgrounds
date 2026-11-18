// Whether a single task given to Rou has to be done in Chrome: a Chrome was already picked, or the task, its note or its plan says Chrome/browser.
// Such tasks run directly without waiting for plan approval (server/browse.mjs startDirect).
export const needsChrome = (t, r) => !!t?.browser || /chrome|tarayıcı|browser/i.test(`${t?.title ?? ""} ${t?.notes ?? ""} ${r?.body ?? ""}`);

// The same sentence on the card and in the notification when no Chrome is connected.
export const NO_CHROME = "The Claude extension is not connected in Chrome. Open Chrome and connect the extension.";

// The site a task needs (account platform): if the task's title, note or plan names it.
const SITES = [["linkedin", /linkedin/i], ["instagram", /instagram/i], ["x", /\btwitter\b|\bx\.com\b|\btweet/i], ["threads", /threads/i], ["tiktok", /tiktok/i], ["youtube", /youtube/i]];
export const siteOf = (t, r) => SITES.find(([, re]) => re.test(`${t?.title ?? ""} ${t?.notes ?? ""} ${r?.body ?? ""}`))?.[0] ?? null;

// Rou picks the Chrome itself. list: connected Chromes ([{ id, name }], all with Claude in Chrome connected).
// If there are several: the one logged in to the task's site (the Chrome of the world's account, whose check passed), else the last used.
// Pure function (tested); null if none can be picked.
export function pickBrowser(s, task, list, run) {
  if (!list?.length) return null;
  if (list.length === 1) return { id: list[0].id, name: list[0].name };
  const on = (b) => b && list.find((x) => x.id === b.id);
  const accs = (s.worlds ?? []).flatMap((w) => (w.accounts ?? []).map((a) => ({ ...a, mine: w.id === task.worldId })));
  const hit = loggedInBrowser(s, task, list, run);
  if (hit) return hit;
  // Last used: the latest run of Rou's Chrome tasks or an account check.
  const seen = [
    ...(s.tasks ?? []).filter((t) => t.browser).map((t) => ({ b: t.browser, at: (s.runs ?? []).filter((r) => r.taskId === t.id).map((r) => r.act?.at ?? r.at ?? "").sort().pop() ?? "" })),
    ...accs.filter((a) => a.browser).map((a) => ({ b: a.browser, at: a.check?.at ?? "" })),
  ].filter((x) => on(x.b)).sort((a, b) => b.at.localeCompare(a.at));
  const b = seen[0] ? on(seen[0].b) : list.find((x) => x.local) ?? list[0];
  return { id: b.id, name: b.name };
}

// A connected Chrome known to be logged in to the task's site (the Chrome of the world's account, whose check passed); else null.
export function loggedInBrowser(s, task, list, run) {
  const site = siteOf(task, run);
  if (!site || !list?.length) return null;
  const on = (b) => b && list.find((x) => x.id === b.id);
  const accs = (s.worlds ?? []).flatMap((w) => (w.accounts ?? []).map((a) => ({ ...a, mine: w.id === task.worldId })));
  const hit = accs.filter((a) => a.platform === site && a.check?.ok && on(a.browser)).sort((a, b) => (b.mine - a.mine) || String(b.check.at).localeCompare(String(a.check.at)))[0];
  return hit ? { id: on(hit.browser).id, name: on(hit.browser).name } : null;
}

// A Chrome that had no login on the site in the last run (run.act.loggedOut) is skipped on the next pick.
export const usableBrowsers = (list, run) => (list ?? []).filter((b) => b.id !== run?.act?.loggedOut);

// Whether a Claude in Chrome tool result says it is waiting for a permission/approval (site permission, tool approval).
export const asksPermission = (text) => /permission|not allowed|allow (this|access)|approv|izin|onay/i.test(String(text ?? ""));

// Chrome jobs cut off by a server restart: act.phase is still set but no result (error, question, done) was written.
// direct = single task (Rou does it end to end, resumes where it stopped); items = automation items (not resumed to avoid doing them twice, an error is written).
export function orphanedActs(s) {
  const open = (s.runs ?? []).filter((r) => r.status === "approved" && r.act?.phase && !r.act.error && !r.act.question);
  return { direct: open.filter((r) => !r.items?.length), items: open.filter((r) => r.items?.length) };
}
