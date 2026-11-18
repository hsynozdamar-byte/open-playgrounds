// What Rou is doing while it works in the browser (Playgrounds' own browser or, as a fallback, a linked Chrome): each tool in the claude stream becomes a short step, written to the run (run[field].live).
// The app shows this live: which Chrome, which page, what it is doing now, the last steps. Writes at most every 1.5 s.
import { update } from "./store.mjs";
import { notify } from "./notify.mjs";
import { asksPermission } from "../shared/chrome.mjs";

const host = (u) => { try { const x = new URL(u); return (x.host + x.pathname).replace(/\/$/, "").slice(0, 80); } catch { return String(u ?? "").slice(0, 80); } };
export function stepOf(name, input) {
  const t = String(name).replace(/^mcp__(claude-in-chrome|pb)__/, "");
  // Tools of the Playgrounds browser (chrome-devtools-mcp)
  if (t === "navigate_page") return input.url ? { text: `Opening: ${host(input.url)}`, url: input.url } : { text: "Browsing the page" };
  if (t === "take_snapshot") return { text: "Reading the page" };
  if (t === "take_screenshot") return { text: "Looking at the screen" };
  if (t === "click" || t === "hover" || t === "drag") return { text: "Clicking" };
  if (t === "fill" || t === "fill_form") return { text: "Filling the form" };
  if (t === "upload_file") return { text: "Uploading a file" };
  if (t === "press_key") return { text: `Key: ${input.key ?? ""}` };
  if (t === "handle_dialog") return { text: "Answering the dialog" };
  if (t === "list_pages" || t === "select_page" || t === "wait_for") return null;
  if (t === "Bash" && /pb pass/.test(String(input.command ?? ""))) return { text: "Entering the password" };
  if (t === "select_browser") return { text: "Picking a Chrome" };
  if (t === "navigate") return { text: `Opening: ${host(input.url)}`, url: input.url };
  if (t === "tabs_create_mcp") return { text: "Opening a new tab" };
  if (t === "tabs_close_mcp") return { text: "Closing the tab" };
  if (t === "get_page_text" || t === "read_page") return { text: "Reading the page" };
  if (t === "find") return { text: `Searching: ${String(input.query ?? "").slice(0, 60)}` };
  if (t === "form_input") return { text: "Filling the form" };
  if (t === "file_upload") return { text: "Uploading a file" };
  if (t === "javascript_tool") return { text: "Working on the page" };
  if (t === "computer") {
    const a = input.action;
    if (a === "screenshot") return { text: "Looking at the screen" };
    if (a === "type") return { text: `Typing: ${String(input.text ?? "").slice(0, 50)}` };
    if (a === "key") return { text: `Key: ${input.text ?? ""}` };
    if (a === "scroll") return { text: "Scrolling" };
    if (/click/.test(a ?? "")) return { text: "Clicking" };
    return { text: "Working on the page" };
  }
  if (t === "tabs_context_mcp" || t === "list_connected_browsers" || t === "ToolSearch") return null;
  if (t === "Read") return { text: "Reading a file" };
  if (t === "Write" || t === "Edit") return { text: "Writing a file" };
  return { text: t };
}

// If a Chrome tool does not finish in this time, Rou is most likely waiting at the Claude in Chrome permission/approval prompt.
export const STALL = 30 * 1000;
export const WAITING = "Waiting for approval in Chrome";

// field: "act" (the do turn) or "live" (preparation); browser: { name }.
// Returns { onTool, onResult } for runClaude and a stop to call when the job ends.
// While waiting for approval live.step is WAITING and live.waiting is true; one notification goes out per wait.
export function tracker(runId, field, browser) {
  let live = { browser: browser?.name ?? "", url: "", step: "Starting", at: new Date().toISOString(), log: [] };
  let timer = null, stall = null, told = false, before = null;
  const flush = () => {
    timer = null;
    const snap = live;
    update((st) => {
      const r = st.runs.find((x) => x.id === runId);
      if (!r) return;
      if (field === "live") r.live = snap;
      else if (r[field]) r[field].live = snap;
    });
  };
  const later = () => { if (!timer) timer = setTimeout(flush, 1500); };
  const wait = () => {
    stall = null;
    if (live.waiting) return;
    before = live.step;
    live = { ...live, step: WAITING, waiting: true, at: new Date().toISOString() };
    if (timer) { clearTimeout(timer); timer = null; }
    flush();
    if (!told) { told = true; notify("Rou is waiting for your approval in Chrome", `${live.browser || "Chrome"}, ${host(live.url).split("/")[0] || "site"}`); }
  };
  const clear = () => {
    if (stall) { clearTimeout(stall); stall = null; }
    if (live.waiting) { const { waiting, ...rest } = live; live = { ...rest, step: before ?? rest.step }; told = false; later(); }
  };
  flush();
  return {
    onTool: (name, input) => {
      clear();
      if (/^mcp__claude-in-chrome__/.test(name)) stall = setTimeout(wait, STALL);
      const s = stepOf(name, input);
      if (!s) return;
      live = { ...live, step: s.text, at: new Date().toISOString(), ...(s.url ? { url: s.url } : {}), log: [...live.log, s.text].slice(-8) };
      later();
    },
    onResult: (text, isError) => {
      clear();
      if (isError && asksPermission(text)) wait();
    },
    stop: () => { if (stall) clearTimeout(stall); stall = null; },
  };
}
