import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { setStill } from "./ui/fluid/engine";
import { stillPref } from "./views/Settings";

// Grain: a small image made once (an SVG noise filter was recomputed on every paint and made world switches stutter).
try {
  const n = 180, c = document.createElement("canvas"); c.width = c.height = n;
  const g = c.getContext("2d")!, im = g.createImageData(n, n);
  // light and dark specks at low alpha, so no blend mode is needed
  for (let i = 0; i < n * n; i++) { const v = Math.random() < 0.5 ? 255 : 0; im.data.set([v, v, v, Math.random() * (v ? 14 : 9)], i * 4); }
  g.putImageData(im, 0, 0);
  document.documentElement.style.setProperty("--grain", `url(${c.toDataURL()})`);
} catch { /* the SVG fallback is in styles.css */ }

if (stillPref()) setStill(true); // Settings › Moving logos off

createRoot(document.getElementById("root")!).render(<App />);
