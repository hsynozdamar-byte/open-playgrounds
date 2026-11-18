import { describe, expect, it } from "vitest";
import { buildCall, caps, claudeOnly, llmConfig, splitCmd } from "../shared/llm.mjs";

describe("llmConfig", () => {
  it("varsayılan claude, ortam komutu seçimi ezer", () => {
    expect(llmConfig({}, undefined)).toMatchObject({ kind: "claude", file: "claude", fromEnv: false });
    expect(llmConfig({}, "codex")).toMatchObject({ kind: "codex", file: "codex" });
    expect(llmConfig({ PG_LLM_CMD: "gemini" }, "codex")).toMatchObject({ kind: "gemini", fromEnv: true });
    expect(llmConfig({ PG_CLAUDE: "/opt/claude" }, undefined)).toMatchObject({ kind: "claude", file: "/opt/claude" });
  });
  it("npx ile verilen komutun türü paketten, bilinmeyen komut text", () => {
    expect(llmConfig({ PG_LLM_CMD: "npx @anthropic-ai/claude-code" }).kind).toBe("claude");
    expect(llmConfig({ PG_LLM_CMD: "npx @anthropic-ai/claude-code" }).pre).toEqual(["@anthropic-ai/claude-code"]);
    expect(llmConfig({ PG_LLM_CMD: "ollama run llama3" })).toMatchObject({ kind: "text", file: "ollama", pre: ["run", "llama3"] });
    expect(llmConfig({ PG_LLM_CMD: "C:\\Tools\\codex.exe" }).kind).toBe("codex");
    expect(llmConfig({ PG_LLM_CMD: "ollama run x", PG_LLM_KIND: "gemini" }).kind).toBe("gemini");
  });
  it("model katmanları ortamdan", () => {
    expect(llmConfig({}).models).toEqual({ top: "opus", mid: "sonnet", fast: "haiku" });
    expect(llmConfig({ PG_MODEL: "x", PG_MODEL_FAST: "y" }).models).toEqual({ top: "x", mid: "sonnet", fast: "y" });
  });
  it("tırnaklı yol tek parça", () => {
    expect(splitCmd('"C:\\Program Files\\x\\claude.exe" --foo')).toEqual(["C:\\Program Files\\x\\claude.exe", "--foo"]);
  });
  it("yetenekler yalnız Claude Code'da", () => {
    expect(caps(llmConfig({})).chrome).toBe(true);
    expect(Object.values(caps(llmConfig({}, "codex"))).some(Boolean)).toBe(false);
  });
});

describe("buildCall", () => {
  const claude = llmConfig({});
  it("claude: -p, istem stdin'de, model ve biçim", () => {
    const c = buildCall(claude, "merhaba");
    expect(c).toMatchObject({ file: "claude", input: "merhaba" });
    expect(c.args).toEqual(["-p", "--output-format", "text", "--model", "opus"]);
  });
  it("claude: katman ve eski --model, akış, araçlar olduğu gibi", () => {
    expect(buildCall(claude, "x", { tier: "fast" }).args).toContain("haiku");
    const old = buildCall(claude, "x", { args: ["--model", "sonnet", "--allowedTools", "Read"] }).args;
    expect(old.filter((a) => a === "--model")).toHaveLength(1);
    expect(buildCall(claude, "x", { stream: true, args: ["--chrome"] }).args).toEqual(expect.arrayContaining(["stream-json", "--verbose", "--chrome"]));
  });
  it("istem argümanda (PG_LLM_PROMPT=arg)", () => {
    const c = buildCall(llmConfig({ PG_LLM_PROMPT: "arg" }), "soru");
    expect(c.input).toBe("");
    expect(c.args.slice(0, 2)).toEqual(["-p", "soru"]);
  });
  it("codex: exec, salt okunur, stdin '-', son mesaj dosyası; okuma araçları atlanır", () => {
    const c = buildCall(llmConfig({}, "codex"), "x", { args: ["--allowedTools", "Read,WebSearch", "--add-dir", "/m"], outFile: "/tmp/o.txt" });
    expect(c.args).toEqual(["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "-o", "/tmp/o.txt", "-"]);
    expect(c.input).toBe("x");
  });
  it("gemini ve text: model bayrağı, istem stdin", () => {
    expect(buildCall(llmConfig({}, "gemini"), "x", { tier: "fast" }).args).toEqual(["-m", "gemini-2.5-flash"]);
    expect(buildCall(llmConfig({ PG_LLM_CMD: "llm -m x" }), "x").args).toEqual(["-m", "x"]);
  });
  it("Claude Code'a özgü işler başka komutta açıklamalı hata", () => {
    const codex = llmConfig({}, "codex");
    for (const args of [["--chrome"], ["--mcp-config", "{}"], ["--permission-mode", "bypassPermissions"], ["--allowedTools", "Read,Bash"]])
      expect(buildCall(codex, "x", { args }).error).toMatch(/needs Claude Code/);
    expect(buildCall(codex, "x", { stream: true }).error).toMatch(/live/);
    expect(claudeOnly(["--allowedTools", "Bash(node scripts/pg.mjs:*),Read"])).toBe("the Bash tool");
    expect(claudeOnly(["--allowedTools", "Read,Glob,Grep,WebFetch"])).toBe("");
  });
});
