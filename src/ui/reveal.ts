import { useEffect, useRef } from "react";

// A page shows a record opened from search: if the page is just opening it takes the pending target, if it is open it listens for the event.
type Kind = "note";
let pending: { kind: Kind; id: string } | null = null;

export function reveal(kind: Kind, id: string) {
  pending = { kind, id };
  dispatchEvent(new CustomEvent("pg-reveal", { detail: pending }));
}

export function useReveal(kind: Kind, fn: (id: string) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const take = () => {
      if (pending?.kind !== kind) return;
      const id = pending.id;
      pending = null;
      ref.current(id);
    };
    take();
    addEventListener("pg-reveal", take);
    return () => removeEventListener("pg-reveal", take);
  }, [kind]);
}

// Brings the card into view and gives it a short highlight.
export function flash(selector: string) {
  requestAnimationFrame(() => setTimeout(() => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("is-flash");
    void el.offsetWidth;
    el.classList.add("is-flash");
  }, 260));
}
