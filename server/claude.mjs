// `claude -p` çağrısı: hazırlatma (prepare) ve taslak (draft) aynı yolu kullanır.
// Ücret: kullanıcının Claude aboneliği; API anahtarı kullanılmaz.
import { spawn } from "node:child_process";

const CLAUDE = process.env.PG_CLAUDE || "claude";
// Çalışan claude süreçleri kendi süreç gruplarındadır (detached); sunucu kapanırken ya da yeniden başlarken kendiliğinden
// kapanmazlar. Açık kalırsa yeniden başlayan sunucu aynı işi sürdürür ve iki Rou aynı tarayıcıyı sürer (çift paylaşım riski).
const live = new Set();
export const stopAll = () => { for (const pid of live) { try { process.kill(-pid, "SIGTERM"); } catch { /* çoktan bitmiş */ } } live.clear(); };
process.on("exit", stopAll);
const LOGIN = /please run \/login|not logged in|invalid api key|authentication_error|oauth token has expired|credit balance is too low/i;

// Takılırsa `ms` sonra durdurulur; `signal` ile kullanıcı da durdurabilir. Sonuç: { ok, out } ya da { ok: false, error }.
// opt.args: ek bayraklar (ör. tarayıcı için --chrome ve izinli araçlar); opt.cwd: çalışma klasörü.
// opt.onTool(name, input): verilirse claude akış (stream-json) modunda çalışır ve kullandığı her araç anında bildirilir
// (Rou Chrome'da çalışırken uygulamada canlı görünsün diye). Sonuç yine aynı: son metin out olarak döner.
// opt.onResult(text, isError): aracın sonucu geldiğinde (Chrome'da onay bekleyişini anlamak için).
// claude'un bilgi uyarıları ("Warning: this sign-in ends ...") hata nedeni değildir.
export const noWarnings = (t) => String(t ?? "").split("\n").filter((l) => !/^\s*warning:/i.test(l)).join("\n").trim();

export function runClaude(prompt, ms, signal, opt = {}) {
  return new Promise((resolve) => {
    const fmt = opt.onTool ? ["--output-format", "stream-json", "--verbose"] : ["--output-format", "text"];
    // Model açıkça en güçlüsü (Opus); bir çağrı kendi --model'ini verirse (ör. özet için haiku) o geçerli.
    const model = (opt.args ?? []).includes("--model") ? [] : ["--model", process.env.PG_MODEL || "opus"];
    const child = spawn(CLAUDE, ["-p", prompt, ...model, ...fmt, ...(opt.args ?? [])], { stdio: ["ignore", "pipe", "pipe"], detached: true, ...(opt.cwd ? { cwd: opt.cwd } : {}) });
    if (child.pid) { live.add(child.pid); child.on("close", () => live.delete(child.pid)); }
    // Kendi süreç grubunda çalışır; durdurunca açtığı alt süreçler de kapanır.
    const kill = () => { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); } };
    let out = "", err = "", buf = "", result = null;
    child.stdout.setEncoding("utf8").on("data", (c) => {
      if (!opt.onTool) return void (out += c);
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
      resolve(r);
    };
    child.on("error", (e) => end({ ok: false, error: `Claude çalıştırılamadı: ${e.message}` }));
    child.on("close", (code) => {
      const text = (opt.onTool ? result ?? "" : out).trim();
      // Oturum kapalıyken claude bazen hata mesajını normal çıktı gibi verir; bu bir çıktı değil.
      if (code === 0 && text && !(text.length < 400 && LOGIN.test(text))) return end({ ok: true, out: text });
      if (LOGIN.test(err + out)) return end({ ok: false, error: "Claude oturumu kapalı. Terminalde `claude` çalıştırıp giriş yap." });
      if (timedOut) return end({ ok: false, error: `Süre doldu (${Math.round(ms / 60000)} dk), Rou bitiremedi`, timedOut: true });
      const why = noWarnings(err) || noWarnings(out);
      end({ ok: false, error: (why || `Çıkış kodu ${code}`).trim() });
    });
  });
}
