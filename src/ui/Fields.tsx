import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus } from "lucide-react";
import { useOutside, usePlace } from "./Select";

// Fields in the app's own design instead of the browser's (time wheel, number arrows, color panel).

const pad = (n: number) => String(n).padStart(2, "0");
const TIMES = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);

// "9" → 09:00, "930" → 09:30, "21.30" → 21:30, "7:5" → 07:05. null if invalid.
export function parseTime(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  let h: number, m: number;
  const sep = t.match(/^(\d{1,2})\s*[:.,\s]\s*(\d{1,2})$/);
  if (sep) { h = +sep[1]; m = +sep[2]; }
  else if (/^\d{1,4}$/.test(t)) {
    if (t.length <= 2) { h = +t; m = 0; }
    else { h = +t.slice(0, t.length - 2); m = +t.slice(-2); }
  } else return null;
  return h >= 0 && h < 24 && m >= 0 && m < 60 ? `${pad(h)}:${pad(m)}` : null;
}

type TimeProps = { value: string; onChange: (v: string) => void; label?: string; autoFocus?: boolean; className?: string; placeholder?: string };

// Time field: can be typed (9, 930, 21.30) or picked from the dropdown list in 15-minute steps.
// The list opens under the field on focus; arrows move through it, Enter picks, Esc closes.
export function TimeField({ value, onChange, label, autoFocus, className = "", placeholder = "--:--" }: TimeProps) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(value), [value]);
  const list = value && !TIMES.includes(value) ? [...TIMES, value].sort() : TIMES;
  const near = () => { const v = parseTime(draft) ?? value; if (!v) return list.indexOf("09:00"); const i = list.findIndex((x) => x >= v); return i < 0 ? list.length - 1 : i; };
  const [active, setActive] = useState(near);
  const commit = (v: string | null) => { if (v) { setDraft(v); if (v !== value) onChange(v); } else setDraft(value); };
  const key = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const go = (i: number) => { e.preventDefault(); if (!open) { setOpen(true); setActive(near()); return; } setActive(Math.max(0, Math.min(list.length - 1, i))); };
    if (e.key === "ArrowDown") go(active + 1);
    else if (e.key === "ArrowUp") go(active - 1);
    else if (e.key === "Enter" && open) {
      e.preventDefault(); e.stopPropagation();
      const typed = parseTime(draft);
      commit(typed && typed !== value ? typed : list[active]);
      setOpen(false);
    } else if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); setDraft(value); }
  };
  return (
    <>
      <input ref={input} className={`timefield ${className}`} value={draft} autoFocus={autoFocus} placeholder={placeholder} inputMode="numeric" aria-label={label} spellCheck={false} autoComplete="off"
        onFocus={(e) => { e.target.select(); setActive(near()); setOpen(true); }}
        onClick={() => !open && (setActive(near()), setOpen(true))}
        onChange={(e) => { setDraft(e.target.value); const v = parseTime(e.target.value); if (v) { const i = list.findIndex((x) => x >= v); setActive(i < 0 ? list.length - 1 : i); } }}
        onBlur={() => { commit(parseTime(draft)); setOpen(false); }}
        onKeyDown={key} />
      {open && <TimePop anchor={input} list={list} value={value} active={active} setActive={setActive} onPick={(v) => { commit(v); setOpen(false); }} onClose={() => setOpen(false)} />}
    </>
  );
}

