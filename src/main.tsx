import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { setStill } from "./ui/fluid/engine";
import { stillPref } from "./views/Settings";

// Tanecik dokusu: bir kez üretilen küçük bir görüntü (SVG gürültü filtresi her boyamada yeniden hesaplanıyor, dünya geçişlerini takıltıyordu)
try {
  const n = 180, c = document.createElement("canvas"); c.width = c.height = n;
  const g = c.getContext("2d")!, im = g.createImageData(n, n);
  // açık ve koyu benekler, düşük alfa: karıştırma modu gerekmez (soft-light her karede tam ekran yeniden karışıyordu)
  for (let i = 0; i < n * n; i++) { const v = Math.random() < 0.5 ? 255 : 0; im.data.set([v, v, v, Math.random() * (v ? 14 : 9)], i * 4); }
  g.putImageData(im, 0, 0);
  document.documentElement.style.setProperty("--grain", `url(${c.toDataURL()})`);
} catch { /* SVG yedeği styles.css'te */ }

if (stillPref()) setStill(true);   // Profil > Görünüm: durgun logolar

createRoot(document.getElementById("root")!).render(<App />);
