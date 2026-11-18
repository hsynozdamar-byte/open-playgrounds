// Series color: an automation can carry a permanent color (automation.color, hex). The render uses it as the accent
// (frame, badge, headline highlight, band, ground tone). A one-off post (no automation) keeps the project's kit color.
export const isHex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
export function seriesColor(s, task) {
  const c = task?.autoId && s?.automations?.find((a) => a.id === task.autoId)?.color;
  return isHex(c) ? c.toLowerCase() : undefined;
}

// [base, dark tone]: the color 30% darker.
export function tones(hex) {
  const n = parseInt(hex.slice(1), 16);
  const d = (v) => Math.round(v * 0.7).toString(16).padStart(2, "0");
  return [hex.toLowerCase(), `#${d(n >> 16)}${d((n >> 8) & 255)}${d(n & 255)}`];
}

export const seriesRule = (hex) => (isHex(hex) ? `Series color: ${hex.toLowerCase()}. Use it as the accent on every cover and slide of this series.` : "");
