import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { addDays, daysBetween, iso, relDay, today } from "../date";

// Date picker: the app's own month view instead of the browser's calendar. The week starts on Monday.
// value is "YYYY-MM-DD" or "". extra: an additional option on the bottom row (e.g. "Ongoing" on a project).
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const QUICK: [string, (t: string) => string][] = [
  ["Today", (t) => t],
  ["Tomorrow", (t) => addDays(t, 1)],
  ["1 week", (t) => addDays(t, 7)],
  ["1 month", (t) => { const [y, m, d] = t.split("-").map(Number); return iso(new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate()))); }],
];

export function dateLabel(v: string) {
  const [y, m, d] = v.split("-").map(Number);
  const n = daysBetween(today(), v);
  const rel = n === 0 || n === 1 || n === -1 ? relDay(v) : n > 0 ? `in ${n} days` : `${-n} days ago`;
  return { date: `${MONTHS[m - 1].slice(0, 3)} ${d}${y !== new Date().getFullYear() ? `, ${y}` : ""}`, rel };
}

type Props = { value: string; onChange: (v: string) => void; placeholder?: string; label: string; clearable?: boolean; extra?: React.ReactNode; className?: string; icon?: React.ReactNode };

export function DatePick({ value, onChange, placeholder = "Pick a date", label, clearable = true, extra, className = "", icon }: Props) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const shown = value ? dateLabel(value) : null;
  return (
    <>
      <button type="button" ref={btn} className={`dpick ${value ? "has" : ""} ${open ? "on" : ""} ${className}`} onClick={() => setOpen(!open)} aria-label={label} aria-expanded={open}>
        {icon ?? <CalendarDays size={15} />}
        {shown ? <><b>{shown.date}</b><span>{shown.rel}</span></> : <span>{placeholder}</span>}
      </button>
      {open && <Pop anchor={btn} value={value} onPick={(v) => (onChange(v), setOpen(false))} onClose={() => setOpen(false)} clearable={clearable && !!value} extra={extra} />}
    </>
  );
}

function Pop({ anchor, value, onPick, onClose, clearable, extra }: { anchor: React.RefObject<HTMLButtonElement | null>; value: string; onPick: (v: string) => void; onClose: () => void; clearable: boolean; extra?: React.ReactNode }) {
  const t = today();
  const start = value || t;
  const [ym, setYm] = useState<[number, number]>([+start.slice(0, 4), +start.slice(5, 7) - 1]);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  // Below the trigger; above it if it does not fit. Stays 12px inside the screen edge.
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const p = pop.current;
      if (!a || !p) return;
      const w = p.offsetWidth, h = p.offsetHeight;
      const left = Math.max(12, Math.min(a.left, innerWidth - w - 12));
      const top = a.bottom + 6 + h <= innerHeight - 12 ? a.bottom + 6 : Math.max(12, a.top - 6 - h);
      setPos({ left, top });
    };
    place();
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    return () => { removeEventListener("resize", place); removeEventListener("scroll", place, true); };
  }, [anchor]);
  useEffect(() => {
    const down = (e: MouseEvent) => !pop.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    addEventListener("mousedown", down);
    addEventListener("keydown", key, true);
    return () => { removeEventListener("mousedown", down); removeEventListener("keydown", key, true); };
  }, [anchor, onClose]);

  const [y, m] = ym;
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => iso(new Date(y, m, 1 - lead + i)));
  const rows = cells.slice(35).every((d) => +d.slice(5, 7) - 1 !== m) ? cells.slice(0, 35) : cells;
  const shift = (k: number) => setYm(([yy, mm]) => { const d = new Date(yy, mm + k, 1); return [d.getFullYear(), d.getMonth()]; });

  return createPortal(
    <div ref={pop} className="dpop" style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden", left: 0, top: 0 }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="dphead">
        <b>{MONTHS[m]} <span>{y}</span></b>
        <button type="button" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={16} /></button>
        <button type="button" onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={16} /></button>
      </div>
      <div className="dpgrid">
        {WEEK.map((d) => <i key={d}>{d}</i>)}
        {rows.map((d) => {
          const out = +d.slice(5, 7) - 1 !== m;
          return (
            <button type="button" key={d} className={[d === value && "is-sel", d === t && "is-today", out && "is-out", d < t && "is-past"].filter(Boolean).join(" ")} onClick={() => onPick(d)} aria-label={d} aria-pressed={d === value}>
              {+d.slice(8)}
            </button>
          );
        })}
      </div>
      <div className="dpquick">
        {QUICK.map(([l, f]) => <button type="button" key={l} className={f(t) === value ? "on" : ""} onClick={() => onPick(f(t))}>{l}</button>)}
      </div>
      {(clearable || extra) && (
        <div className="dpfoot">
          {extra}
          {clearable && <button type="button" className="dpclear" onClick={() => onPick("")}><X size={13} />Clear date</button>}
        </div>
      )}
    </div>,
    document.body,
  );
}
