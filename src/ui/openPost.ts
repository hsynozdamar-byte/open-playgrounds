// Link of a shared post: in the Playgrounds app it opens in the browser pane of the world of the account that shared the post
// (that account's session is open there). On phone/web or if it cannot open, in a new tab.
export async function openPost(run: { id: string; postUrl?: string } | null | undefined, e?: { preventDefault(): void; stopPropagation?(): void }) {
  if (!run?.postUrl) return;
  e?.preventDefault();
  e?.stopPropagation?.();
  if (!(window as { pb?: { shell?: boolean } }).pb?.shell) return void window.open(run.postUrl, "_blank", "noreferrer");
  const r = await fetch("/api/pb/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: run.id }) }).then((x) => x.json()).catch(() => ({ ok: false }));
  if (!r.ok) window.open(run.postUrl, "_blank", "noreferrer");
}
