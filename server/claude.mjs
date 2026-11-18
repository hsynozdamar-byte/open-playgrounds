// LLM call (default `claude -p`): preparing, drafts and the Rou chat all go through here. The command comes from Settings › Assistant
// or PG_LLM_CMD (shared/llm.mjs). It uses the user's own subscription; no API key is used.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCall, caps, llmConfig } from "../shared/llm.mjs";
import { killTree, resolveSpawn } from "../shared/platform.mjs";

// The selected command (state.settings.llm). store.mjs registers it; data is not read here to avoid a circular import.
let choose = () => undefined;
export const llmFrom = (fn) => { choose = fn; };
export const llm = () => { let c; try { c = choose(); } catch { /* data unreadable: use the default */ } return llmConfig(process.env, c); };
export const llmCaps = () => caps(llm());

// Running processes are in their own process groups (detached); they do not stop by themselves when the server exits or restarts.
// If left running, the restarted server would carry on the same job and two Rous would drive the same browser (double share risk).
const live = new Set();
export const stopAll = () => { for (const pid of live) killTree(pid); live.clear(); };
process.on("exit", stopAll);
const LOGIN = /please run \/login|not logged in|invalid api key|authentication_error|oauth token has expired|credit balance is too low/i;

// Stopped after `ms` if it hangs; the user can stop it with `signal`. Result: { ok, out } or { ok: false, error }.
// opt.args: Claude Code flags (e.g. --chrome and allowed tools for the browser); opt.cwd: working folder.
// opt.tier: "mid" | "fast" (middle and fast model; the strongest when omitted).
// opt.onTool(name, input): when given, claude runs in stream-json mode and every tool it uses is reported at once
// (so the app can show Rou working in Chrome live). The result is the same: the final text comes back as out.
// opt.onResult(text, isError): when a tool's result arrives (to notice a wait for approval in Chrome).
// If a command other than Claude Code is selected, jobs that need tools return an explained error (shared/llm.mjs buildCall).
// claude's info warnings ("Warning: this sign-in ends ...") are not an error cause.
export const noWarnings = (t) => String(t ?? "").split("\n").filter((l) => !/^\s*warning:/i.test(l)).join("\n").trim();

export function runClaude(prompt, ms, signal, opt = {}) {
  return new Promise((resolve) => {
    const cfg = llm();
    const claude = cfg.kind === "claude";
    // Codex writes its last message to a file (stdout also has progress lines).
    const outFile = cfg.kind === "codex" ? path.join(os.tmpdir(), `pg-llm-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.txt`) : undefined;
    const call = buildCall(cfg, prompt, { tier: opt.tier, args: opt.args, stream: !!opt.onTool, outFile });
    if (call.error) return resolve({ ok: false, error: call.error, unsupported: true });
    const stream = claude && !!opt.onTool;
    // The prompt goes through stdin: a long prompt does not hit the argv limit and does not show in the process list.
    // On Windows, scripts such as claude.cmd run through cmd.exe with escaped arguments (shared/platform.mjs).
    const sp = resolveSpawn(call.file, call.args, { stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32", ...(opt.cwd ? { cwd: opt.cwd } : {}) });
    const child = spawn(sp.file, sp.args, sp.opts);
    child.stdin.on("error", () => { /* process closed early */ });
    child.stdin.end(call.input);
    if (child.pid) { live.add(child.pid); child.on("close", () => live.delete(child.pid)); }
    // Runs in its own process group; stopping it also stops the child processes it started.
    const kill = () => killTree(child.pid);
    let out = "", err = "", buf = "", result = null;
    child.stdout.setEncoding("utf8").on("data", (c) => {
      if (!stream) return void (out += c);
      buf += c;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const j = JSON.parse(line);
          if (j.type === "assistant") for (const b of j.message?.content ?? []) if (b.type === "tool_use") { try { opt.onTool(b.name, b.input ?? {}); } catch { /* watching must not break the job */ } }
          if (j.type === "user" && opt.onResult) for (const b of j.message?.content ?? []) if (b.type === "tool_result") {
            const text = typeof b.content === "string" ? b.content : (b.content ?? []).map((x) => x.text ?? "").join(" ");
            try { opt.onResult(text.slice(0, 2000), !!b.is_error); } catch { /* watching must not break the job */ }
          }
          if (j.type === "result") result = typeof j.result === "string" ? j.result : "";
        } catch { /* not a complete line, skip */ }
      }
    });
    child.stderr.setEncoding("utf8").on("data", (c) => (err += c));
    // On timeout the error should not be "Exit code 143" or a warning line from claude: the real cause is the timeout.
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; kill(); }, ms);
    signal?.addEventListener("abort", () => { kill(); end({ ok: false, error: "Stopped", cancelled: true }); });
    let ended = false;
    const end = (r) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      if (outFile) fs.rm(outFile, { force: true }, () => {});
      resolve(r);
    };
    child.on("error", (e) => end({ ok: false, error: e.code === "ENOENT" ? `${cfg.name} not found: \`${cfg.file}\` is not on this computer or not on PATH. Install it or pick another command in Settings › Assistant.` : `${cfg.name} could not be started: ${e.message}` }));
    child.on("close", (code) => {
      let text = (stream ? result ?? "" : out).trim();
      if (outFile && code === 0) { try { text = fs.readFileSync(outFile, "utf8").trim() || text; } catch { /* keep stdout */ } }
      // When signed out, claude sometimes prints the error as normal output; that is not a result.
      if (code === 0 && text && !(claude && text.length < 400 && LOGIN.test(text))) return end({ ok: true, out: text });
      if (claude && LOGIN.test(err + out)) return end({ ok: false, error: "Claude is signed out. Run `claude` in a terminal and sign in." });
      if (timedOut) return end({ ok: false, error: `Timed out (${Math.round(ms / 60000)} min), Rou could not finish`, timedOut: true });
      const why = noWarnings(err) || noWarnings(out);
      end({ ok: false, error: (claude ? why : why.slice(-600)).trim() || `Exit code ${code}` });
    });
  });
}
