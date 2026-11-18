// Seri rengi: her otomasyon kalıcı bir renk taşıyabilir (automation.color, hex). Render vurgu rengi olarak kullanır
// (çerçeve, rozet, başlık vurgusu, şerit, zemin tonu). Tek seferlik gönderide (otomasyonu yok) projenin kit rengi kalır.
export const isHex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
export function seriesColor(s, task) {
  const c = task?.autoId && s?.automations?.find((a) => a.id === task.autoId)?.color;
  return isHex(c) ? c.toLowerCase() : undefined;
}

// [zemin, koyu ton]: rengin %30 koyusu.
export function tones(hex) {
  const n = parseInt(hex.slice(1), 16);
  const d = (v) => Math.round(v * 0.7).toString(16).padStart(2, "0");
  return [hex.toLowerCase(), `#${d(n >> 16)}${d((n >> 8) & 255)}${d(n & 255)}`];
}

export const seriesRule = (hex) => (isHex(hex) ? `Seri rengi: ${hex.toLowerCase()}, bu serinin bütün kapak ve slaytlarında vurgu bu renk.` : "");