function TimePop({ anchor, list, value, active, setActive, onPick, onClose }: { anchor: React.RefObject<HTMLInputElement | null>; list: string[]; value: string; active: number; setActive: (i: number) => void; onPick: (v: string) => void; onClose: () => void }) {
  const pop = useRef<HTMLDivElement>(null);
  const pos = usePlace(anchor, pop, 112, 132);
  useOutside(anchor, pop, onClose);
  // On open the selected time sits in the middle of the list; then, moving with the arrows, it scrolls just enough to stay visible.
  const placed = pos !== null;
  useEffect(() => {
    const box = pop.current, el = box?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    if (placed && box && el) box.scrollTop = el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2;
  }, [placed]);
  useEffect(() => { if (placed) pop.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);
  return createPortal(
    <div ref={pop} className="spop tpop" role="listbox" style={pos ? { left: pos.left, top: pos.top, width: pos.width, maxHeight: Math.min(pos.maxHeight, 264) } : { visibility: "hidden", left: 0, top: 0 }}
      onMouseDown={(e) => e.preventDefault()}>
      {list.map((t, i) => (
        <button type="button" key={t} data-i={i} role="option" aria-selected={t === value} tabIndex={-1}
          className={`sopt ${t === value ? "is-sel" : ""} ${i === active ? "is-active" : ""} ${t.endsWith(":00") ? "is-hour" : ""}`}
          onMouseMove={() => i !== active && setActive(i)} onClick={() => onPick(t)}>
          <span>{t}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

type StepProps = { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string; className?: string };

// Number: − value + . The value can be typed; arrows and buttons change it by one step and never leave the limits.
export function Stepper({ value, onChange, min = -Infinity, max = Infinity, step = 1, label, className = "" }: StepProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const fix = (n: number) => Math.min(max, Math.max(min, Math.round(n / step) * step));
  const set = (n: number) => { const v = fix(n); setDraft(String(v)); if (v !== value) onChange(v); };
  return (
    <span className={`stepper ${className}`}>
      <button type="button" tabIndex={-1} onClick={() => set(value - step)} disabled={value <= min} aria-label={`Decrease ${label}`}><Minus size={13} /></button>
      <input value={draft} inputMode="decimal" aria-label={label} spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { const n = parseFloat(draft.replace(",", ".")); if (Number.isFinite(n)) set(n); else setDraft(String(value)); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") { e.preventDefault(); set(value + step); }
          else if (e.key === "ArrowDown") { e.preventDefault(); set(value - step); }
          else if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }} />
      <button type="button" tabIndex={-1} onClick={() => set(value + step)} disabled={value >= max} aria-label={`Increase ${label}`}><Plus size={13} /></button>
    </span>
  );
}

// A wide palette for a world's main color and second tone. A typed hex is accepted too.
const PALETTE = [
  "#ff2a2a", "#ff5a36", "#ff7a45", "#ffb020", "#f5c518", "#a3c614",
  "#22b357", "#14b8a6", "#06a3c4", "#2d8cff", "#3d5afe", "#5b4cf5",
  "#7c3aed", "#9a2fe0", "#c026d3", "#e0218a", "#f43f6e", "#b4532a",
  "#7a5a3a", "#64748b", "#334155", "#111827", "#a8a29e", "#e7e5e4",
];
const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;
const normHex = (v: string) => { const m = v.trim().match(HEX); if (!m) return null; const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1]; return `#${h.toLowerCase()}`; };

type ColorProps = { value: string; onChange: (v: string) => void; label: string; className?: string; title?: string };

export function ColorPick({ value, onChange, label, className = "", title }: ColorProps) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={btn} className={className} title={title} aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && <ColorPop anchor={btn} value={value} onPick={(v) => onChange(v)} onClose={() => setOpen(false)} />}
    </>
  );
}

function ColorPop({ anchor, value, onPick, onClose }: { anchor: React.RefObject<HTMLButtonElement | null>; value: string; onPick: (v: string) => void; onClose: () => void }) {
  const pop = useRef<HTMLDivElement>(null);
  const pos = usePlace(anchor, pop, 232, 232);
  const [hex, setHex] = useState(value);
  useOutside(anchor, pop, onClose);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  }, [onClose]);
  const ok = normHex(hex);
  return createPortal(
    <div ref={pop} className="cpop" style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden", left: 0, top: 0 }}>
      <div className="cgrid">
        {PALETTE.map((c) => <button type="button" key={c} className={c === value ? "on" : ""} style={{ background: c }} aria-label={c} onClick={() => { setHex(c); onPick(c); }} />)}
      </div>
      <form className="chex" onSubmit={(e) => { e.preventDefault(); if (ok) { onPick(ok); onClose(); } }}>
        <i style={{ background: ok ?? value }} />
        <input value={hex} onChange={(e) => { setHex(e.target.value); const v = normHex(e.target.value); if (v) onPick(v); }} aria-label="Color code" spellCheck={false} placeholder="#3d5afe" />
      </form>
    </div>,
    document.body,
  );
}
