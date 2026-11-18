import { describe, expect, it, vi } from "vitest";
import { cmdQuote, expandHome, features, killTree, mediaKey, npxCommand, openCommand, spawnSpec, trashCommand, which } from "../shared/platform.mjs";

describe("which", () => {
  it("Windows: PATHEXT ile .cmd bulunur, uzantısız sh betiği atlanır", () => {
    const files = new Set(["C:\\npm\\claude", "C:\\npm\\claude.cmd", "C:\\bin\\codex.exe"]);
    const o = { plat: "win32", env: { PATH: "C:\\npm;C:\\bin", PATHEXT: ".EXE;.CMD" }, exists: (f: string) => files.has(f) };
    expect(which("claude", o)).toBe("C:\\npm\\claude.cmd");
    expect(which("codex", o)).toBe("C:\\bin\\codex.exe");
    expect(which("gemini", o)).toBe("");
    expect(which("C:\\bin\\codex.exe", o)).toBe("C:\\bin\\codex.exe");
  });
  it("Unix: PATH sırası", () => {
    const o = { plat: "darwin", env: { PATH: "/a:/b" }, exists: (f: string) => f === "/b/claude" };
    expect(which("claude", o)).toBe("/b/claude");
    expect(which("nope", o)).toBe("");
  });
});

describe("spawnSpec", () => {
  it("Unix ve .exe olduğu gibi", () => {
    expect(spawnSpec("/usr/bin/claude", ["-p"], {}, { plat: "darwin" })).toEqual({ file: "/usr/bin/claude", args: ["-p"], opts: { windowsHide: true } });
    expect(spawnSpec("C:\\x\\codex.exe", ["exec"], {}, { plat: "win32" }).file).toBe("C:\\x\\codex.exe");
  });
  it("Windows .cmd: cmd.exe /d /s /c, argümanlar kaçışlı, verbatim", () => {
    const s = spawnSpec("C:\\npm\\claude.cmd", ["-p", '{"a":"b c"}', "x&y"], {}, { plat: "win32" });
    expect(s.file).toBe("cmd.exe");
    expect(s.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(s.opts.windowsVerbatimArguments).toBe(true);
    expect(s.args[3]).toContain("x^^^&y");
    expect(s.args[3].startsWith('"C:\\npm\\claude.cmd ')).toBe(true);
  });
  it("cmdQuote ters bölü ve tırnak", () => {
    expect(cmdQuote('a"b', false)).toBe('^"a\\^"b^"');
    expect(cmdQuote("C:\\dir\\", false)).toBe('^"C:\\dir\\\\^"');
  });
});

describe("killTree", () => {
  it("Unix: süreç grubu, olmazsa süreç", () => {
    const kill = vi.fn((pid: number) => { if (pid < 0) throw new Error("ESRCH"); });
    killTree(42, { plat: "darwin", kill });
    expect(kill.mock.calls).toEqual([[-42, "SIGTERM"], [42, "SIGTERM"]]);
  });
  it("Windows: taskkill /T /F", () => {
    const run = vi.fn();
    killTree(42, { plat: "win32", run });
    expect(run).toHaveBeenCalledWith("taskkill", ["/pid", "42", "/T", "/F"]);
  });
});

describe("komutlar ve yollar", () => {
  it("klasör açma", () => {
    expect(openCommand("/x", { plat: "darwin" })).toEqual(["open", ["/x"]]);
    expect(openCommand("C:\\x", { plat: "win32" })).toEqual(["explorer.exe", ["C:\\x"]]);
    expect(openCommand("/x", { plat: "linux" })).toEqual(["xdg-open", ["/x"]]);
  });
  it("çöp: macOS elle, Windows PowerShell Geri Dönüşüm Kutusu (tek tırnak kaçışlı), Linux gio", () => {
    expect(trashCommand("/x", { plat: "darwin" })).toBeNull();
    const [cmd, args] = trashCommand("C:\\a'b", { plat: "win32" })!;
    expect(cmd).toBe("powershell.exe");
    expect(args.at(-1)).toContain("$p='C:\\a''b'");
    expect(args.at(-1)).toContain("SendToRecycleBin");
    expect(trashCommand("/x", { plat: "linux" })).toEqual(["gio", ["trash", "/x"]]);
  });
  it("npx: Windows'ta cmd /c", () => {
    expect(npxCommand(["-y", "a"], { plat: "win32" })).toEqual({ command: "cmd", args: ["/c", "npx", "-y", "a"] });
    expect(npxCommand(["-y", "a"], { plat: "darwin" })).toEqual({ command: "npx", args: ["-y", "a"] });
  });
  it("~ açılır, medya anahtarı her sistemde /", () => {
    expect(expandHome("~/a", "/home/u")).toBe("/home/u/a");
    expect(expandHome("~\\a", "C:\\Users\\u")).toBe("C:\\Users\\u\\a");
    expect(expandHome("a~/b", "/h")).toBe("a~/b");
    expect(mediaKey("klip\\2026\\a.mp4")).toBe("klip/2026/a.mp4");
    expect(mediaKey("a/b.mp4")).toBe("a/b.mp4");
  });
  it("yalnız macOS işleri", () => {
    expect(features({ plat: "win32" }).features.focusChrome).toBe(false);
    expect(features({ plat: "darwin", shell: true }).features).toMatchObject({ focusChrome: true, shell: true });
  });
});
