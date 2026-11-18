// Approval gate: before an output goes to "Waiting for approval" it is checked for kinds of mistakes caught before. A failed check
// makes the output "failed" with the reason on the card; the scheduler (server/schedule.mjs retryable) retries it by itself.
// When a new kind of mistake is caught, a check is added here (date + what it was), with its test in tests/quality.test.ts.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store.mjs";
import { attachMedia } from "./library.mjs";
import { revisionsOf } from "../shared/revise.mjs";

// An output whose design review score is under this counts as weak. A weak output is still shown to the user (it goes to approval
// with its critique); it is only never approved automatically (server/share.mjs approveRun).
export const FLOOR = 5;
export const designLow = (r) => !!r?.review && (r.review?.score) < FLOOR;

const textsOf = (r) => [r.body, r.post?.text, r.post?.caption, r.post?.hook, ...(Array.isArray(r.post?.tweets) ? r.post.tweets : [])].filter((x) => typeof x === "string");

export const CHECKS = [
  // Rou's own note must not end up on the first line of the text.
  { id: "note", why: "Rou's internal note was left in the text", test: (r) => textsOf(r).some((t) => /^\s*(TOPIC MISMATCH|UNABLE|KONU UYMADI|YAPILAMADI|NOTE ?:|NOT ?:|TODO)\b/im.test(t)) },
  // If the visual key does not resolve, only text is drawn on a black ground.
  // The attachment may come from another project's media (an account can talk about another project): it is blank only if it resolves in none of the world's projects.
  { id: "blank", why: "The attached visual has no real footage (text-only card)", test: (r, pids) => !!r.attach?.slides?.length && !r.video && !pids.some((pid) => attachMedia(pid, r.attach).slides?.some((x) => x.media)) },
  // If a file the output shows is missing on disk, the share would be empty.
  { id: "file", why: "The output's image or video file was not found", test: (r) => [r.video, ...(r.images ?? [])].filter(Boolean).some((f) => !fs.existsSync(path.join(DATA_DIR, f))) },
  // Empty text (unless it is an image-only post).
  { id: "empty", why: "The post's text is empty", test: (r) => !!r.post && !textsOf(r).some((t) => t.trim()) && !(r.images?.length || r.video) },
  // If the last revision explicitly asks for a format (GIF, video), that format must be in the output.
  // If the note was clarified (clear), the gate looks for a format only when the note wants new media (media "new"); removal/ban sentences do not count as a request.
  { id: "asked", why: "The GIF, video or animation asked for in the revision is not in the output", test: (r, pids, task) => {
    const rv = revisionsOf(task).at(-1);
    if (rv?.clear && rv.clear.media !== "new") return false;
    const NO = /(video|gif|animasyon|kayd|animation|recording)[^.;]{0,120}?(çıkar|kaldır|sil|olmasın|koyma|istem|gerek yok|ne gerek|remove|drop|delete|without|don'?t|do not|no need|not needed)|videosuz|no (video|gif|animation)|without (a |an )?(video|gif|animation)/i;
    const ask = `${rv?.clear?.ask ?? ""} ${rv?.clear ? "" : rv?.note ?? ""}`;
    if (NO.test(ask)) return false;
    const media = [r.video, ...(r.images ?? [])].filter(Boolean);
    if (/\bgif/i.test(ask)) return !media.some((f) => /\.gif$/i.test(f));
    // "kaydır-" is scrolling, not recording ("ilk kaydırmada").
    if (/\bvideo|animasyon|animation|screen ?record|recording|ekran kayd|\bkayd[ıi](?!r)/i.test(ask)) return !media.some((f) => /\.(mp4|mov|webm|gif)$/i.test(f));
    return false;
  } },
];

// { ok } or { ok: false, error, failed: [id] }
// pids: the task's project and the other projects in its world. task: the task with its revisions.
export function gate(r, pids = [], task = null, s = null) {
  const failed = CHECKS.filter((c) => { try { return c.test(r, pids.filter(Boolean), task, s); } catch { return false; } });
  if (!failed.length) return { ok: true };
  return { ok: false, failed: failed.map((c) => c.id), error: `Failed the approval check: ${failed.map((c) => c.why).join("; ")}. Rou will retry by itself.` };
}
