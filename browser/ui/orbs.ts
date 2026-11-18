// Playground Browser'daki küreler: Playgrounds'un kendi motoru (src/ui/fluid), aynı parametreler; dünya küresi Playgrounds'takiyle birebir.
// Derleme: npx esbuild browser/ui/orbs.ts --bundle --format=iife --minify --outfile=browser/ui/orbs.js (çıktı depoda; uygulama derleme istemez).
import { mount, PAD, type FluidParams } from "../../src/ui/fluid/engine";
import { playgroundsParams, worldParams } from "../../src/ui/fluid/world";

type W = { id: string; color?: string; color2?: string };
const cache = new Map<string, HTMLSpanElement>();
const worlds = new Map<string, W>();

// Küre öğesi: anahtar başına bir kez kurulur, yeniden çizimde aynı öğe taşınır (tuval sıfırlanmaz).
function make(key: string, get: () => FluidParams) {
  let el = cache.get(key);
  if (el) return el;
  el = document.createElement("span");
  el.className = "fluid";
  const c = document.createElement("canvas");
  c.style.cssText = `position:absolute;inset:${-(PAD - 1) * 50}%;width:${PAD * 100}%;height:${PAD * 100}%`;
  el.append(c);
  cache.set(key, el);
  // Boyut ilk yerleşimde ölçülür.
  requestAnimationFrame(() => mount(c, get, Math.round(Math.max(16, el!.offsetWidth || 26) * PAD)));
  return el;
}

declare global { interface Window { pbOrbs: unknown } }
window.pbOrbs = {
  setWorlds(list: W[]) { for (const w of list) worlds.set(w.id, w); },
  // Kapsayıcıların içine küreyi koyar: [data-orb="<dünya>"] ya da [data-orb="pg"] (Playgrounds logosu); data-k aynı dünyanın ayrı yerlerini ayırır.
  fill(root: ParentNode = document) {
    root.querySelectorAll<HTMLElement>("[data-orb]").forEach((slot) => {
      const id = slot.dataset.orb!, key = `${slot.dataset.k || ""}:${id}`;
      const el = id === "pg" ? make(key, () => playgroundsParams())
        : make(key, () => { const w = worlds.get(id) ?? { id }; return worldParams(id, { primary: w.color || "#5b3df0", secondary: w.color2 }); });
      if (el.parentElement !== slot) slot.prepend(el);
    });
  },
};
