export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const today = () => iso(new Date());
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
// Hafta pazartesi başlar.
export const weekStart = (s: string) => {
  const d = parse(s);
  return addDays(s, -((d.getDay() + 6) % 7));
};
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("tr-TR", o);
export const dayName = (s: string) => fmt({ weekday: "long" }).format(parse(s));
export const dayShort = (s: string) => fmt({ weekday: "short" }).format(parse(s));
export const dayLong = (s: string) => fmt({ day: "numeric", month: "long" }).format(parse(s));
export const dayNum = (s: string) => parse(s).getDate();
export const range = (start: string) => {
  const end = addDays(start, 6);
  const a = parse(start), b = parse(end);
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${fmt({ day: "numeric", month: "long" }).format(b)}`
    : `${fmt({ day: "numeric", month: "short" }).format(a)} – ${fmt({ day: "numeric", month: "short" }).format(b)}`;
};
export const ago = (isoTime: string) => {
  const m = Math.round((Date.now() - new Date(isoTime).getTime()) / 60000);
  if (m < 1) return "şimdi";
  if (m < 60) return `${m} dk`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} sa`;
  return fmt({ day: "numeric", month: "short" }).format(new Date(isoTime));
};
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
export const toMin = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};
export const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export const dur = (min: number) => (min < 60 ? `${min} dk` : min % 60 ? `${Math.floor(min / 60)} sa ${min % 60} dk` : `${min / 60} sa`);
export const relDay = (s: string) => {
  const n = daysBetween(today(), s);
  if (n === 0) return "bugün";
  if (n === 1) return "yarın";
  if (n === -1) return "dün";
  if (n > 1 && n < 7) return dayName(s);
  return dayLong(s);
};

// Yerel tarih-saat "YYYY-MM-DDTHH:MM"
export const localTs = (d: Date) => `${iso(d)}T${fromMin(d.getHours() * 60 + d.getMinutes())}`;
export const tsDay = (ts: string) => ts.slice(0, 10);
export const tsMin = (ts: string) => toMin(ts.slice(11, 16));
export const mkTs = (day: string, min: number) => `${day}T${fromMin(Math.max(0, Math.min(24 * 60 - 1, min)))}`;
export const spanMin = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
export const hm = (ts: string) => ts.slice(11, 16);
