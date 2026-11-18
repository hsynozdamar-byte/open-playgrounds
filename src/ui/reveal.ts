import { useEffect, useRef } from "react";

// Aramadan açılan bir kaydı sayfası gösterir: sayfa yeni açılıyorsa bekleyen hedefi alır, açıksa olayı dinler.
type Kind = "note" | "auto" | "feed" | "incoming";
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

// Kartı görünür yapıp kısa bir vurgu verir.
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
