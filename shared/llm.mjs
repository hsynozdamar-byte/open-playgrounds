// Rou'nun çalıştığı LLM komutu. Varsayılan Claude Code (`claude -p`); Codex (`codex exec`), Gemini CLI ya da istemi alıp
// metin yazan herhangi bir komut da olur. Seçim: PG_LLM_CMD (ortam, her zaman kazanır), yoksa Ayarlar › Asistan
// (state.settings.llm), yoksa claude. Bu modül saf: yalnız komut satırını kurar; çalıştırma server/claude.mjs'te.
//
// Ortam:
//   PG_LLM_CMD    komut, boşlukla bölünür ("npx @anthropic-ai/claude-code" de olur). Eski ad PG_CLAUDE da okunur.
//   PG_LLM_KIND   claude | codex | gemini | text (verilmezse komutun adından anlaşılır; tanınmayan = text)
//   PG_LLM_ARGS   her çağrının başına eklenen bayraklar (JSON dizi)
//   PG_LLM_PROMPT stdin | arg (varsayılan stdin: uzun istem argv sınırına takılmaz, `ps`te görünmez)
//   PG_MODEL / PG_MODEL_MID / PG_MODEL_FAST  model katmanları (en güçlü / orta / hızlı)

export const CLIS = {
  claude: { name: "Claude Code", cmd: "claude", models: { top: "opus", mid: "sonnet", fast: "haiku" }, install: "npm i -g @anthropic-ai/claude-code, sonra `claude` ile giriş" },
  codex: { name: "Codex", cmd: "codex", models: { top: "", mid: "", fast: "" }, install: "npm i -g @openai/codex, sonra `codex login`" },
  gemini: { name: "Gemini CLI", cmd: "gemini", models: { top: "gemini-2.5-pro", mid: "gemini-2.5-pro", fast: "gemini-2.5-flash" }, install: "npm i -g @google/gemini-cli, sonra `gemini` ile giriş" },
};
export const CHOICES = Object.keys(CLIS);

// Komut satırını bölümlere ayırır; tırnaklı parça tek bölüm kalır ("C:\Program Files\x\claude.exe").
export const splitCmd = (s) => (String(s ?? "").match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((x) => x.replace(/^(["'])(.*)\1$/, "$2"));

const baseName = (file) => String(file).split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
const kindOf = (file) => (CHOICES.includes(baseName(file)) ? baseName(file) : "text");

export function llmConfig(env = {}, choice) {
  const raw = env.PG_LLM_CMD || "";
  const pick = CHOICES.includes(choice) ? choice : "claude";
  const parts = raw ? splitCmd(raw) : splitCmd(pick === "claude" ? env.PG_CLAUDE || "claude" : CLIS[pick].cmd);
  const [file = "claude", ...pre] = parts;
  // npx/bunx ile verilen komutun türü paketin adından anlaşılır.
  const runner = /^(npx|bunx|pnpm|yarn)$/.test(baseName(file));
  const named = runner ? CHOICES.find((c) => new RegExp(c, "i").test(pre.join(" "))) ?? "text" : kindOf(file);
  const kind = ["claude", "codex", "gemini", "text"].includes(env.PG_LLM_KIND) ? env.PG_LLM_KIND : raw ? named : pick;
  let extra = [];
  try { const j = JSON.parse(env.PG_LLM_ARGS || "[]"); if (Array.isArray(j)) extra = j.map(String); } catch { /* bozuk JSON yok sayılır */ }
  const base = CLIS[kind]?.models ?? { top: "", mid: "", fast: "" };
  const models = { top: env.PG_MODEL || base.top, mid: env.PG_MODEL_MID || base.mid, fast: env.PG_MODEL_FAST || base.fast };
  return {
    id: kind, name: CLIS[kind]?.name ?? "Komut", file, pre: [...pre, ...extra], kind, models,
    prompt: env.PG_LLM_PROMPT === "arg" ? "arg" : "stdin", fromEnv: !!raw, cmd: parts.join(" ") || file,
  };
}

// Ne yapabildiği: araçlar (dosya okuma, web, Chrome, MCP, canlı adımlar, izin sormadan çalışma) yalnız Claude Code'da.
export const caps = (cfg) => {
  const c = cfg.kind === "claude";
  return { tools: c, web: c, vision: c, chrome: c, mcp: c, stream: c, bypass: c };
};

// Yalnız Claude Code'un bildiği bayraklar. "Yumuşak" olanlar (okuma ve web araçları) başka bir komutta atlanır, istem metin
// olarak çalışır; "sert" olanlar (Chrome, MCP, izin modu, yazma/kabuk araçları, canlı akış) olmadan iş yapılamaz.
const SOFT_TOOLS = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch"]);
const VALUE_FLAGS = new Set(["--allowedTools", "--allowed-tools", "--add-dir", "--model", "--disallowedTools", "--mcp-config", "--permission-mode"]);
export function claudeOnly(args = [], stream = false) {
  if (stream) return "canlı adım akışı";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--chrome") return "Claude in Chrome";
    if (a === "--mcp-config" || a === "--strict-mcp-config") return "tarayıcı (MCP)";
    if (a === "--permission-mode") return "izin sormadan çalışma";
    if (a === "--allowedTools" || a === "--allowed-tools") {
      const tools = String(args[i + 1] ?? "").split(",").map((t) => t.trim().replace(/\(.*$/, "")).filter(Boolean);
      const hard = tools.find((t) => !SOFT_TOOLS.has(t));
      if (hard) return `${hard} aracı`;
    }
  }
  return "";
}
// Başka bir komut için Claude'a özgü bayraklar atılır (--model katmana çevrilir).
function dropClaudeFlags(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) { i++; continue; }
    if (args[i] === "--strict-mcp-config" || args[i] === "--verbose") continue;
    out.push(args[i]);
  }
  return out;
}
// Eski çağrılar `--model haiku|sonnet|opus` veriyordu; katmana çevrilir.
const TIER_OF = { haiku: "fast", sonnet: "mid", opus: "top" };

// Döner: { file, args, input, outFile? } ya da { error } (iş yalnız Claude Code ile yapılabiliyorsa).
// opt: { tier: "top"|"mid"|"fast", args: Claude Code bayrakları, stream: canlı akış, outFile: Codex'in son mesajı için dosya }
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
  if (why) return { error: `Bu iş Claude Code gerektirir (${why}). Şu an ${cfg.fromEnv ? `PG_LLM_CMD ile \`${cfg.cmd}\`` : `Ayarlar › Asistan'da ${cfg.name}`} seçili.` };
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
