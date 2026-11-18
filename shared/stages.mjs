// The steps of an automation task and which one it is on now. The board and the task card draw this.
// Output type: "video" when the account's format is video, "post" when there is an account, else the automation's output (default "text").
// A text post with an attachment (image or video; required on LinkedIn) gets that step after the text; approval and sharing wait for it.
// a.voice === "me": the video uses the user's voice; once the text is ready, it is their turn.
import { accountOf, attachOf, formatOf, isVideo, needsImage } from "./social.mjs";

const BOT = { claude: "Rou", me: "You" }; // claude = Rou (the app's assistant)
const STALE = 6 * 60 * 1000;

export function outputOf(s, a) {
  const f = formatOf(s, a);
  if (f) return isVideo(f) ? "video" : "post";
  // No account, but the automation shares (a post step or platforms picked): still a post; approval does not finish it, sharing does.
  if (!a?.output && (a?.platforms?.length || a?.steps?.some((x) => x.kind === "post"))) return "post";
  return a?.output ?? "text";
}
// Who shares: the one picked on this task, else on the automation, else Rou.
export const sharerOf = (a, task) => task?.sharer ?? a?.sharer ?? "claude";
export const OUTPUT_LABEL = { text: "Text", post: "Post", video: "Video", report: "Report" };

// state: done | now | todo | fail. now: the next step (who holds it is in who).
export function stagesOf(s, a, task, run, now = Date.now()) {
  if (task?.format && a) a = { ...a, format: task.format }; // automation that rotates formats: this task's format
  const out = outputOf(s, a);
  const acc = accountOf(s, a);
  const steps = [{ key: "write", label: a.who === "me" ? "Do" : "Text", who: BOT[a.who] ?? a.who }];
  if (out === "video" && a.voice === "me") steps.push({ key: "voice", label: "Voice", who: "You" });
  // Attachment: the image or video picked on the automation (required on LinkedIn, image by default).
  const att = a.who !== "me" && out !== "video" ? attachOf(formatOf(s, a), a) : undefined;
  if (out === "video" || att === "video") steps.push({ key: "video", label: "Video", who: "Rou" });
  const image = att === "image";
  if (image) steps.push({ key: "image", label: "Image", who: "Rou" });
  if (a.who !== "me" && a.approve !== false) steps.push({ key: "approve", label: "Approval", who: "You" });
  // A post or video is finished once shared: with Share when an account is linked, else you share it yourself and press "I shared it".
  if (acc || out === "post" || out === "video") steps.push({ key: "publish", label: "Sharing", who: BOT[sharerOf(a, task)] }); // sharer: Rou or You (picked on the automation or the task)

  const stale = run?.status === "working" && now - new Date(run.at).getTime() > STALE;
  const done = new Set();
  let fail = null;
  if (a.who === "me") { if (task?.status === "done") done.add("write"); }
  else if (run && !stale && run.status !== "working" && run.status !== "failed") done.add("write");
  else if (run && (run.status === "failed" || stale)) fail = "write";
  if (run?.voice) done.add("voice");
  if (run?.video) done.add("video");
  else if (run?.renderError && done.has("write") && (a.voice !== "me" || run.voice)) fail = "video";
  if (run?.images?.length || run?.video || run?.status === "posted" || (run && task?.status === "done")) done.add("image");
  else if (image && run?.renderError && done.has("write")) fail = "image";
  if (["approved", "posted", "acted"].includes(run?.status) || (a.who === "me" && task?.status === "done")) { done.add("approve"); done.add("voice"); done.add("video"); }
  if (run?.status === "posted" || (run && task?.status === "done")) done.add("publish");

  let current = null;
  for (const st of steps) {
    if (done.has(st.key)) st.state = "done";
    else if (!current) { current = st.key; st.state = fail === st.key ? "fail" : "now"; }
    else st.state = "todo";
  }
  const busy = (current === "write" && run?.status === "working" && !stale) || ((current === "video" || current === "image") && !!run?.phase);
  return { output: out, steps, current, busy, finished: !current };
}

// Platforms to share on: the account's when one is linked, else the ones picked on the automation.
export const PLATFORMS = ["instagram", "tiktok", "youtube", "x", "threads", "linkedin"];
export const PLATFORM_NAME = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", x: "X", threads: "Threads", linkedin: "LinkedIn" };
export function platformsOf(s, a) {
  const acc = a && accountOf(s, a);
  return acc ? [acc.platform] : a?.platforms ?? [];
}
