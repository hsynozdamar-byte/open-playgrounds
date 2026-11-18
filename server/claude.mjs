// LLM çağrısı (varsayılan `claude -p`): hazırlatma, taslak, Rou sohbeti aynı yolu kullanır. Komut Ayarlar › Asistan'dan ya da
// PG_LLM_CMD ile seçilir (shared/llm.mjs). Ücret: kullanıcının kendi aboneliği; API anahtarı kullanılmaz.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCall, caps, llmConfig } from "../shared/llm.mjs";

// Seçili komut (state.settings.llm). store.mjs bildirir; döngüsel içe aktarma olmasın diye veri burada okunmaz.
let choose = () => undefined;
export const llmFrom = (fn) => { choose = fn; };
export const llm = () => { let c; try { c = choose(); } catch { /* veri okunamadı: varsayılan */ } return llmConfig(process.env, c); };
export const llmCaps = () => caps(llm());

// Çalışan süreçler kendi süreç gruplarındadır (detached); sunucu kapanırken ya da yeniden başlarken kendiliğinden
// kapanmazlar. Açık kalırsa yeniden başlayan sunucu aynı işi sürdürür ve iki Rou aynı tarayıcıyı sürer (çift paylaşım riski).
const live = new Set();
export const stopAll = () => { for (const pid of live) { try { process.kill(-pid, "SIGTERM"); } catch { /* çoktan bitmiş */ } } live.clear(); };
process.on("exit", stopAll);
const LOGIN = /please run \/login|not logged in|invalid api key|authentication_error|oauth token has expired|credit balance is too low/i;

// Takılırsa `ms` sonra durdurulur; `signal` ile kullanıcı da durdurabilir. Sonuç: { ok, out } ya da { ok: false, error }.
// opt.args: Claude Code bayrakları (ör. tarayıcı için --chrome ve izinli araçlar); opt.cwd: çalışma klasörü.
// opt.tier: "mid" | "fast" (orta ve hızlı model; verilmezse en güçlüsü).
// opt.onTool(name, input): verilirse claude akış (stream-json) modunda çalışır ve kullandığı her araç anında bildirilir
// (Rou Chrome'da çalışırken uygulamada canlı görünsün diye). Sonuç yine aynı: son metin out olarak döner.
// opt.onResult(text, isError): aracın sonucu geldiğinde (Chrome'da onay bekleyişini anlamak için).
// Claude Code dışında bir komut seçiliyse araç isteyen işler açıklamalı bir hatayla döner (shared/llm.mjs buildCall).
// claude'un bilgi uyarıları ("Warning: this sign-in ends ...") hata nedeni değildir.
export const noWarnings = (t) => String(t ?? "").split("\n").filter((l) => !/^\s*warning:/i.test(l)).join("\n").trim();

export function runClaude(prompt, ms, signal, opt = {}) {
  return new Promise((resolve) => {
    const cfg = llm();
    const claude = cfg.kind === "claude";
    // Codex son mesajını dosyaya yazar (stdout'ta ilerleme satırları da olur).
    const outFile = cfg.kind === "codex" ? path.join(os.tmpdir(), `pg-llm-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.txt`) : undefined;
    const call = buildCall(cfg, prompt, { tier: opt.tier, args: opt.args, stream: !!opt.onTool, outFile });
    if (call.error) return resolve({ ok: false, error: call.error, unsupported: true });
    const stream = claude && !!opt.onTool;
    // İstem stdin'den gider: uzun istem argv sınırına takılmaz, süreç listesinde görünmez.
    const child = spawn(call.file, call.args, { stdio: ["pipe", "pipe", "pipe"], detached: true, windowsHide: true, ...(opt.cwd ? { cwd: opt.cwd } : {}) });
    child.stdin.on("error", () => { /* süreç erken kapandı */ });
    child.stdin.end(call.input);
    if (child.pid) { live.add(child.pid); child.on("close", () => live.delete(child.pid)); }
    // Kendi süreç grubunda çalışır; durdurunca açtığı alt süreçler de kapanır.
    const kill = () => { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); } };
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
          if (j.type === "assistant") for (const b of j.message?.content ?? []) if (b.type === "tool_use") { try { opt.onTool(b.name, b.input ?? {}); } catch { /* izleme işi bozmasın */ } }
          if (j.type === "user" && opt.onResult) for (const b of j.message?.content ?? []) if (b.type === "tool_result") {
            const text = typeof b.content === "string" ? b.content : (b.content ?? []).map((x) => x.text ?? "").join(" ");
            try { opt.onResult(text.slice(0, 2000), !!b.is_error); } catch { /* izleme işi bozmasın */ }
          }
          if (j.type === "result") result = typeof j.result === "string" ? j.result : "";
        } catch { /* yarım satır değil, atla */ }
      }
    });
    child.stderr.setEncoding("utf8").on("data", (c) => (err += c));
    // Süre dolunca hata "Çıkış kodu 143" ya da claude'un bir uyarı satırı olarak kalmasın: asıl neden sürenin dolmasıdır.
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; kill(); }, ms);
    signal?.addEventListener("abort", () => { kill(); end({ ok: false, error: "Durduruldu", cancelled: true }); });
    let ended = false;
    const end = (r) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      if (outFile) fs.rm(outFile, { force: true }, () => {});
      resolve(r);
    };
    child.on("error", (e) => end({ ok: false, error: e.code === "ENOENT" ? `${cfg.name} bulunamadı: \`${cfg.file}\` bu bilgisayarda yok ya da PATH'te değil. Kur ya da Ayarlar › Asistan'dan başka bir komut seç.` : `${cfg.name} çalıştırılamadı: ${e.message}` }));
    child.on("close", (code) => {
      let text = (stream ? result ?? "" : out).trim();
      if (outFile && code === 0) { try { text = fs.readFileSync(outFile, "utf8").trim() || text; } catch { /* stdout kalır */ } }
      // Oturum kapalıyken claude bazen hata mesajını normal çıktı gibi verir; bu bir çıktı değil.
      if (code === 0 && text && !(claude && text.length < 400 && LOGIN.test(text))) return end({ ok: true, out: text });
      if (claude && LOGIN.test(err + out)) return end({ ok: false, error: "Claude oturumu kapalı. Terminalde `claude` çalıştırıp giriş yap." });
      if (timedOut) return end({ ok: false, error: `Süre doldu (${Math.round(ms / 60000)} dk), Rou bitiremedi`, timedOut: true });
      const why = noWarnings(err) || noWarnings(out);
      end({ ok: false, error: (claude ? why : why.slice(-600)).trim() || `Çıkış kodu ${code}` });
    });
  });
}
