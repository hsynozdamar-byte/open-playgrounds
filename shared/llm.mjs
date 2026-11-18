// The LLM command Rou runs. Default is Claude Code (`claude -p`); Codex (`codex exec`), Gemini CLI or any command that
// takes a prompt and writes text also works. Choice: PG_LLM_CMD (environment, always wins), else Settings › Assistant
// (state.settings.llm), else claude. This module is pure: it only builds the command line; running it is in server/claude.mjs.
//
// Environment:
//   PG_LLM_CMD    the command, split on spaces ("npx @anthropic-ai/claude-code" works too). The old name PG_CLAUDE is also read.
//   PG_LLM_KIND   claude | codex | gemini | text (guessed from the command name when not set; unknown = text)
//   PG_LLM_ARGS   flags added to the start of every call (JSON array)
//   PG_LLM_PROMPT stdin | arg (default stdin: a long prompt does not hit the argv limit and does not show in `ps`)
//   PG_MODEL / PG_MODEL_MID / PG_MODEL_FAST  model tiers (strongest / middle / fast)

export const CLIS = {
  claude: { name: "Claude Code", cmd: "claude", models: { top: "opus", mid: "sonnet", fast: "haiku" }, install: "npm i -g @anthropic-ai/claude-code, then sign in with `claude`" },
  codex: { name: "Codex", cmd: "codex", models: { top: "", mid: "", fast: "" }, install: "npm i -g @openai/codex, then `codex login`" },
  gemini: { name: "Gemini CLI", cmd: "gemini", models: { top: "gemini-2.5-pro", mid: "gemini-2.5-pro", fast: "gemini-2.5-flash" }, install: "npm i -g @google/gemini-cli, then sign in with `gemini`" },
};
export const CHOICES = Object.keys(CLIS);

// Splits a command line into parts; a quoted part stays one part ("C:\Program Files\x\claude.exe").
export const splitCmd = (s) => (String(s ?? "").match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((x) => x.replace(/^(["'])(.*)\1$/, "$2"));

const baseName = (file) => String(file).split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
const kindOf = (file) => (CHOICES.includes(baseName(file)) ? baseName(file) : "text");

export function llmConfig(env = {}, choice) {
  const raw = env.PG_LLM_CMD || "";
  const pick = CHOICES.includes(choice) ? choice : "claude";
  const parts = raw ? splitCmd(raw) : splitCmd(pick === "claude" ? env.PG_CLAUDE || "claude" : CLIS[pick].cmd);
  const [file = "claude", ...pre] = parts;
  // For a command given through npx/bunx the kind comes from the package name.
  const runner = /^(npx|bunx|pnpm|yarn)$/.test(baseName(file));
  const named = runner ? CHOICES.find((c) => new RegExp(c, "i").test(pre.join(" "))) ?? "text" : kindOf(file);
  const kind = ["claude", "codex", "gemini", "text"].includes(env.PG_LLM_KIND) ? env.PG_LLM_KIND : raw ? named : pick;
  let extra = [];
  try { const j = JSON.parse(env.PG_LLM_ARGS || "[]"); if (Array.isArray(j)) extra = j.map(String); } catch { /* broken JSON is ignored */ }
  const base = CLIS[kind]?.models ?? { top: "", mid: "", fast: "" };
  const models = { top: env.PG_MODEL || base.top, mid: env.PG_MODEL_MID || base.mid, fast: env.PG_MODEL_FAST || base.fast };
  return {
    id: kind, name: CLIS[kind]?.name ?? "Command", file, pre: [...pre, ...extra], kind, models,
    prompt: env.PG_LLM_PROMPT === "arg" ? "arg" : "stdin", fromEnv: !!raw, cmd: parts.join(" ") || file,
  };
}

// What it can do: tools (file reading, web, Chrome, MCP, live steps, running without permission prompts) exist only in Claude Code.
export const caps = (cfg) => {
  const c = cfg.kind === "claude";
  return { tools: c, web: c, vision: c, chrome: c, mcp: c, stream: c, bypass: c };
};

// Flags only Claude Code knows. "Soft" ones (read and web tools) are skipped on another command and the prompt runs as plain
// text; "hard" ones (Chrome, MCP, permission mode, write/shell tools, live stream) cannot be done without.
const SOFT_TOOLS = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch"]);
const VALUE_FLAGS = new Set(["--allowedTools", "--allowed-tools", "--add-dir", "--model", "--disallowedTools", "--mcp-config", "--permission-mode"]);
export function claudeOnly(args = [], stream = false) {
  if (stream) return "live step stream";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--chrome") return "Claude in Chrome";
    if (a === "--mcp-config" || a === "--strict-mcp-config") return "browser (MCP)";
    if (a === "--permission-mode") return "running without permission prompts";
    if (a === "--allowedTools" || a === "--allowed-tools") {
      const tools = String(args[i + 1] ?? "").split(",").map((t) => t.trim().replace(/\(.*$/, "")).filter(Boolean);
      const hard = tools.find((t) => !SOFT_TOOLS.has(t));
      if (hard) return `the ${hard} tool`;
    }
  }
  return "";
}
// For another command, Claude-specific flags are dropped (--model is turned into a tier).
function dropClaudeFlags(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) { i++; continue; }
    if (args[i] === "--strict-mcp-config" || args[i] === "--verbose") continue;
    out.push(args[i]);
  }
  return out;
}
// Older calls passed `--model haiku|sonnet|opus`; it is turned into a tier.
const TIER_OF = { haiku: "fast", sonnet: "mid", opus: "top" };

// Returns { file, args, input, outFile? } or { error } (when the job needs Claude Code).
// opt: { tier: "top"|"mid"|"fast", args: Claude Code flags, stream: live stream, outFile: file for Codex's last message }
export function buildCall(cfg, prompt, opt = {}) {
  const args = opt.args ?? [];
  const mi = args.indexOf("--model");
  const tier = opt.tier ?? (mi >= 0 ? TIER_OF[args[mi + 1]] : undefined) ?? "top";
  const model = cfg.models[tier] || cfg.models.top;
  const viaArg = cfg.prompt === "arg";
  const input = viaArg ? "" : String(prompt);
  if (cfg.kind === "claude") {
    const own = mi >= 0 ? args : [...(model ? ["--model", model] : []), ...args];
    const fmt = opt.stream ? ["--output-format", "stream-json", "--verbose"] : ["--output-format", "text"];
    return { file: cfg.file, args: [...cfg.pre, "-p", ...(viaArg ? [String(prompt)] : []), ...fmt, ...own], input };
  }
  const why = claudeOnly(args, opt.stream);
  if (why) return { error: `This job needs Claude Code (${why}). Right now ${cfg.fromEnv ? `\`${cfg.cmd}\` is set with PG_LLM_CMD` : `Settings › Assistant has ${cfg.name}`}.` };
  const rest = dropClaudeFlags(args);
  if (cfg.kind === "codex") {
    return {
      file: cfg.file, input, outFile: opt.outFile,
      args: [...cfg.pre, "exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", ...(model ? ["-m", model] : []), ...(opt.outFile ? ["-o", opt.outFile] : []), ...rest, viaArg ? String(prompt) : "-"],
    };
  }
  if (cfg.kind === "gemini") return { file: cfg.file, input, args: [...cfg.pre, ...(model ? ["-m", model] : []), ...rest, ...(viaArg ? ["-p", String(prompt)] : [])] };
  return { file: cfg.file, input, args: [...cfg.pre, ...rest, ...(viaArg ? [String(prompt)] : [])] };
}
