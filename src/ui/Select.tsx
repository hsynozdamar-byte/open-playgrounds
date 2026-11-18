import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

// Seçici: tarayıcının açılır listesi yerine uygulamanın kendi listesi. Tetikleyicinin altına açılır,
// dünya gibi gruplar renk noktasıyla başlık olur. Klavye: oklar, Enter, Esc, Home/End.
export type SelectOpt = { value: string; label: string; color?: string };
export type SelectGroup = { label?: string; color?: string; options: SelectOpt[] };

type Props = {
  value: string;
  groups: SelectGroup[];
  onChange: (v: string) => void;
  label: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  disabled?: boolean;
};

export function Select({ value, groups, onChange, label, children, className = "", style, title, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const key = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setOpen(true); }
  };
  return (
    <>
      <button type="button" ref={btn} className={`${className} ${open ? "on" : ""}`} style={style} title={title} disabled={disabled}
        onClick={() => setOpen(!open)} onKeyDown={key} aria-label={label} aria-haspopup="listbox" aria-expanded={open}>
        <span className="sellab">{children}</span><ChevronDown size={14} className="selchev" />
      </button>
      {open && <Pop anchor={btn} value={value} groups={groups} label={label} onPick={(v) => { setOpen(false); btn.current?.focus(); if (v !== value) onChange(v); }} onClose={() => { setOpen(false); btn.current?.focus(); }} />}
    </>
  );
}

// Açılır kutunun yeri: tetikleyicinin hemen altına, en az onun genişliğinde. Altta yer azsa kutu kısalır ve kayar;
// ancak altta hiç yer yoksa (160px'ten az) üste açılır. Ekran kenarından 12px içeride kalır.
export function usePlace(anchor: React.RefObject<HTMLElement | null>, pop: React.RefObject<HTMLElement | null>, min = 240, max = 340) {
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const p = pop.current;
      if (!a || !p) return;
      const width = Math.min(Math.max(a.width, min), max);
      const left = Math.max(12, a.left + width <= innerWidth - 12 ? a.left : a.right - width);
      const below = innerHeight - a.bottom - 6 - 12;
      const h = p.scrollHeight;
      if (below >= Math.min(h, 160)) setPos({ left, top: a.bottom + 6, width, maxHeight: below });
      else { const above = a.top - 6 - 12; const mh = Math.min(h, above); setPos({ left, top: a.top - 6 - mh, width, maxHeight: above }); }
    };
    place();
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    return () => { removeEventListener("resize", place); removeEventListener("scroll", place, true); };
  }, [anchor, pop, min, max]);
  return pos;
}

// Dışarı tıklanınca kapanır (tetikleyiciye tıklamak tetikleyicinin kendi işi).
export function useOutside(anchor: React.RefObject<HTMLElement | null>, pop: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const down = (e: MouseEvent) => !pop.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node) && onClose();
    addEventListener("mousedown", down);
    return () => removeEventListener("mousedown", down);
  }, [anchor, pop, onClose]);
}

function Pop({ anchor, value, groups, label, onPick, onClose }: { anchor: React.RefObject<HTMLButtonElement | null>; value: string; groups: SelectGroup[]; label: string; onPick: (v: string) => void; onClose: () => void }) {
  const flat = groups.flatMap((g) => g.options);
  const [active, setActive] = useState(() => Math.max(0, flat.findIndex((o) => o.value === value)));
  const pop = useRef<HTMLDivElement>(null);
  const pos = usePlace(anchor, pop);
  useEffect(() => {
    pop.current?.querySelector(".is-sel")?.scrollIntoView({ block: "nearest" });
    pop.current?.focus();
  }, [pos === null]);
  useOutside(anchor, pop, onClose);
  useEffect(() => { pop.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);
  const key = (e: React.KeyboardEvent) => {
    const go = (i: number) => (e.preventDefault(), setActive(Math.max(0, Math.min(flat.length - 1, i))));
    if (e.key === "ArrowDown") go(active + 1);
    else if (e.key === "ArrowUp") go(active - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(flat.length - 1);
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (flat[active]) onPick(flat[active].value); }
    else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); onClose(); }
  };
  let i = -1;
  return createPortal(
    <div ref={pop} className="spop" role="listbox" aria-label={label} tabIndex={-1} onKeyDown={key} onMouseDown={(e) => e.stopPropagation()}
      style={pos ? { left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight } : { visibility: "hidden", left: 0, top: 0 }}>
      {groups.map((g, gi) => (
        <div key={gi} className="sgroup" role="group" aria-label={g.label}>
          {g.label && <div className="shead" style={g.color ? { ["--w" as string]: g.color } : undefined}>{g.color && <i />}{g.label}</div>}
          {g.options.map((o) => {
            const n = ++i;
            const sel = o.value === value;
            return (
              <button type="button" key={o.value} data-i={n} role="option" aria-selected={sel} tabIndex={-1}
                className={`sopt ${sel ? "is-sel" : ""} ${n === active ? "is-active" : ""}`}
                onMouseMove={() => n !== active && setActive(n)} onClick={() => onPick(o.value)}>
                {o.color && <i className="soptdot" style={{ ["--w" as string]: o.color }} />}<span>{o.label}</span>{sel && <Check size={15} />}
              </button>
            );
          })}
        </div>
      ))}
    </div>,
    document.body,
  );
}

// Dünya › proje seçicisi için gruplar: her dünyanın açık projeleri, sonunda "Projesiz" (değeri none:<dünya>).
export function projectGroups(s: { worlds: { id: string; name: string; color: string }[]; projects: { id: string; worldId: string; name: string; status: string }[] }, keep?: string | null, val = (id: string) => id, none = (w: string) => `none:${w}`): SelectGroup[] {
  return s.worlds.map((w) => ({
    label: w.name,
    color: w.color,
    options: [
      ...s.projects.filter((p) => p.worldId === w.id && (p.status !== "done" || p.id === keep)).map((p) => ({ value: val(p.id), label: p.name })),
      { value: none(w.id), label: "Projesiz" },
    ],
  }));
}
