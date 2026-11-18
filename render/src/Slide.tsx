import { AbsoluteFill } from "remotion";
import { type Account, DISPLAY, MONO, fit, look, phrase, phraseStyle } from "./look";

export type SlideProps = { account: Account; slides: { title: string; text: string }[]; index: number; template?: string };

const PAD = 96;
const pad2 = (n: number) => String(n).padStart(2, "0");

// Kaydırmalı Instagram gönderisinin bir slaytı (1080x1350). İlk slayt kapak: tek büyük cümle.
export function Slide({ account, slides, index, template }: SlideProps) {
  const s = slides[index] ?? { title: "", text: "" };
  const cover = index === 0;
  const last = index === slides.length - 1;
  const L = look(template, account.color);
  const accent = L.accent;
  const titleSize = cover
    ? fit(s.title, [[18, 150], [32, 128], [52, 108], [80, 92], [999, 78]])
    : fit(s.title, [[24, 92], [44, 80], [70, 68], [999, 58]]);
  const textSize = fit(s.text, [[90, 50], [160, 44], [260, 38], [999, 34]]);
  return (
    <AbsoluteFill style={{ fontFamily: DISPLAY, color: L.ink }}>
      {L.bg({ color: account.color, x: cover ? 16 : 16 + ((index * 23) % 68), y: cover ? 10 : 8 + ((index * 17) % 30), strength: cover ? 1.15 : 0.75 })}
      {/* Sayaç yalnız birden çok slaytta: tek görselde "01 / 01" anlamsız. */}
      {slides.length > 1 && (
        <div style={{ position: "absolute", top: PAD, left: PAD, right: PAD, display: "flex", alignItems: "center", gap: 18, fontFamily: MONO, fontSize: 28, letterSpacing: "0.04em", color: L.muted }}>
          <span style={{ width: 14, height: 14, borderRadius: 7, background: L.dot }} />
          <span>{pad2(index + 1)} / {pad2(slides.length)}</span>
        </div>
      )}

      <div
        style={{
          position: "absolute",
          left: PAD,
          right: PAD,
          top: cover ? undefined : 250,
          bottom: cover ? 250 : 220,
          display: "flex",
          flexDirection: "column",
          justifyContent: cover ? "flex-end" : "center",
          gap: 40,
        }}
      >
        {s.title && (
          <h1 style={{ margin: 0, fontSize: titleSize, fontWeight: 800, lineHeight: 1.02, letterSpacing: "-0.035em", textWrap: "balance", ...phraseStyle }}>{phrase(s.title)}</h1>
        )}
        {s.text && (
          <p style={{ margin: 0, fontSize: textSize, fontWeight: 500, lineHeight: 1.3, letterSpacing: "-0.012em", color: L.muted, textWrap: "pretty", maxWidth: 860 }}>{s.text}</p>
        )}
      </div>

      <div style={{ position: "absolute", left: PAD, right: PAD, bottom: PAD, display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: MONO, fontSize: 28, letterSpacing: "0.02em", color: L.muted }}>
        {/* Hesap adresi (linkedin.com/company/…) görselde yazmaz; o zaman hesabın adı. */}
        <span>{account.handle && !account.handle.includes("/") ? account.handle : account.name}</span>
        {!last && <span style={{ color: accent }}>Kaydır →</span>}
      </div>
    </AbsoluteFill>
  );
}
