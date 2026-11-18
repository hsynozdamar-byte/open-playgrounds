import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { type AgentState, FluidOrb, type FluidOrbProps } from "../ui/fluid/FluidOrb";
import "./fluid.css";

// Fluid Orb önizleme: ortada büyük orb, altında canlı parametreler, sonra üç varyasyon (Playgrounds, World, Agent).

type P = Required<Pick<FluidOrbProps, "speed" | "intensity" | "fluidity" | "separation" | "grain" | "blur">> & { size: number; animated: boolean };
const DEF: P = { speed: 1, intensity: 0.5, fluidity: 0.6, separation: 0.6, grain: 0.6, blur: 0.55, size: 420, animated: true };
const SLIDERS: [keyof P, string, number, number, number][] = [
  ["speed", "Hız", 0, 3, 0.05], ["intensity", "Deformasyon", 0, 1, 0.01], ["fluidity", "İç akış", 0, 1.5, 0.01],
  ["separation", "Ayrılma", 0, 1, 0.01], ["grain", "Tanecik", 0, 1, 0.01], ["blur", "Kenar yumuşaklığı", 0, 1, 0.01], ["size", "Boyut", 120, 560, 1],
];
const STATES: [AgentState, string][] = [["idle", "Nefes"], ["listening", "Dinliyor"], ["thinking", "Düşünüyor"]];

function load<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } }

function App() {
  const [p, setP] = useState<P>(() => load("fo-params2", DEF));
  const [wc, setWc] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("fo-world") || "") as string[]; } catch { return ["#22c8e6", "#3d5afe", "#b892ff"]; } });
  const [third, setThird] = useState(true);
  const [state, setState] = useState<AgentState>("idle");
  useEffect(() => { try { localStorage.setItem("fo-params2", JSON.stringify(p)); localStorage.setItem("fo-world", JSON.stringify(wc)); } catch { /* yalnız tercih */ } }, [p, wc]);
  const { size, ...motion } = p;
  const worldColors = third ? wc : wc.slice(0, 2);

  return (
    <main className="fo">
      <section className="fo-stage"><FluidOrb {...motion} size={size} /></section>

      <section className="fo-controls">
        {SLIDERS.map(([k, n, a, b, st]) => (
          <label key={k} className="fl-range"><span>{n}</span>
            <input type="range" min={a} max={b} step={st} value={p[k] as number} onChange={(e) => setP({ ...p, [k]: +e.target.value })} />
            <output>{k === "size" ? `${p.size}` : (p[k] as number).toFixed(2)}</output></label>
        ))}
        <div className="fo-row">
          <label className="fl-check"><input type="checkbox" checked={p.animated} onChange={(e) => setP({ ...p, animated: e.target.checked })} />Animasyon</label>
          <button className="fl-btn" onClick={() => setP(DEF)}>Varsayılana dön</button>
        </div>
      </section>

      <section className="fo-vars">
        <div className="fo-var">
          <div className="fo-vstage"><FluidOrb {...motion} size={200} /></div>
          <h3>Playgrounds</h3><p>Referanstaki bütün renkler.</p>
        </div>
        <div className="fo-var">
          <div className="fo-vstage"><FluidOrb {...motion} size={200} colors={worldColors} seed={37} /></div>
          <h3>World</h3><p>Kullanıcının seçtiği 2-3 renk.</p>
          <div className="fo-colors">
            {wc.map((c, i) => (i < 2 || third) && <input key={i} type="color" value={c} aria-label={`Renk ${i + 1}`} onChange={(e) => setWc(wc.map((x, j) => (j === i ? e.target.value : x)))} />)}
            <button className="fl-btn" onClick={() => setThird(!third)}>{third ? "2 renk" : "3 renk"}</button>
          </div>
        </div>
        <div className="fo-var">
          <div className="fo-vstage"><FluidOrb {...motion} size={200} colors={["#7b3cff", "#2f6bff", "#22d3f5", "#ff4fb8"]} seed={23} state={state} /></div>
          <h3>Agent</h3><p>Nefes, dinleme, düşünme.</p>
          <div className="fl-seg fo-seg">{STATES.map(([s, n]) => <button key={s} className={s === state ? "on" : ""} onClick={() => setState(s)}>{n}</button>)}</div>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
